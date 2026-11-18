/** Preview authorization is stateless, launch-specific, and bound to exact request scope/state. */
import * as path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { planReviewDeletion, type ReviewSelection } from "../extensions/traces/review-deletion.ts";
import { digest, readStrict, withTraceLock, persistIds, replaceAtomic } from "../extensions/traces/mutation.ts";
const secret = randomBytes(32);
function authorize(scope: string, revision: string, selection: ReviewSelection[]): string {
 return createHmac("sha256", secret).update(JSON.stringify([scope, revision, selection])).digest("hex");
}
/** HTTP boundary validates a nonempty unique selection and full prior review snapshots.
 * Omit authorization for preview only; every commit is all-or-nothing for JSONL.
 */
export function deleteReviews(root: string, trace: string, selection: ReviewSelection[], authorization?: string) {
 const file = path.join(root, trace, "trace.jsonl"), scope = JSON.stringify([path.resolve(root), trace]);
 return withTraceLock(file, () => {
  const {raw, entries} = readStrict(file);
  const records = entries.flatMap(e => e.record ? [e.record] : []);
  const revision = digest(raw), plan = planReviewDeletion(records, selection);
  const token = authorize(scope, revision, selection);
  const preview = {revision, authorization:token, ...plan};
  if (authorization === undefined) return {status:200, body:{preview}};
  const actual = Buffer.from(authorization), expected = Buffer.from(token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || plan.conflicts.length) return {status:409, body:{error:"Preview is stale or conflicted. Review refreshed effects and confirm again.", preview}};
  const deleted = new Set(selection.map(s => s.id)), changes = new Map(plan.changes.map(c => [c.id,c.after]));
  const bytes = Buffer.concat(entries.flatMap(entry => {
   if (!entry.record) return [entry.bytes];
   if (deleted.has(entry.record.id)) return [];
   const supports = changes.get(entry.record.id);
   if (!supports) return [entry.bytes];
   const record = {...entry.record};
   if (supports.length) record.supports = supports; else delete record.supports;
   return [Buffer.from(JSON.stringify(record) + (entry.bytes.at(-1) === 10 ? "\n" : ""))];
  }));
  // Reserve every historical identity before the destructive commit point. Failure may
  // consume reservations, but can never partially delete or permit identity reuse.
  persistIds(file, records.map(r => r.id));
  replaceAtomic(file, bytes);
  return {status:200, body:{deleted:[...deleted], revision:digest(bytes)}};
 });
}
