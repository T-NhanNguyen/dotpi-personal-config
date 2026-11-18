/** Cross-process cooperating-writer contract: never steal locks, even after a crash.
 * An abandoned .mutation-lock requires operator inspection/removal while writers are stopped.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Kind, TraceRecord } from "./core.ts";

export const digest = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
export function withTraceLock<T>(file: string, action: () => T): T {
 fs.mkdirSync(path.dirname(file), { recursive: true });
 const lock = `${file}.mutation-lock`, deadline = Date.now() + 2000;
 for (;;) {
  try { fs.mkdirSync(lock); break; }
  catch (error) {
   if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
   if (Date.now() >= deadline) throw new Error("Trace is locked; retry later. Abandoned locks require manual inspection; locks are never stolen.");
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
 }
 try { return action(); } finally { fs.rmdirSync(lock); }
}
export interface RawEntry { record: TraceRecord | null; bytes: Buffer }
export function readStrict(file: string): { raw: Buffer; entries: RawEntry[] } {
 const raw = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
 const entries: RawEntry[] = [], ids = new Set<string>();
 let start = 0;
 for (let end = 0; end <= raw.length; end++) {
  if (end < raw.length && raw[end] !== 10) continue;
  const bytes = raw.subarray(start, end < raw.length ? end + 1 : end); start = end + 1;
  if (!bytes.toString("utf8").trim()) { if (bytes.length) entries.push({ record: null, bytes }); continue; }
  let record: TraceRecord;
  try { record = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Malformed JSONL; mutation blocked (including a malformed trailing record)."); }
  if (!record || typeof record.id !== "string" || ids.has(record.id)) throw new Error("Missing or duplicate record identity; mutation blocked.");
  ids.add(record.id); entries.push({ record, bytes });
 }
 return { raw, entries };
}
/** Must be called under withTraceLock. Reservations survive deletion, failed append and restart. */
export function reserveId(file: string, kind: Kind, records: TraceRecord[]): string {
 const ledger = `${file}.reserved-ids`, prefix = ({finding:"f",decision:"d",concept:"c",path:"p",evidence:"e",deadend:"x",review:"r"})[kind];
 const used = new Set(records.map(r => r.id));
 if (fs.existsSync(ledger)) {
  const text = fs.readFileSync(ledger, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("Incomplete ID reservation ledger; mutation blocked.");
  for (const line of text.split("\n").filter(Boolean)) {
   const id: unknown = JSON.parse(line);
   if (typeof id !== "string") throw new Error("Invalid ID reservation ledger; mutation blocked.");
   used.add(id);
  }
 }
 let n = 1; while (used.has(`${prefix}${n}`)) n++;
 const id = `${prefix}${n}`; persistIds(file, [id]); return id;
}
export function persistIds(file: string, ids: string[]): void {
 const fd = fs.openSync(`${file}.reserved-ids`, "a");
 try { fs.writeFileSync(fd, ids.map(id => JSON.stringify(id)).join("\n") + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
 // The first reservation also creates a directory entry. Persist it before any
 // destructive replacement can remove the only live copy of an identity.
 const directory = fs.openSync(path.dirname(file), "r");
 try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function appendRecord(file: string, record: TraceRecord, raw: Buffer): void {
 fs.appendFileSync(file, `${raw.length && raw[raw.length - 1] !== 10 ? "\n" : ""}${JSON.stringify(record)}\n`, "utf8");
}
export function replaceAtomic(file: string, bytes: Buffer): void {
 const temp = path.join(path.dirname(file), `.trace-${randomUUID()}.tmp`);
 try {
  const fd = fs.openSync(temp, "wx", fs.statSync(file).mode & 0o777);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
 } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
