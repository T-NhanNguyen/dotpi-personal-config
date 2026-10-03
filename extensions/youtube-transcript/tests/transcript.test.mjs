import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const host = process.env.PI_TEST_HOST || path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const require = createRequire(path.join(host, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: {
  "@earendil-works/pi-coding-agent": path.join(host, "dist/index.js"),
  typebox: require.resolve("typebox"),
} });
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { normalizeUrl, parseSrt, selectTrack, renderTranscript, fetchTranscript } = await jiti.import(path.join(root, "transcript.ts"));
const factory = await jiti.import(path.join(root, "index.ts"), { default: true });
let count = 0;
const check = async (name, fn) => { await fn(); console.log(`ok ${++count}: ${name}`); };
const url = "https://www.youtube.com/watch?v=2OMRWPOSw9s";
const track = [{ ext: "srt" }];
const meta = { title: "Fixture", duration: 10, subtitles: { en: track }, automatic_captions: { "en-orig": track }, chapters: [{ title: "Introduction", start_time: 0, end_time: 10 }] };
const srt = '\uFEFF1\r\n00:00:00,000 --> 00:00:05,320\r\n<b>Hello &amp; welcome.</b>\r\n\r\n2\r\n00:00:02,560 --> 00:00:07,200\r\nHello &amp; welcome.\r\n\r\n3\r\n00:00:07,200 --> 00:00:10,000\r\nA second\r\nline.\r\n';
const directories = new Set();
function fixture(metadata = meta, subtitles = srt, failure) {
  const calls = [];
  const exec = async (command, args, options) => {
    const directory = path.dirname(args[args.indexOf("-o") + 1]);
    directories.add(directory);
    calls.push({ command, args, options, directory });
    if (failure) return failure(calls.length, args, options);
    if (args.includes("--write-info-json")) await writeFile(path.join(directory, "source.info.json"), JSON.stringify(metadata));
    else {
      const language = args[args.indexOf("--sub-langs") + 1];
      await writeFile(path.join(directory, `source.${language}.srt`), subtitles);
    }
    return { stdout: "", stderr: "", code: 0, killed: false };
  };
  return { exec, calls };
}
try {
  await check("normalizes video links and drops playlist parameters", () => {
    for (const input of [url, "https://youtu.be/2OMRWPOSw9s?t=30", `${url}&list=anything`, "https://www.youtube.com/shorts/2OMRWPOSw9s"]) assert.equal(normalizeUrl(input), url);
    for (const input of ["https://evil.test/watch?v=2OMRWPOSw9s", "https://youtube.com/playlist?list=x", "file:///tmp/test", "https://user@youtube.com/watch?v=2OMRWPOSw9s"]) assert.throws(() => normalizeUrl(input));
  });
  await check("SRT preserves repeated speech, overlapping timing and multiline content", () => {
    const cues = parseSrt(srt);
    assert.equal(cues.length, 3);
    assert.deepEqual(cues[0], { start: 0, end: 5.32, text: "Hello & welcome." });
    assert.equal(cues[1].text, cues[0].text);
    assert.equal(cues[2].text, "A second line.");
    assert.throws(() => parseSrt(""), /empty/);
    assert.throws(() => parseSrt("not subtitles"), /Malformed/);
    assert.throws(() => parseSrt("1\n00:00:02,000 --> 00:00:01,000\ntext"), /before/);
  });
  await check("manual-first native SRT selection and single-track language rules", () => {
    assert.deepEqual(selectTrack(meta), { language: "en", automatic: false });
    assert.deepEqual(selectTrack({ automatic_captions: meta.automatic_captions }), { language: "en-orig", automatic: true });
    assert.deepEqual(selectTrack(meta, "en-orig"), { language: "en-orig", automatic: true });
    assert.equal(selectTrack({ subtitles: { "en-GB": track }, automatic_captions: { en: track } }).automatic, false);
    assert.throws(() => selectTrack({ subtitles: { en: [{ ext: "vtt" }] } }), /No native SRT/);
    assert.throws(() => selectTrack(meta, "en.*"), /globs/);
  });
  await check("chapter rendering retains every cue", () => {
    const text = renderTranscript("Title", url, parseSrt(srt), [{ title: "Intro", start: 0, end: 10 }]);
    assert(text.includes("## 00:00:00 Intro"));
    assert.equal(text.match(/Hello & welcome\./g).length, 2);
  });
  await check("extractor creates full artifacts with native-only and no-media flags", async () => {
    const fake = fixture();
    const result = await fetchTranscript(fake.exec, { url });
    assert.equal(result.summary.automatic, false);
    assert.equal(result.summary.cueCount, 3);
    assert.equal(result.summary.chapters.length, 1);
    for (const call of fake.calls) {
      assert.equal(call.command, "yt-dlp");
      for (const flag of ["--ignore-config", "--skip-download", "--no-playlist"]) assert(call.args.includes(flag));
      assert(!call.args.includes("--convert-subs"));
      assert.equal(call.options.timeout, 180000);
      assert.equal(call.args.at(-1), url);
    }
    const captionArgs = fake.calls[1].args;
    assert(captionArgs.includes("--write-subs"));
    assert.equal(captionArgs[captionArgs.indexOf("--sub-format") + 1], "srt");
    assert.equal(captionArgs[captionArgs.indexOf("--sub-langs") + 1], "en");
    for (const file of Object.values(result.summary.paths)) await access(file);
    assert.equal((await readFile(result.summary.paths.srt, "utf8")), srt);
    assert.equal(JSON.parse(await readFile(result.summary.paths.segments, "utf8")).cues.length, 3);
  });
  await check("automatic tracks and missing chapters produce warnings", async () => {
    const fake = fixture({ ...meta, subtitles: {}, chapters: [] });
    const result = await fetchTranscript(fake.exec, { url });
    assert(fake.calls[1].args.includes("--write-auto-subs"));
    assert.equal(result.summary.language, "en-orig");
    assert.equal(result.summary.warnings.length, 2);
  });
  await check("missing captions, malformed SRT, 429, timeout and missing binary fail cleanly", async () => {
    const cases = [
      [fixture({}), /No native SRT/],
      [fixture(meta, "bad"), /Malformed/],
      [fixture(meta, srt, () => ({ code: 1, killed: false, stdout: "", stderr: "HTTP Error 429" })), /429/],
      [fixture(meta, srt, () => ({ code: 0, killed: true, stdout: "", stderr: "" })), /timed out/],
      [fixture(meta, srt, () => { throw new Error("ENOENT"); }), /installed/],
    ];
    for (const [fake, pattern] of cases) {
      await assert.rejects(fetchTranscript(fake.exec, { url }), pattern);
      await assert.rejects(access(fake.calls[0].directory));
    }
  });
  await check("cancellation is forwarded and partial files are removed", async () => {
    const controller = new AbortController();
    const fake = fixture(meta, srt, (_count, _args, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort();
      return { code: 0, killed: true, stdout: "", stderr: "" };
    });
    await assert.rejects(fetchTranscript(fake.exec, { url }, controller.signal), { name: "AbortError" });
    await assert.rejects(access(fake.calls[0].directory));
    await assert.rejects(fetchTranscript(() => assert.fail("must not run"), { url }, controller.signal), { name: "AbortError" });
  });
  await check("concurrent calls use separate artifact directories", async () => {
    const fake = fixture();
    const results = await Promise.all([fetchTranscript(fake.exec, { url }), fetchTranscript(fake.exec, { url })]);
    assert.notEqual(results[0].summary.paths.srt, results[1].summary.paths.srt);
  });
  await check("tool registers and bounds a long transcript preview", async () => {
    const many = Array.from({ length: 500 }, (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\nRepeated spoken content ${i}.\n`).join("\n");
    const fake = fixture(meta, many);
    let tool;
    factory({ exec: fake.exec, registerTool: value => { tool = value; } });
    assert.equal(tool.name, "youtube_transcript");
    assert(tool.outputSchema);
    const result = await tool.execute("test", { url }, undefined, undefined, { cwd: root });
    assert(result.content[0].text.includes("Preview truncated"));
    assert(Buffer.byteLength(result.content[0].text) < 17000);
    assert.equal(result.structuredContent.cueCount, 500);
    assert((await readFile(result.details.paths.transcript, "utf8")).includes("content 499"));
  });
  if (process.env.PI_YOUTUBE_LIVE === "1") {
    await check("live native SRT extraction of supplied video", async () => {
      const { execCommand } = await jiti.import(path.join(host, "dist/core/exec.js"));
      const result = await fetchTranscript((command, args, options) => execCommand(command, args, root, options), { url });
      directories.add(path.dirname(result.summary.paths.srt));
      assert(result.summary.cueCount > 1000);
      assert.equal(result.summary.language, "en-orig");
      assert.equal(result.summary.automatic, true);
      assert(result.summary.duration > 2800);
      console.log(JSON.stringify(result.summary, null, 2));
    });
  }
  console.log(`Passed ${count} checks.`);
} finally {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
}
