// Focused tests for the supplied static frontend; no server or persistent vault writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../public/organic-layout.js', import.meta.url), 'utf8');
const panelSource = await readFile(new URL('../public/panel-toggle.js', import.meta.url), 'utf8');
function load(source) {
 const context = vm.createContext({module:{exports:{}}});
 vm.runInContext(source, context);
 return context.module.exports;
}
const helpers = load(appSource), layout = load(layoutSource);
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i=0; i<20; i++) await new Promise(resolve => setImmediate(resolve)); };
function element() {
 return {dataset:{},innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,clientWidth:900,clientHeight:525,
  classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},querySelectorAll(){return [];},
  querySelector(){return this;},selectedOptions:[]};
}
function mount(fetch, search='?trace=trace-a', replaceForms=false) {
 const elements = new Map();
 // Model the relevant browser lifecycle without a DOM dependency: innerHTML
 // detaches the old form and creates new controls with parsed initial values.
 const decode = value => value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 function replaceReview(html) {
  for (const id of ['reviewForm','reviewText','reviewTargets','failureClass']) {
   const old = elements.get(id); if (old) old.isConnected = false;
   elements.delete(id);
  }
  if (!html.includes('id="reviewForm"')) return;
  for (const id of ['reviewForm','reviewText','reviewTargets','failureClass']) {
   const control = element(); control.isConnected = true; elements.set(id,control);
  }
  get('reviewText').value = decode(html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1]);
  get('failureClass').value = decode(html.match(/id="failureClass" value="([^"]*)"/)[1]);
  get('reviewTargets').selectedOptions = [...html.matchAll(/<option value="([^"]*)" ([^>]*)>/g)]
   .filter(match=>match[2].includes('selected')).map(match=>({value:decode(match[1])}));
  const button = element(); button.disabled = /type="submit" disabled/.test(html);
  button.textContent = button.disabled ? 'Saving…' : 'Save review ↗';
  get('reviewForm').querySelector = selector => selector === '[type=submit]' ? button : null;
 }
 const get = id => {
  if (!elements.has(id)) {
   const node = element(); node.id = id; elements.set(id,node);
   if (replaceForms && id === 'detailContent') {
    let html = '';
    Object.defineProperty(node,'innerHTML',{get:()=>html,set:value=>{html=value; replaceReview(value);}});
   }
  }
  return elements.get(id);
 };
 const traceButtons = () => [...get('traceList').innerHTML.matchAll(/data-trace="([^"]+)"/g)].map(match=>{
  const button=get(`trace-choice-${match[1]}`); button.dataset={trace:decode(match[1])}; return button;
 });
 const document = {getElementById:get,querySelectorAll:selector=>selector === '[data-trace]' ? traceButtons() : selector === '[data-tab]' ? ['detail','session','review'].map(tab=>{const button=get(`tab-${tab}`);button.dataset={tab};return button;}) : [],querySelector:()=>get('column'),addEventListener(){}};
 const context = vm.createContext({document,window:{},URL,URLSearchParams,AbortController,fetch,
  history:{replaceState(_state,_unused,url){context.location.href=String(url);}},
  location:{href:'http://localhost/'+search,search},
  setTimeout:()=>1,clearTimeout(){},ResizeObserver:class {observe(){}},console});
 vm.runInContext(layoutSource,context); context.OrganicGraph = context.window.OrganicGraph;
 vm.runInContext(panelSource,context); context.PanelToggle = context.window.PanelToggle;
 vm.runInContext(appSource,context);
 return get;
}
const record = (id='f1', kind='finding') => ({id,kind,trace:'trace-a',title:'<img src=x onerror=alert(1)>',body:'real body <script>attack</script>',refs:[{type:'file',path:'a.ts',lines:'1-2'}],ts:'2026-01-01T00:00:00Z'});
function backend() {
 const calls = []; let reviews = [], delay = null;
 const session = {sessionId:'real-session',messages:[{role:'toolResult',text:'real <transcript>',ts:'2026-01-01'}]};
 const fetch = async (url, init={}) => {
  calls.push({url,init}); const parsed = new URL(url,'http://localhost');
  let body;
  if (url === '/api/vaults') body = [{path:'/a',name:'A',traceCount:1,default:true},{path:'/b',name:'B',traceCount:0,default:false}];
  else if (url === '/api/vaults/known') body = [];
  else if (parsed.pathname === '/api/traces') body = parsed.searchParams.get('vault') === '/b' ? [] : [{trace:'trace-a',recordCount:1,created:null}];
  else if (parsed.pathname.endsWith('/review')) {
   const input = JSON.parse(init.body); reviews.push({...record('r1','review'),body:input.text,supports:input.targetIds}); body = reviews.at(-1);
  } else if (parsed.pathname.endsWith('/patterns')) body = [];
  else if (parsed.pathname.endsWith('/session')) body = session;
  else if (parsed.pathname.includes('/record/')) {
   if (delay) await delay;
   body = parsed.pathname.endsWith('/r1') ? reviews[0] : record();
  } else body = {nodes:[record(),...reviews],edges:reviews.map(r=>({source:r.id,target:'f1'})),session:'real-session'};
  return {ok:true,json:async()=>body};
 };
 return {calls,fetch,session,setDelay(value){delay=value;}};
}

