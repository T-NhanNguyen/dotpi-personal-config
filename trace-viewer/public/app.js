/* Live same-origin adapter. The server owns records and review persistence. */
(function () {
'use strict';
const colors = {finding:'#e96847',decision:'#689078',review:'#4e78d5',concept:'#9c79b7',path:'#b68a38',evidence:'#459d9a',deadend:'#b96978'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scopedURL = (trace, suffix, vault) => `/api/trace/${encodeURIComponent(trace)}${suffix}${vault ? `?vault=${encodeURIComponent(vault)}` : ''}`;
function hydrate(graph, records) {
 const byId = new Map(records.map(record => [record.id, record]));
 return graph.nodes.map(node => {
  const record = byId.get(node.id);
  if (!record) throw new Error(`Missing full record: ${node.id}`);
  return {...record, type:record.kind, time:record.ts || ''};
 });
}
const timestampDisplay = new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
// Display only: retain original timestamps in records and file ordering.
function formatTimestamp(value) {
 if (value === null || value === undefined || value === '') return 'Not recorded';
 if (typeof value !== 'string') return 'Invalid timestamp';
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : timestampDisplay.format(date);
}
// Export pure boundary helpers for focused tests without a DOM or network.
if (typeof module === 'object') module.exports = {esc, scopedURL, hydrate, colors, formatTimestamp};
if (typeof document === 'undefined') return;
const $ = id => document.getElementById(id);
let vaults = [], known = [], traces = [], vault = null, traceId = null;
let nodes = [], edges = [], patterns = [], selected = null, pattern = null;
let recordSnapshots = new Map();
let query = '', filter = 'all', mode = 'graph', detailTab = 'detail';
let zoom = 1, pan = {x:0,y:0}, geometry = null, center = {x:0,y:0};
let status = 'Loading vaults…', error = '', epoch = 0, controller = null;
let session = {state:'idle'}, posting = false;
// One active scope only: navigation must never move a draft into another vault/trace.
let reviewDraft = null;
// Ephemeral, one-scope selections. Staged records remain in every view until commit.
let stagedDeletions = [], deleting = false, deletionPreview = null;
function closeDeletionPreview() {
 const active = deletionPreview; deletionPreview = null; active?.close?.();
}
function leaveDeletionScope() {
 if (deleting) { toast('Wait for deletion to finish before navigating.'); return false; }
 if (stagedDeletions.length && !window.confirm('Discard staged review deletions and navigate? Nothing has been deleted.')) return false;
 closeDeletionPreview(); stagedDeletions = []; return true;
}
window.addEventListener?.('beforeunload', event => { if (stagedDeletions.length || deleting) { event.preventDefault(); event.returnValue = ''; } });
async function previewDeletions() {
 if (!stagedDeletions.length || deleting || posting || deletionPreview) return;
 const version = epoch, id = traceId, path = vault, selection = stagedDeletions.slice();
 const active = {close:null}; deletionPreview = active;
 const sameScope = () => version === epoch && id === traceId && path === vault;
 const current = () => deletionPreview === active && sameScope() && JSON.stringify(selection) === JSON.stringify(stagedDeletions);
 const cancel = () => { if (deletionPreview === active) { closeDeletionPreview(); renderDetails(); } };
 const show = preview => {
  if (!current()) return;
  active.close = ReviewDeletionConfirmation.open({preview, cancel,
   unstage: item => {
    if (!current()) return;
    closeDeletionPreview(); stagedDeletions = stagedDeletions.filter(s => s.id !== item);
    render(); previewDeletions();
   },
   confirm: async () => {
    if (!current() || deleting || posting) return;
    active.close = null; deleting = true; renderDetails();
    try {
     const response = await fetch(scopedURL(id, '/review-deletions/commit', path), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection,authorization:preview.authorization})});
     const result = await response.json();
     if (!current()) return;
     if (response.status === 409 && result.preview) { deleting = false; toast(result.error); show(result.preview); return; }
     if (!response.ok) throw new Error(result.error || 'Deletion failed.');
     closeDeletionPreview(); stagedDeletions = []; deleting = false; toast('Reviews permanently deleted.'); await loadTrace(id, selected);
    } catch (problem) {
     if (current()) { closeDeletionPreview(); toast(`Deletion not confirmed: ${problem.message}. Refresh before retrying if the response was lost.`); }
    } finally { if (sameScope()) { deleting = false; renderDetails(); } }
   }
  });
 };
 renderDetails();
 try {
  const result = await request(scopedURL(id, '/review-deletions/preview', path), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection})});
  show(result.preview);
 } catch (problem) {
  if (current()) {
   closeDeletionPreview();
   const message = problem.status === 404 && problem.message === 'not found'
    ? 'This viewer server lacks deletion previews. Reopen with /trace-view, then restage your reviews. Nothing has been deleted.'
    : `Cannot preview deletion: ${problem.message}`;
   toast(message); renderDetails();
  }
 }
}
function scopeReviewDraft() {
 if (reviewDraft?.vault === vault && reviewDraft?.trace === traceId) return;
 reviewDraft = {vault, trace:traceId, text:'', targetIds:null, failureClass:'', error:''};
}
const ordered = () => nodes; // JSONL order, not timestamp order.
const matches = n => (filter === 'all' || n.kind === filter) && (!pattern || n.failureClass === pattern) && `${n.id} ${n.title} ${n.body} ${n.failureClass || ''}`.toLowerCase().includes(query.toLowerCase());
const visibleSupportEdges = () => (geometry?.edges || []).filter(edge => matches(nodes.find(n => n.id === edge.source)) && matches(nodes.find(n => n.id === edge.target)));
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 6000); }
async function request(url, options = {}) {
 const response = await fetch(url, options);
 const body = await response.json().catch(() => null);
 if (!response.ok) { const problem = new Error(body?.error || `${response.status} ${response.statusText}`); problem.status = response.status; throw problem; }
 return body;
}
function begin() {
 closeDeletionPreview();
 controller?.abort(); controller = new AbortController(); epoch++;
 nodes = []; edges = []; patterns = []; selected = null; geometry = null; recordSnapshots = new Map();
 session = {state:'idle'}; posting = false; error = ''; status = 'Loading…';
 return {version:epoch, signal:controller.signal};
}
function resetView() {
 query = ''; filter = 'all'; pattern = null; detailTab = 'detail'; zoom = 1; pan = {x:0,y:0};
 $('search').value = ''; $('filter').value = 'all';
 $('filter').dispatchEvent?.(new Event('input'));
}
function updateURL() {
 const url = new URL(location.href);
 if (traceId) url.searchParams.set('trace', traceId); else url.searchParams.delete('trace');
 if (vault) url.searchParams.set('vault', vault); else url.searchParams.delete('vault');
 history.replaceState(null, '', url);
}
function report(problem, version) {
 if (version !== epoch || problem.name === 'AbortError') return;
 status = ''; error = problem.message; render();
}
async function switchVault(path, requestedTrace = null) {
 // Reloading even the same vault can choose a different default trace.
 if (!leaveDeletionScope()) { renderSidebar(); return; }
 vault = path; traceId = null; traces = []; scopeReviewDraft(); resetView();
 const {version, signal} = begin(); render();
 try {
  const list = await request(`/api/traces?vault=${encodeURIComponent(vault)}`, {signal});
  if (version !== epoch) return;
  traces = list; status = ''; traceId = requestedTrace || list[0]?.trace || null;
  updateURL();
  if (traceId) await loadTrace(traceId); else render();
 } catch (problem) { report(problem, version); }
}
async function loadTrace(id, keepSelection = null) {
 if (deleting) { toast('Wait for deletion to finish before refreshing.'); return; }
 if (id !== traceId && !leaveDeletionScope()) return;
 traceId = id; scopeReviewDraft();
 const {version, signal} = begin(); updateURL(); render();
 const url = suffix => scopedURL(id, suffix, vault);
 try {
  const [graph, groups] = await Promise.all([request(url(''), {signal}), request(url('/patterns'), {signal})]);
  // Bound parallel detail reads; graph summaries intentionally omit body/evidence.
  const records = new Array(graph.nodes.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(6, graph.nodes.length)}, async () => {
   while (next < graph.nodes.length) { const index = next++; records[index] = await request(url(`/record/${encodeURIComponent(graph.nodes[index].id)}`), {signal}); }
  }));
  if (version !== epoch) return;
  recordSnapshots = new Map(records.map(record => [record.id, record]));
  nodes = hydrate(graph, records); edges = graph.edges; patterns = groups;
  selected = nodes.some(n => n.id === keepSelection) ? keepSelection : nodes[0]?.id || null;
  geometry = OrganicGraph.layoutLive(nodes, edges); status = '';
  session = {state:graph.session ? 'idle' : 'empty'};
  const summary = traces.find(t => t.trace === id); if (summary) summary.recordCount = nodes.length;
  focusSelection(); render(); if (detailTab === 'session') loadSession();
 } catch (problem) { report(problem, version); }
}
async function loadSession() {
 if (session.state !== 'idle') return;
 const version = epoch; session = {state:'loading'}; renderDetails();
 try {
  const data = await request(scopedURL(traceId, '/session', vault), {signal:controller.signal});
  if (version !== epoch) return;
  session = {state:'ready', data}; renderDetails();
 } catch (problem) {
  if (version !== epoch || problem.name === 'AbortError') return;
  session = problem.status === 404 ? {state:'empty'} : {state:'error', message:problem.message}; renderDetails();
 }
}
function focusSelection() {
 const viewport = $('graph'), n = geometry?.nodes.find(n => n.id === selected);
 if (!n) return;
 zoom = 1; pan = {x:0,y:0};
 // Render establishes the viewport transform, then translate the selected card.
 renderGraph();
 pan = {x:viewport.clientWidth/2-(center.x+(n.cx+80-geometry.bounds.x-geometry.bounds.width/2)*zoom),y:viewport.clientHeight/2+25-(center.y+(n.cy+42-geometry.bounds.y-geometry.bounds.height/2)*zoom)};
}
function select(id) { selected = id; focusSelection(); render(); }
function renderSidebar() {
 $('vaultSelect').innerHTML = vaults.map(v => `<option value="${esc(v.path)}" ${v.path === vault ? 'selected' : ''}>${esc(v.name)} · ${v.traceCount} traces</option>`).join('');
 $('knownVaults').innerHTML = `<option value="">${known.some(v=>!v.loaded) ? 'Choose a discovered vault…' : 'No additional discovered vaults'}</option>` + known.filter(v => !v.loaded).map(v => `<option value="${esc(v.path)}">${esc(v.name)} — ${esc(v.path)}</option>`).join('');
 $('traceList').innerHTML = traces.map(t => `<button class="trace-choice ${t.trace === traceId ? 'chosen' : ''}" data-trace="${esc(t.trace)}"><span class="trace-choice-icon">⑂</span><span><strong title="${esc(t.trace)}">${esc(t.trace)}</strong><small>${esc(t.recordCount)} records${t.created ? ' · '+esc(formatTimestamp(t.created)) : ''}</small></span></button>`).join('') || '<p class="local-note">No traces loaded.</p>';
 document.querySelectorAll('[data-trace]').forEach(button => button.onclick = () => { resetView(); loadTrace(button.dataset.trace); });
 $('patternList').innerHTML = `<button data-pattern="" class="${!pattern ? 'active' : ''}">◎ All records</button>` + patterns.map(p => `<button data-pattern="${esc(p.failureClass)}" class="${pattern === p.failureClass ? 'active' : ''}">${esc(p.failureClass)} · ${esc(p.count)} ${p.count === 1 ? 'record' : 'records'}<small>${esc(p.traceCount)} ${p.traceCount === 1 ? 'trace' : 'traces'} · ${esc(p.agents.join(', ') || 'No agent metadata')}</small></button><details><summary class="local-note">View tagged records across vault</summary>${p.records.map(r => `<button data-pattern-trace="${esc(r.trace)}" data-pattern-record="${esc(r.id)}">${esc(r.trace+' / '+r.id)}<small>${esc(r.kind+' · '+r.title)}</small></button>`).join('')}</details>`).join('') + (!patterns.length ? '<p class="local-note">No tagged records in this vault.</p>' : '');
 document.querySelectorAll('[data-pattern]').forEach(button => button.onclick = () => { pattern = button.dataset.pattern || null; render(); });
 document.querySelectorAll('[data-pattern-trace]').forEach(button => button.onclick = () => { resetView(); loadTrace(button.dataset.patternTrace, button.dataset.patternRecord); });
 $('traceTitle').textContent = traceId ? traceId.replace(/[-_]+/g,' ').replace(/^./,c=>c.toUpperCase()) : 'Trace viewer';
 $('traceSubtitle').textContent = 'Read left to right. Select a record for evidence, session context, or review.';
 $('vaultSelect').title = vault || 'No loaded vault';
 $('vaultLocation').textContent = vault || 'No vault loaded';
 $('vaultLocation').title = vault || 'No vault loaded';
 $('copyVaultPath').disabled = !vault;
}
function renderGraph() {
 const svg = $('graphSvg'), viewport = $('graph');
 const width = viewport.clientWidth || 700, height = viewport.clientHeight || 525;
 svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
 const message = error ? `Unable to load: ${error}` : status || (!nodes.length ? (traceId ? 'No records in this trace.' : 'No traces in this vault.') : !nodes.some(matches) ? 'No matching records. Clear filters to see all records.' : '');
 $('empty').hidden = !message; $('empty').textContent = message;
 if (!geometry || !nodes.length) { svg.innerHTML = ''; return; }
 const bounds = geometry.bounds;
 const fit = 1; // Zoom is the actual scale, not an undisclosed fit multiplier.
 center = {x:width/2, y:94+(height-128)/2};
 const byId = new Map(geometry.nodes.map(n => [n.id,n]));
 const paths = geometry.edges.map(edge => `<path class="support-edge" data-source="${esc(edge.source)}" data-target="${esc(edge.target)}" d="${OrganicGraph.path(edge.curve)}" fill="none" stroke="${colors[byId.get(edge.source).kind] || '#9c79b7'}" stroke-width="2.5" marker-end="url(#arrow)" opacity="${matches(byId.get(edge.source)) && matches(byId.get(edge.target)) ? '.7' : '.1'}"><title>${esc(edge.source)} supports ${esc(edge.target)}</title></path>`).join('');
 svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="none" stroke="#89957d"/></marker></defs><g transform="translate(${pan.x+center.x} ${pan.y+center.y}) scale(${fit*zoom}) translate(${-bounds.x-bounds.width/2} ${-bounds.y-bounds.height/2})">${geometry.sequence.map(edge => `<path class="sequence-edge" data-source="${esc(edge.source)}" data-target="${esc(edge.target)}" d="${OrganicGraph.path(edge.curve)}" fill="none" stroke="#e96847" stroke-width="3"><title>File order only: ${esc(edge.source)} → ${esc(edge.target)}</title></path>`).join('')}${paths}${geometry.nodes.map(n => {
  const color = colors[n.kind] || '#9c79b7';
  const words = String(n.title).match(/.{1,22}(?:\s|$)|.{1,22}/g) || [''];
  return `<g class="node ${n.layoutParent ? 'branch-node' : 'main-node'} ${n.id === selected ? 'selected' : ''} ${matches(n) ? '' : 'fade'}" data-id="${esc(n.id)}" data-staged="${stagedDeletions.some(s => s.id === n.id)}" data-layout-parent="${esc(n.layoutParent || '')}" role="button" tabindex="0" aria-label="${esc(n.kind+' '+n.id+': '+n.title)}" aria-pressed="${n.id === selected}"><path d="M${n.x} ${n.y} L${n.cx+80} ${n.cy+40}" stroke="#dbe1d2" stroke-dasharray="2 4"/><rect class="node-card" x="${n.cx}" y="${n.cy}" width="161" height="83" rx="8"/><circle cx="${n.cx+14}" cy="${n.cy+18}" r="3" fill="${color}"/><text x="${n.cx+23}" y="${n.cy+21}" font-size="9" fill="${color}">${esc(n.kind)}</text><text x="${n.cx+146}" y="${n.cy+21}" text-anchor="end" font-size="8" fill="#a5ae98">${esc(n.id)}${stagedDeletions.some(s => s.id === n.id) ? ' [staged]' : ''}</text>${words.slice(0,2).map((line,i) => `<text x="${n.cx+12}" y="${n.cy+40+i*13}" font-size="12" fill="#5a6650">${esc(line)}</text>`).join('')}<text x="${n.cx+12}" y="${n.cy+73}" font-size="8" fill="#a0aa93">${esc(formatTimestamp(n.time))}</text><ellipse cx="${n.x}" cy="${n.y+4}" rx="11" ry="7" fill="${color}"/><ellipse cx="${n.x}" cy="${n.y}" rx="11" ry="7" fill="white" stroke="${color}" stroke-width="2.5"/></g>`;
 }).join('')}</g>`;
 svg.querySelectorAll('[data-id]').forEach(element => { element.onclick = () => select(element.dataset.id); element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(element.dataset.id); } }; });
 $('zoomValue').textContent = Math.round(zoom*100)+'%';
}
const block = (label, value) => `<div class="evidence-block"><div class="section-label">${label}</div><pre>${esc(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre></div>`;
function renderDetails() {
 $('details').innerHTML = `<div class="detail-tabs" role="tablist">${['detail','session','review'].map(tab => `<button role="tab" data-tab="${tab}" aria-selected="${detailTab === tab}" class="${detailTab === tab ? 'selected' : ''}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join('')}</div><div id="detailContent"></div>`;
 document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { detailTab = button.dataset.tab; renderDetails(); if (detailTab === 'session') loadSession(); });
 const content = $('detailContent'), n = nodes.find(item => item.id === selected);
 if (detailTab === 'detail' && stagedDeletions.length) {
  const batch = document.createElement('div');
  const undo = stagedDeletions.find(s => s.id === selected) || stagedDeletions[stagedDeletions.length - 1];
  batch.className = 'deletion-batch';
  batch.innerHTML = `<p class="local-note" role="status">${stagedDeletions.length} staged for deletion · not deleted</p><div class="segmented-control deletion-actions" role="group" aria-label="Staged review deletions"><button data-unstage="${esc(undo.id)}" title="Undo staged deletion of ${esc(undo.id)}" aria-label="Undo staged deletion of ${esc(undo.id)}" ${deleting ? 'disabled' : ''}>Undo</button><button id="previewDeletions" title="Review staged deletions before confirming" ${deleting || posting || deletionPreview ? 'disabled' : ''}>Review</button><button id="cancelDeletions" title="Cancel all staged deletions" ${deleting ? 'disabled' : ''}>Cancel</button></div>`;
  content.before(batch);
  batch.querySelectorAll('[data-unstage]').forEach(b => { b.onclick = () => { closeDeletionPreview(); stagedDeletions = stagedDeletions.filter(s => s.id !== b.dataset.unstage); render(); }; });
  $('previewDeletions').onclick = previewDeletions; $('cancelDeletions').onclick = () => { closeDeletionPreview(); stagedDeletions = []; render(); };
 }
 if (!n) { content.innerHTML = `<p class="detail-text">${esc(error || status || 'Select a record to view its context.')}</p>`; return; }
 if (detailTab === 'session') {
  content.innerHTML = '<div class="detail-top">TRACE SESSION TRANSCRIPT</div><p class="local-note">The server selects the most common session attached to this trace. Record-specific session IDs remain visible in Detail.</p>';
  if (session.state === 'ready') content.innerHTML += `<h2>${esc(session.data.sessionId)}</h2>` + (session.data.messages.map(message => `<div class="evidence-block"><strong>${esc(message.role)}</strong><small>${esc(formatTimestamp(message.ts))}</small><pre>${esc(message.text)}</pre></div>`).join('') || '<p class="detail-text">This session has no messages.</p>');
  else content.innerHTML += `<p class="detail-text">${esc(session.state === 'error' ? session.message : session.state === 'empty' ? 'No session transcript available for this trace.' : 'Loading session…')}</p>`;
  content.innerHTML += `<button id="refreshSession" class="outline-button" ${session.state === 'loading' ? 'disabled' : ''}>${session.state === 'loading' ? 'Refreshing…' : session.state === 'error' ? 'Retry session' : 'Refresh session'}</button>`;
  $('refreshSession').onclick = () => { if (session.state === 'loading') return; session = {state:'idle'}; loadSession(); };
  return;
 }
 if (detailTab === 'review') {
  scopeReviewDraft();
  const draft = reviewDraft;
  if (draft.targetIds === null) draft.targetIds = [n.id];
  const reviews = nodes.filter(r => r.kind === 'review' && r.id !== n.id && r.supports?.includes(n.id));
  content.innerHTML = `<div class="detail-top">PERSISTED REVIEWS</div>${n.kind !== 'review' ? `<h2>${esc(n.title)}</h2>` : ''}${reviews.map(r => `<div class="review-card"><span class="trace-id">${esc(r.id)}</span><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p></div>`).join('') || (n.kind !== 'review' ? '<p class="detail-text">No reviews for this record.</p>' : '')}<form id="reviewForm"><label>Review targets<select id="reviewTargets" multiple required size="5">${nodes.map(r => `<option value="${esc(r.id)}" ${draft.targetIds.includes(r.id) ? 'selected' : ''}>${esc(r.id+' · '+r.title)}</option>`).join('')}</select></label><label>Review text<textarea id="reviewText" required rows="4">${esc(draft.text)}</textarea></label><label>Tag (optional)<input id="failureClass" value="${esc(draft.failureClass)}" pattern="[a-z0-9][a-z0-9._-]*" placeholder="e.g. navigation-feedback"></label><p class="local-note">Reviews are saved to the vault by the server. Comments, new findings/decisions, and resolve actions are not supported by this API.</p>${draft.error ? `<p role="alert" class="local-note">${esc(draft.error)}</p>` : ''}<button class="primary" type="submit" ${posting || deleting ? 'disabled' : ''}>${posting ? 'Saving…' : 'Save review ↗'}</button></form>`;
  $('reviewText').oninput = event => { draft.text = event.target.value; };
  $('reviewTargets').onchange = event => { draft.targetIds = Array.from(event.target.selectedOptions, option => option.value); };
  $('failureClass').oninput = event => { draft.failureClass = event.target.value; };
  $('reviewForm').onsubmit = submitReview; return;
 }
 const connections = edges.filter(edge => edge.source === n.id || edge.target === n.id);
 content.innerHTML = `<div class="detail-top">RECORD DETAIL</div><span class="type-tag ${esc(n.kind)}">${esc(n.kind)}</span><span class="trace-id">${esc(n.id)}</span><h2>${esc(n.title)}</h2><p class="detail-text">${esc(n.body)}</p><div class="detail-meta">${[['Agent',n.agent],['Timestamp',formatTimestamp(n.ts)],['Confidence',n.confidence],['Tag',n.failureClass],['Session',n.session]].map(([label,value]) => `<div><label>${label}</label>${esc(value || 'Not recorded')}</div>`).join('')}</div>${n.steps ? block('ORDERED STEPS',n.steps) : ''}<div class="connections"><div class="section-label">SUPPORT CONNECTIONS · ${connections.length}</div>${connections.map(edge => { const other = edge.source === n.id ? edge.target : edge.source; return `<button class="connection" data-select="${esc(other)}" ${nodes.some(item=>item.id===other)?'':'disabled title="Referenced record is not present in this trace"'}>${esc(edge.source)} → ${esc(edge.target)}<small>supports</small></button>`; }).join('') || '<p class="local-note">No support edges.</p>'}</div><button id="reviewAction" class="outline-button">Write a review</button>${n.kind === 'review' ? `<button id="stageReviewDeletion" class="outline-button" ${deleting ? 'disabled' : ''}>${stagedDeletions.some(s => s.id === n.id) ? 'Undo staged deletion' : 'Stage review deletion'}</button>` : ''}`;
 content.querySelectorAll('[data-select]').forEach(button => button.onclick = () => select(button.dataset.select));
 $('reviewAction').onclick = () => { detailTab = 'review'; renderDetails(); };
 if (n.kind === 'review') {
  const action = $('stageReviewDeletion'), staged = stagedDeletions.some(s => s.id === n.id);
  action.onclick = () => {
   closeDeletionPreview();
   if (staged) stagedDeletions = stagedDeletions.filter(s => s.id !== n.id);
   else stagedDeletions.push({id:n.id, snapshot:recordSnapshots.get(n.id)});
   render();
  };
 }
}
async function submitReview(event) {
 event.preventDefault(); if (posting || deleting) return;
 closeDeletionPreview();
 const text = $('reviewText').value.trim(), targetIds = Array.from($('reviewTargets').selectedOptions, option => option.value), failureClass = $('failureClass').value.trim();
 if (!text || !targetIds.length) { toast('Select at least one target and enter review text.'); return; }
 const version = epoch, id = traceId, path = vault, previous = selected, draft = reviewDraft;
 // Capture even programmatic field edits before replacing the form.
 Object.assign(draft, {text:$('reviewText').value, targetIds, failureClass:$('failureClass').value, error:''});
 posting = true; renderDetails();
 try {
  // Do not abort a write on navigation: an aborted response cannot undo persistence.
  await request(scopedURL(id, '/review', path), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({targetIds,text,...(failureClass ? {failureClass} : {})})});
  if (version !== epoch) return;
  Object.assign(draft, {text:'', targetIds:null, failureClass:'', error:''});
  toast('Review saved. Refreshing records and patterns…');
  await loadTrace(id, previous);
 } catch (problem) {
  if (version !== epoch) return;
  draft.error = `Review was not confirmed: ${problem.message}`;
  posting = false; toast(draft.error);
  // Render from state: the submitting form may have been detached by navigation.
  renderDetails();
 }
}
function renderDataCheck() {
 const valid=geometry?.edges || [], dangling=geometry?.danglingEdges || [];
 const visible=visibleSupportEdges();
 const raw=nodes.reduce((sum,n)=>sum+(n.supports?.length||0),0);
 const pairs=direction=>edges.filter(e=>e[direction]===selected).map(e=>`${e.source} → ${e.target}`).join('\n') || 'None';
 $('dataCheckContent').innerHTML=`<p>Main sequence: file order, not support (solid orange). Targeted reviews branch beside target; replies branch from review. Arrows: recorded source → supported target. Position is not strength or elapsed time. Verified means a check is attached, not global truth.</p><p>${nodes.length} raw records · ${new Set(nodes.map(n=>n.id)).size} rendered IDs · ${nodes.filter(matches).length} matching. ${raw} raw support entries · ${valid.length} drawn valid edges · ${dangling.length} dangling · ${valid.length-visible.length} filtered (dimmed).</p>${!raw?'<p>No recorded support connections; dashed line is file order only.</p>':''}<p>Selected ${esc(selected || 'none')}</p>${block('OUTGOING EXACT PAIRS',pairs('source'))}${block('INCOMING EXACT PAIRS',pairs('target'))}${dangling.length?block('DANGLING EXACT PAIRS',dangling.map(e=>`${e.source} → ${e.target}`).join('\n')):''}`;
}
function render() {
 renderSidebar(); renderGraph(); renderDetails();
 $('totalcount').textContent = nodes.length; $('matchingcount').textContent = nodes.filter(matches).length; $('branchcount').textContent = visibleSupportEdges().length;
 renderDataCheck();
 const items = ordered(), index = items.findIndex(n => n.id === selected);
 $('step').textContent = `${index+1} / ${items.length}`;
 $('progress').innerHTML = items.map(n => `<button data-step="${esc(n.id)}" class="${n.id === selected ? 'current' : ''}" aria-label="${esc(n.title)}" title="${esc(n.title)}"></button>`).join('');
 document.querySelectorAll('[data-step]').forEach(button => button.onclick = () => select(button.dataset.step));
 $('timeline').innerHTML = items.filter(matches).map(n => `<button class="timeline-item ${n.id === selected ? 'selected' : ''}" data-row="${esc(n.id)}"><span class="time">${esc(formatTimestamp(n.time))}</span><span style="color:${colors[n.kind] || '#9c79b7'}">●</span><span><strong>${esc(n.title)}</strong><small>${esc(n.kind+' · '+n.id+(stagedDeletions.some(s => s.id === n.id) ? ' · staged for deletion' : ''))}</small></span></button>`).join('') || `<p class="detail-text">${esc(error || status || 'No matching records.')}</p>`;
 document.querySelectorAll('[data-row]').forEach(button => button.onclick = () => select(button.dataset.row));
 $('prev').disabled = index <= 0; $('next').disabled = index < 0 || index >= items.length-1;
 $('retryLoad').hidden = !error;
}
// Layout-only controls deliberately leave trace, viewport, and draft state alone.
PanelToggle.mount({button:$('sidebarToggle'), content:$('sidebarContent'), side:'left', label:'sidebar',
 onChange:collapsed => document.body.classList.toggle('sidebar-collapsed', collapsed)});
PanelToggle.mount({button:$('detailsToggle'), content:$('details'), side:'right', label:'record panel',
 onChange:collapsed => $('detailsPanel').classList.toggle('is-collapsed', collapsed)});
$('copyVaultPath').onclick = async () => {
 const path = vault;
 if (!path) { toast('No vault path to copy.'); return; }
 try {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(path);
  toast('Vault path copied.');
 } catch {
  toast('Unable to copy vault path. Check clipboard permissions.');
 }
};
$('search').oninput = event => { query = event.target.value; render(); };
$('filter').innerHTML = '<option value="all">All types</option>' + Object.keys(colors).map(kind => `<option value="${kind}">${kind[0].toUpperCase()+kind.slice(1)}</option>`).join('');
$('filter').onchange = event => { filter = event.target.value; const first=nodes.find(matches); if(first){selected=first.id;focusSelection();} render(); };
$('clearFilters').onclick = () => { resetView(); focusSelection(); render(); };
$('readable').onclick = () => { focusSelection(); renderGraph(); };
$('viewerLegends').innerHTML = `<div class="legend">${Object.entries(colors).map(([kind,color]) => `<span><i style="background:${color}"></i>${kind}</span>`).join('')}</div>`;
function setMode(value) { mode = value; $('graph').hidden = mode !== 'graph'; $('timeline').hidden = mode !== 'timeline'; $('graphTab').classList.toggle('selected',mode === 'graph'); $('timelineTab').classList.toggle('selected',mode === 'timeline'); $('graphControls').hidden = mode !== 'graph'; $('viewerLegends').hidden = mode !== 'graph'; renderGraph(); }
$('graphTab').onclick = () => setMode('graph'); $('timelineTab').onclick = () => setMode('timeline');
function zoomAt(next, anchor = {x:$('graph').clientWidth/2,y:$('graph').clientHeight/2}) { next = Math.max(.01,Math.min(6,next)); if (anchor) { const ratio = next/zoom; pan = {x:anchor.x-center.x-(anchor.x-pan.x-center.x)*ratio,y:anchor.y-center.y-(anchor.y-pan.y-center.y)*ratio}; } zoom = next; renderGraph(); }
$('zoomIn').onclick = () => zoomAt(zoom+.2); $('zoomOut').onclick = () => zoomAt(zoom-.2); $('reset').onclick = () => { if (!geometry) return; const b=geometry.bounds; zoom=Math.max(.01,Math.min(($('graph').clientWidth-56)/b.width,($('graph').clientHeight-150)/b.height)); pan={x:0,y:0}; renderGraph(); };
$('graph').addEventListener('wheel', event => { event.preventDefault(); const matrix = $('graphSvg').getScreenCTM(); if (matrix) zoomAt(zoom*Math.exp(-Math.max(-300,Math.min(300,event.deltaY))*.002),new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse())); }, {passive:false});
let dragging = null;
$('graph').onpointerdown = event => { if (event.target.closest('.node')) return; dragging = {x:event.clientX,y:event.clientY,px:pan.x,py:pan.y}; $('graph').setPointerCapture(event.pointerId); };
$('graph').onpointermove = event => { if (!dragging) return; const matrix = $('graphSvg').getScreenCTM(), scale = matrix ? 1/matrix.a : 1; pan = {x:dragging.px+(event.clientX-dragging.x)*scale,y:dragging.py+(event.clientY-dragging.y)*scale}; renderGraph(); };
$('graph').onpointerup = $('graph').onpointercancel = () => { dragging = null; };
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.visual-column').requestFullscreen(); } catch { document.querySelector('.visual-column').classList.toggle('expanded'); } renderGraph(); };
function move(delta) { const items = ordered(), index = items.findIndex(n => n.id === selected); const item = items[index+delta]; if (item) select(item.id); }
$('prev').onclick = () => move(-1); $('next').onclick = () => move(1);
document.addEventListener('keydown', event => { if (['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName)) return; if (event.key === 'ArrowRight') move(1); if (event.key === 'ArrowLeft') move(-1); if (event.key === 'Escape') document.querySelector('.visual-column').classList.remove('expanded'); });
$('vaultSelect').onchange = event => switchVault(event.target.value);
$('knownVaults').onchange = event => { $('vaultPath').value = event.target.value; if (event.target.value) { $('vaultPath').focus(); toast('Vault path filled. Choose Load vault to open it.'); } };
$('vaultForm').onsubmit = async event => {
 event.preventDefault(); const path = $('vaultPath').value.trim(); if (!path) return;
 // Loading a vault persists configuration; ask before issuing that write.
 if (!leaveDeletionScope()) return;
 render();
 const version = epoch, button = event.target.querySelector('button'); button.disabled = true;
 try {
  const added = await request('/api/vaults', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});
  const loaded = await request('/api/vaults');
  if (version !== epoch) return;
  vaults = loaded; known = known.map(v => v.path === added.path ? {...v,loaded:true} : v); await switchVault(added.path);
 }
 catch (problem) { if (version === epoch) toast(`Cannot load vault: ${problem.message}`); }
 finally { button.disabled = false; }
};
$('retryLoad').onclick = () => { if (traceId) loadTrace(traceId); else if (vault) switchVault(vault); else start(); };
async function start() {
 const version = epoch;
 try {
  [vaults,known] = await Promise.all([request('/api/vaults'),request('/api/vaults/known')]);
  if (version !== epoch) return;
  const params = new URLSearchParams(location.search), wanted = params.get('vault');
  const initial = vaults.find(v => v.path === wanted) || (!wanted && (vaults.find(v => v.default) || vaults[0]));
  if (!initial) throw new Error(wanted ? 'Requested vault is not loaded. Add its absolute path using Load vault.' : 'The server returned no vaults.');
  await switchVault(initial.path, params.get('trace'));
 } catch (problem) { report(problem,version); }
}
render(); start();
new ResizeObserver(() => { if (mode === 'graph') renderGraph(); }).observe($('graph'));
})();
