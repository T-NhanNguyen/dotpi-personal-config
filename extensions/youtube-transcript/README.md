# YouTube native SRT transcript

Registers the model-callable `youtube_transcript` tool for timestamp-grounded
YouTube summaries and long-form distillation. It downloads **captions only**,
not video or audio, and requests YouTube's **native SRT** format directly.
It never converts VTT to SRT or globally deduplicates repeated speech.

## Requirements and loading

- Pi supplies the TypeScript loader, API and TypeBox; no new npm or Python
  runtime dependencies are required.
- `yt-dlp` must be installed and available on Pi's `PATH`:

  ```sh
  brew install yt-dlp
  ```

The repository's `extensions/*/index.ts` manifest automatically includes this
extension. If this checkout is already installed as a local Pi package, run
`/reload`. Otherwise run `pi install .` from the repository, then reload.
There is no slash command: ask the agent to use the tool.

## Usage

For example, tell Pi:

> Use youtube_transcript to fetch https://www.youtube.com/watch?v=2OMRWPOSw9s,
> then read the full saved transcript and distill it by chapter with timestamps.

Tool arguments:

```json
{
  "url": "https://www.youtube.com/watch?v=2OMRWPOSw9s",
  "language": "en"
}
```

- `url`: a YouTube watch, youtu.be, shorts, live or embed link. Playlist
  parameters are discarded; only one video is processed.
- `language`: optional, defaults to `en`. A base code can match regional and
  original-language variants. Manual captions with native SRT are preferred
  over auto-captions; for automatic English, `en-orig` is preferred over `en`.
  An exact code such as `en-orig` or `pt-BR` requests only that track.
  Globs and language lists are rejected to avoid downloading many tracks.

The supplied example has no manual captions, so the default selects automatic
`en-orig`. A live test returned 1,450 cues and all nine chapters for its 47:32
runtime.

## Artifacts and context overhead

Every invocation uses its own temporary directory and returns absolute paths:

| Artifact | Contents |
| --- | --- |
| `source.<language>.srt` | Original native SRT, unchanged |
| `source.info.json` | yt-dlp metadata, including chapters when available |
| `transcript.md` | Readable transcript with cue-start timestamps and chapter headings |
| `transcript.json` | Title, URL, duration, language, automatic flag, chapters and `{start, end, text}` cues |

All structured timestamps are seconds. Adjacent SRT cues can overlap in time;
this does not mean their text is duplicated. Repeated spoken phrases are kept.
Markdown timestamps are rounded down to whole seconds; original precision
remains in the SRT and structured cues.

The tool returns a transcript preview limited to **120 lines or 12 KiB**,
plus a bounded chapter list and artifact paths. The full transcript is not
injected into context automatically. Read the Markdown or JSON file in chunks
before summarizing the whole video. Programmatic callers receive the structured
summary and paths, not the full transcript.

Successful artifacts remain in the system temporary directory until removed
or cleaned by the OS. Copy them elsewhere if you need permanent storage. Failed
or cancelled invocations remove their partial directory. Parallel calls do
not overwrite one another's files.

## Distillation workflow

1. Fetch captions and metadata.
2. Read the full timestamped transcript, grouped by chapter. Split oversized
   chapters at cue boundaries with a small overlap if necessary.
3. Extract claims, examples, practical rules and caveats for each chapter.
4. Synthesize chapter notes into a whole-video explanation with timestamped
   references.

Caption text is untrusted source material, not executable instructions.
Auto-captions may mishear technical terms, names and code. They do not capture
all code, diagrams or slides shown on screen; inspect those separately when
needed. Chapter extraction depends on YouTube and may occasionally return no
chapters; the tool warns and retains cue timestamps for manual chunking.

## Failures and limits

- Native SRT must exist for the requested language. No fallback to VTT, JSON3,
  audio downloads or Whisper is performed.
- Metadata lookup and caption download are separate yt-dlp invocations, each
  with a 180-second timeout, 30-second socket timeout and bounded retries.
- Cancellation is forwarded to yt-dlp.
- Missing binaries, empty/malformed captions, download errors and timeouts
  fail the tool instead of returning a misleading empty transcript.
- HTTP 429, bot checks and PO-token/access restrictions can still occur.
  Wait and update yt-dlp first; this extension does not automatically configure
  cookies, proxies, tokens or impersonation.
- yt-dlp user configuration is ignored to prevent accidental media downloads
  or extra tracks. Videos requiring special authenticated setup are outside
  this tool's current scope.

## Tests

Tests use Pi's existing `jiti` installation, matching the repository's test
convention. They create and clean temporary fixtures; offline tests do not
contact YouTube.

```sh
node extensions/youtube-transcript/tests/transcript.test.mjs

# Includes a live subtitle-only test of the example video:
PI_YOUTUBE_LIVE=1 node extensions/youtube-transcript/tests/transcript.test.mjs
```

Set `PI_TEST_HOST` to the Pi package directory if Pi is not installed in the
default global npm location. Live tests clean their downloaded artifacts too.
