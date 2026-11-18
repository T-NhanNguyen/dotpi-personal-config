/* Replaceable confirmation UI: no graph rules, persistence, or application state. */
(function () {
'use strict';
window.ReviewDeletionConfirmation = {
 open({preview, unstage, confirm, cancel}) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'max-width:760px;width:90%;max-height:85vh;overflow:auto;padding:24px;border:2px solid #b96978;border-radius:10px';
  let settled = false;
  const finish = action => {
   if (settled) return;
   settled = true; dialog.close(); dialog.remove(); action?.();
  };
  const text = (tag, value, parent = dialog) => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  text('h2', 'Permanently delete staged reviews?');
  text('p', 'This permanently removes records from JSONL. There is no archive or recovery copy. Cancel writes nothing.');
  for (const item of preview.selected) {
   const section = document.createElement('section'); dialog.append(section);
   text('h3', `${item.id} · ${item.title}`, section); text('pre', item.text, section).style.whiteSpace = 'pre-wrap';
   for (const conflict of preview.conflicts.filter(c => c.id === item.id)) text('p', `${item.id} · ${item.title} — ${conflict.reason}`, section).setAttribute('role', 'alert');
   const button = text('button', `Unstage ${item.id}`, section);
   button.onclick = () => finish(() => unstage(item.id));
  }
  text('h3', 'Changed surviving reviews');
  for (const change of preview.changes) text('p', `${change.id} · ${change.title}: [${change.before.join(', ')}] → ${change.after.length ? '['+change.after.join(', ')+']' : 'trace-level'}`);
  if (!preview.changes.length) text('p', 'No surviving parent connections change.');
  const dismiss = text('button', 'Cancel'); dismiss.onclick = () => finish(cancel);
  const count = preview.selected.length;
  const commit = text('button', `Permanently delete ${count} review${count === 1 ? '' : 's'}`); commit.disabled = !!preview.conflicts.length;
  // A refreshed 409 preview must receive a new trusted activation, never a
  // synthetic click or an automatic continuation of the previous request.
  commit.onclick = event => { if (event.isTrusted && !commit.disabled) finish(confirm); };
  dialog.addEventListener('close', () => finish(cancel), {once:true});
  document.body.append(dialog); dialog.showModal();
  return () => finish();
 }
};
})();
