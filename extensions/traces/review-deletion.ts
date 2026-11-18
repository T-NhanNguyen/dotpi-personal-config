/** Pure deletion planning. Selection snapshots are retained across refreshed previews. */
import type { TraceRecord } from "./core.ts";
export interface ReviewSelection { id: string; snapshot: TraceRecord }
export function planReviewDeletion(records: TraceRecord[], selection: ReviewSelection[]) {
 const byId = new Map(records.map(r => [r.id, r]));
 const deleted = new Set(selection.map(s => s.id));
 const conflicts: {id:string; reason:string}[] = [];
 for (const item of selection) {
  const record = byId.get(item.id);
  let reason = !record ? "Review disappeared." : record.kind !== "review" ? "Record is no longer a review." :
   JSON.stringify(record) !== JSON.stringify(item.snapshot) ? "Selected review changed." : "";
  if (!reason && record?.supports !== undefined && (!Array.isArray(record.supports) || record.supports.some(id => typeof id !== "string"))) reason = "Selected review has invalid support targets.";
  if (!reason && records.some(r => r.kind !== "review" && Array.isArray(r.supports) && r.supports.includes(item.id))) reason = "Protected review: a non-review record directly supports it.";
  if (reason) conflicts.push({id:item.id, reason});
 }
 const changes: {id:string; title:string; before:string[]; after:string[]}[] = [];
 for (const record of records) {
  if (deleted.has(record.id) || record.kind !== "review" || !Array.isArray(record.supports) || !record.supports.some(id => deleted.has(id))) continue;
  const after: string[] = [], seen = new Set<string>();
  const add = (id: string) => { if (!seen.has(id)) { seen.add(id); after.push(id); } };
  const expanded = new Set<string>();
  const expand = (id: string) => {
   const pending = [id];
   while (pending.length) {
    const target = pending.pop()!;
    if (!deleted.has(target)) { if (target !== record.id && byId.has(target)) add(target); continue; }
    if (expanded.has(target)) continue;
    expanded.add(target);
    const parents = byId.get(target)?.supports;
    // Reverse the stack push to preserve recorded target order, without recursive
    // stack growth or repeated traversal of shared/cyclic deleted ancestors.
    if (Array.isArray(parents)) for (let i = parents.length - 1; i >= 0; i--) pending.push(parents[i]);
   }
  };
  for (const id of record.supports) {
   if (deleted.has(id)) expand(id); else add(id); // Preserve existing self-links, never introduce one.
  }
  changes.push({id:record.id, title:record.title, before:record.supports, after});
 }
 return { selected:selection.map(s => ({id:s.id, title:s.snapshot.title, text:s.snapshot.body})), conflicts, changes };
}