test('boundary helpers escape text, encode scope and require full records', () => {
 assert.equal(helpers.esc('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
 assert.equal(helpers.scopedURL('a/b','/patterns','/a b'), '/api/trace/a%2Fb/patterns?vault=%2Fa%20b');
 assert.throws(()=>helpers.hydrate({nodes:[{id:'missing'}]},[]),/Missing full record/);
 const full = {...record(),check:{method:'read',output:'checked'},steps:[{action:'inspect',ref:'a.ts'}]};
 assert.deepEqual(plain(helpers.hydrate({nodes:[{id:'f1'}]},[full]))[0],{...full,type:'finding',time:full.ts});
 assert.equal(Object.keys(helpers.colors).length,7);
});

test('layout retains multi-target, reverse, disconnected and self edges, without adjacency edges', () => {
 const records = [record('a'),record('b'),record('c'),record('isolated')];
 const edges = [{source:'c',target:'a'},{source:'c',target:'b'},{source:'a',target:'c'},{source:'b',target:'b'}];
 const geometry = layout.layoutLive(records,edges);
 assert.deepEqual(plain(geometry.edges.map(({source,target})=>({source,target}))),edges);
 assert.equal(geometry.nodes.length,4);
 assert(geometry.edges.every(edge=>!layout.path(edge.curve).includes('NaN')));
 const dangling = [{source:'a',target:'missing'},{source:'absent',target:'b'},{source:'absent',target:'missing'}];
 const raw = plain([...edges,...dangling]);
 const partial = layout.layoutLive(records,raw);
 assert.deepEqual(plain(partial.edges.map(({source,target})=>({source,target}))),edges);
 assert.deepEqual(plain(partial.danglingEdges),dangling);
 assert.deepEqual(raw,[...edges,...dangling], 'layout must not rewrite raw support metadata');
 assert.equal(partial.nodes.length,records.length);
 assert.equal(layout.layoutLive([],[]).edges.length,0);
});

test('40-record synthetic example and companion hydrate all kinds and preserve every support edge', async () => {
 for (const trace of ['ui-design-sample','ui-design-companion']) {
  const text = await readFile(new URL(`../examples/full-feature-workspace/.dev-vault/traces/${trace}/trace.jsonl`,import.meta.url),'utf8');
  const records = text.trim().split('\n').map(JSON.parse);
  const edges = records.flatMap(r=>(r.supports||[]).map(target=>({source:r.id,target})));
  const hydrated = helpers.hydrate({nodes:records.map(({id,kind,title,ts})=>({id,kind,title,ts}))},records);
  const geometry = layout.layoutLive(hydrated,edges);
  assert.equal(geometry.nodes.length,trace==='ui-design-sample'?40:2);
  assert.deepEqual(plain(geometry.edges.map(({source,target})=>({source,target}))),edges);
  for (const n of geometry.nodes) assert(n.refs.length && n.body);
 }
});

test('live boot scopes all trace requests, hydrates detail and escapes record HTML', async () => {
 const api = backend(), get = mount(api.fetch); await settle();
 assert.equal(get('totalcount').textContent,1);
 assert(get('detailContent').innerHTML.includes('real body &lt;script&gt;attack&lt;/script&gt;'));
 assert(!get('detailContent').innerHTML.includes('<img'));
 assert(get('detailContent').innerHTML.includes('Not recorded'));
 assert(!get('detailContent').innerHTML.includes('Resolved'));
 assert(api.calls.filter(c=>c.url.startsWith('/api/trace/')).every(c=>c.url.endsWith('?vault=%2Fa')));
 assert(get('filter').innerHTML.includes('deadend'));
});

test('record details omit source references and verification checks even when populated', async () => {
 const api = backend();
 const refs = [
  {type:'file',path:'src/source.ts',lines:'12-18',note:'source <script>unsafe</script>'},
  {type:'datasheet',path:'manual.pdf',page:'42',note:'pin mapping'},
  {type:'url',path:'https://example.test/?a=1&b=2'}
 ];
 const get = mount(async (url, init) => {
  const response = await api.fetch(url, init);
  if (!new URL(url, 'http://localhost').pathname.includes('/record/')) return response;
  return {...response,json:async()=>({...await response.json(),refs,check:{method:'read',output:'Hidden check output'}})};
 });
 await settle();
 const html = get('detailContent').innerHTML;
 assert(!html.includes('SOURCE REFERENCES'));
 assert(!html.includes('VERIFICATION CHECK'));
 for (const ref of refs) for (const value of Object.values(ref)) assert(!html.includes(helpers.esc(value)), value);
 assert(!html.includes('Hidden check output'));
});

test('session tab uses real roles, timestamps and escaped transcript text', async () => {
 const api=backend(), get=mount(api.fetch); await settle();
 get('tab-session').onclick(); await settle();
 assert(get('detailContent').innerHTML.includes('real-session'));
 assert(get('detailContent').innerHTML.includes('toolResult'));
 // Both VM contexts use the test process timezone; compare the shared display contract.
 assert(get('detailContent').innerHTML.includes(helpers.esc(helpers.formatTimestamp('2026-01-01'))));
 assert.equal(api.session.messages[0].ts,'2026-01-01');
 assert(get('detailContent').innerHTML.includes('real &lt;transcript&gt;'));
 assert(api.calls.some(c=>c.url === '/api/trace/trace-a/session?vault=%2Fa'));
});

test('session refresh fetches newly appended messages and prevents duplicate in-flight reads', async () => {
 const api = backend(); let reads = 0, release;
 const get = mount(async (url, init) => {
  if (new URL(url, 'http://localhost').pathname.endsWith('/session') && ++reads === 2) await new Promise(resolve => {release=resolve;});
  return api.fetch(url, init);
 });
 await settle(); get('tab-session').onclick(); await settle();
 assert(get('detailContent').innerHTML.includes('Refresh session'));
 api.session.messages.push({role:'user',text:'newly appended message',ts:'2026-01-02'});
 get('refreshSession').onclick(); await settle();
 assert.match(get('detailContent').innerHTML, /id="refreshSession"[^>]*disabled/);
 get('refreshSession').onclick();
 assert.equal(reads, 2);
 release(); await settle();
 assert(get('detailContent').innerHTML.includes('newly appended message'));
 assert.equal(reads, 2);
});

for (const status of [404,503]) test(`session refresh recovers from ${status === 404 ? 'an empty result' : 'an error'}`, async () => {
 const api = backend(); let reads = 0;
 const get = mount(async (url, init) => {
  if (new URL(url, 'http://localhost').pathname.endsWith('/session') && ++reads === 1) return {ok:false,status,json:async()=>({error:'Transcript unavailable'})};
  return api.fetch(url, init);
 });
 await settle(); get('tab-session').onclick(); await settle();
 assert(get('detailContent').innerHTML.includes(status === 404 ? 'No session transcript' : 'Transcript unavailable'));
 get('refreshSession').onclick(); await settle();
 assert.equal(reads,2);
 assert(get('detailContent').innerHTML.includes('real-session'));
});

test('late detail response cannot leak into another vault, even when fetch ignores abort', async () => {
 const api=backend(); let release;
 api.setDelay(new Promise(resolve=>{release=resolve;}));
 const get=mount(api.fetch); await settle();
 await get('vaultSelect').onchange({target:{value:'/b'}});
 release(); await settle();
 assert.equal(get('totalcount').textContent,0);
 assert.equal(get('traceTitle').textContent,'Trace viewer');
 assert(!get('detailContent').innerHTML.includes('real body'));
});

test('review persistence uses only POST, then reloads graph, full detail and patterns', async () => {
 const api=backend(), get=mount(api.fetch); await settle();
 get('reviewAction').onclick();
 get('reviewText').value='real review'; get('reviewTargets').selectedOptions=[{value:'f1'}]; get('failureClass').value='real-failure';
 await get('reviewForm').onsubmit({preventDefault(){},target:element()}); await settle();
 const writes=api.calls.filter(c=>c.init.method==='POST'); assert.equal(writes.length,1);
 assert.equal(writes[0].url,'/api/trace/trace-a/review?vault=%2Fa');
 assert.deepEqual(JSON.parse(writes[0].init.body),{targetIds:['f1'],text:'real review',failureClass:'real-failure'});
 assert.equal(get('totalcount').textContent,2);
 assert.equal(api.calls.filter(c=>c.url.includes('/patterns')).length,2);
 assert(api.calls.some(c=>c.url.includes('/record/r1')));
 assert(!get('detailContent').innerHTML.includes('Resolve'));
});

// The replacement fixture creates new controls from rendered markup, rather than
// retaining values and button identity like the simpler boundary-test stub.
function editDraft(get, {text='  draft <review> & notes  ', targets=['f1'], failureClass='draft-failure'}={}) {
 for (const [id,value] of [['reviewText',text],['failureClass',failureClass]]) {
  const control=get(id); control.value=value; control.oninput({target:control});
 }
 const select=get('reviewTargets'); select.selectedOptions=targets.map(value=>({value}));
 select.onchange({target:select});
}
function assertDraft(get, text='  draft <review> & notes  ', targets=['f1'], failureClass='draft-failure') {
 assert.equal(get('reviewText').value,text);
 assert.deepEqual(plain(get('reviewTargets').selectedOptions.map(option=>option.value)),targets);
 assert.equal(get('failureClass').value,failureClass);
}
function twoRecordFetch(api) {
 return async (url,init) => {
  const parsed=new URL(url,'http://localhost');
  if (/\/api\/trace\/[^/]+$/.test(parsed.pathname)) return {ok:true,json:async()=>({nodes:[record(),record('f2')],edges:[],session:null})};
  if (parsed.pathname.endsWith('/record/f2')) return {ok:true,json:async()=>record('f2')};
  return api.fetch(url,init);
 };
}

test('review draft survives replacement on search, playback selection and tab changes', async () => {
 const api=backend(), get=mount(twoRecordFetch(api),'?trace=trace-a',true); await settle();
 get('reviewAction').onclick(); editDraft(get,{targets:['f1','f2']});
 const original=get('reviewForm');
 get('search').oninput({target:{value:'real'}});
 assert.notEqual(get('reviewForm'),original); assert.equal(original.isConnected,false);
 assertDraft(get,undefined,['f1','f2']);
 get('next').onclick(); assertDraft(get,undefined,['f1','f2']);
 get('tab-detail').onclick(); get('tab-review').onclick();
 assertDraft(get,undefined,['f1','f2']);
 get('filter').onchange({target:{value:'finding'}});
 assertDraft(get,undefined,['f1','f2']);
});

test('failed POST after form replacement restores visible save control and persistent error', async () => {
 const api=backend(); let rejectPost;
 const read=twoRecordFetch(api);
 const fetch=(url,init)=>init?.method==='POST' ? new Promise((_resolve,reject)=>{rejectPost=reject;}) : read(url,init);
 const get=mount(fetch,'?trace=trace-a',true); await settle();
 get('reviewAction').onclick(); editDraft(get);
 const pending=get('reviewForm').onsubmit({preventDefault(){}});
 const savingForm=get('reviewForm'), savingButton=savingForm.querySelector('[type=submit]');
 assert.equal(savingButton.disabled,true);
 get('search').oninput({target:{value:'real'}});
 assert.equal(savingForm.isConnected,false);
 assert.equal(get('reviewForm').querySelector('[type=submit]').disabled,true);
 rejectPost(new Error('disk <full>')); await pending; await settle();
 assert.equal(get('reviewForm').querySelector('[type=submit]').disabled,false);
 assert.equal(get('reviewForm').querySelector('[type=submit]').textContent,'Save review ↗');
 assertDraft(get);
 assert(get('detailContent').innerHTML.includes('Review was not confirmed: disk &lt;full&gt;'));
 get('next').onclick(); get('tab-detail').onclick(); get('tab-review').onclick();
 assertDraft(get);
 assert(get('detailContent').innerHTML.includes('disk &lt;full&gt;'));
});

test('draft is cleared across vault scopes, including stale POST failure', async () => {
 const api=backend(); let rejectPost;
 const read=twoRecordFetch(api);
 const fetch=(url,init)=>init?.method==='POST' ? new Promise((_resolve,reject)=>{rejectPost=reject;}) : read(url,init);
 const get=mount(fetch,'?trace=trace-a',true); await settle();
 get('reviewAction').onclick(); editDraft(get);
 const pending=get('reviewForm').onsubmit({preventDefault(){}});
 await get('vaultSelect').onchange({target:{value:'/b'}});
 await get('vaultSelect').onchange({target:{value:'/a'}});
 await settle(); get('reviewAction').onclick();
 assertDraft(get,'',['f1'],'');
 editDraft(get,{text:'new scope draft',failureClass:''});
 rejectPost(new Error('old scope failure')); await pending; await settle();
 assertDraft(get,'new scope draft',['f1'],'');
 assert(!get('detailContent').innerHTML.includes('old scope failure'));
 assert.equal(get('reviewForm').querySelector('[type=submit]').disabled,false);
});

test('draft never carries into another trace in the same vault', async () => {
 const api=backend(), read=twoRecordFetch(api);
 const fetch=(url,init)=>new URL(url,'http://localhost').pathname==='/api/traces'
  ? Promise.resolve({ok:true,json:async()=>[{trace:'trace-a',recordCount:2},{trace:'trace-b',recordCount:2}]})
  : read(url,init);
 const get=mount(fetch,'?trace=trace-a',true); await settle();
 get('reviewAction').onclick(); editDraft(get);
 get('trace-choice-trace-b').onclick(); await settle();
 get('reviewAction').onclick(); assertDraft(get,'',['f1'],'');
 editDraft(get,{text:'trace-b draft'});
 get('trace-choice-trace-a').onclick(); await settle();
 get('reviewAction').onclick(); assertDraft(get,'',['f1'],'');
});

test('dangling supports remain metadata without preventing live trace rendering', async () => {
 const api=backend();
 const fetch=async (url,init) => {
  const parsed=new URL(url,'http://localhost');
  if (parsed.pathname==='/api/trace/trace-a') return {ok:true,json:async()=>({nodes:[record()],edges:[{source:'f1',target:'missing'}],session:null})};
  if (parsed.pathname.endsWith('/record/f1')) return {ok:true,json:async()=>({...record(),supports:['missing']})};
  return api.fetch(url,init);
 };
 const get=mount(fetch); await settle();
 assert.equal(get('totalcount').textContent,1);
 // The connection count represents drawable edges, not dangling metadata.
 assert.equal(get('branchcount').textContent,0);
 assert(!get('graphSvg').innerHTML.includes('class="support-edge"'));
 assert(get('dataCheckContent').innerHTML.includes('0 drawn valid edges · 1 dangling'));
 assert(get('dataCheckContent').innerHTML.includes('DANGLING EXACT PAIRS'));
 assert(get('dataCheckContent').innerHTML.includes('f1 → missing'));
 assert(get('detailContent').innerHTML.includes('missing'));
 assert(get('detailContent').innerHTML.includes('real body'));
 assert.equal(get('retryLoad').hidden,true);
 assert(get('graphSvg').innerHTML.includes('node-card'));
});

test('HTTP errors are visible instead of showing mock data', async () => {
 const get=mount(async()=>({ok:false,status:500,statusText:'Failure',json:async()=>({error:'real API failure'})}));
 await settle();
 assert(get('empty').textContent.includes('real API failure'));
 assert.equal(get('retryLoad').hidden,false);
 assert.equal(get('totalcount').textContent,0);
});
