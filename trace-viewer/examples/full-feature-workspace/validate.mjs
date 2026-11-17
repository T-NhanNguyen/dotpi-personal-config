// Standalone fixture validation; uses the real HTTP server, never a real vault.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessions, workspace } from './prepare-sessions.mjs';
const viewer = resolve(workspace, '../..');
const kinds = ['finding','decision','concept','path','evidence','deadend','review'];
const prefixes = {finding:'f',decision:'d',concept:'c',path:'p',evidence:'e',deadend:'x',review:'r'};
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const readLines = async file => (await readFile(file,'utf8')).trimEnd().split('\n').map(JSON.parse);
const traces = join(workspace,'.dev-vault/traces');
let total=0; const all=[];
for(const trace of await readdir(traces)) {
 const records=await readLines(join(traces,trace,'trace.jsonl'));
 assert.equal(records.length,trace==='ui-design-sample'?40:2);
 const meta=await readJson(join(traces,trace,'meta.json'));
 assert.equal(meta.trace,trace); assert.equal(new Date(meta.created).toISOString(),meta.created);
 const ids=new Set(records.map(r=>r.id)); assert.equal(ids.size,records.length);
 for(const r of records){
  assert.deepEqual(Object.keys(r).filter(k=>!['id','trace','kind','title','body','refs','supports','confidence','check','steps','agent','failureClass','session','ts'].includes(k)),[]);
  assert.equal(r.trace,trace); assert(kinds.includes(r.kind)); assert(r.id.startsWith(prefixes[r.kind]));
  assert(r.title.includes('[SYNTHETIC]') && r.title.length<=200);
  assert(r.body.startsWith('SYNTHETIC FIXTURE') && r.body.length<=1200);
  assert.equal(new Date(r.ts).toISOString(),r.ts);
  assert(Array.isArray(r.refs)&&r.refs.length>0);
  for(const ref of r.refs){assert.equal(typeof ref.type,'string'); for(const [k,v] of Object.entries(ref)){assert(['type','path','lines','page','note'].includes(k));assert.equal(typeof v,'string');}}
  if(r.confidence!==undefined) assert(['verified','inferred','unverified'].includes(r.confidence));
  if(r.check){assert.equal(typeof r.check.method,'string');assert(r.check.output.includes('SYNTHETIC'));if(r.check.revision!==undefined)assert.equal(typeof r.check.revision,'string');}
  if(r.confidence==='verified') assert(r.check?.output.trim());
  for(const k of ['agent','session','failureClass']) if(r[k]!==undefined) assert.equal(typeof r[k],'string');
  if(r.failureClass) assert(/^[a-z0-9][a-z0-9._-]*$/.test(r.failureClass));
  for(const target of r.supports??[]) {assert(ids.has(target),`${trace}/${r.id}: missing ${target}`);assert.notEqual(target,r.id);assert(records.findIndex(x=>x.id===target)<records.indexOf(r),'fixture targets must precede source');}
  for(const step of r.steps??[]) {assert.equal(typeof step.action,'string');assert.equal(typeof step.ref,'string');}
  if(r.kind==='review') assert.equal(r.agent,'human');
 }
 total+=records.length; all.push(...records);
}
assert.deepEqual([...new Set(all.map(r=>r.kind))].sort(),kinds.sort());
assert.equal(new Set(all.map(r=>r.confidence)).size,4);
assert.deepEqual([...new Set(all.flatMap(r=>r.refs.map(x=>x.type)))].sort(),['command','datasheet','file','measurement','other','url']);
const main=all.filter(r=>r.trace==='ui-design-sample');
assert(main.some(r=>r.body.length>=900 && r.body.includes('\n')));
assert(main.some(r=>r.body.length<120));
assert(main.some(r=>r.supports?.length>1));
assert(main.some(r=>main.filter(s=>s.supports?.includes(r.id)).length>1));
assert(main.some(r=>!(r.supports?.length)&&!main.some(s=>s.supports?.includes(r.id))));
assert(main.some(r=>r.kind==='review'&&!r.supports));
assert(main.filter(r=>r.kind==='review'&&r.supports?.[0]==='d2').length===2);
console.log(`Schema/integrity OK: ${total} records (40 + 2), 7 kinds, 4 confidence states, 6 ref types.`);
let scratch, sessions, child;
try {
 scratch=await mkdtemp(join(tmpdir(),'synthetic-trace-api-'));
 await cp(join(workspace,'.dev-vault'),join(scratch,'.dev-vault'),{recursive:true});
 sessions=await prepareSessions(scratch);
 const config=join(scratch,'isolated-config.json');
 child=spawn(join(viewer,'node_modules/.bin/tsx'),[join(viewer,'server.ts'),'--cwd',scratch,'--sessions-dir',sessions,'--port','0'],{env:{...process.env,TRACE_VIEWER_CONFIG:config},stdio:['ignore','pipe','pipe']});
 let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk;});
 const url=await new Promise((accept,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Server startup timed out')),15000);
  let text='';child.stdout.on('data',chunk=>{text+=chunk;const line=text.split('\n')[0];if(line.startsWith('http')&&text.includes('\n')){clearTimeout(timer);accept(line);}});
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}: ${stderr}`));});
 });
 async function api(path,options){const response=await fetch(new URL(path,url),options);assert.equal(response.status,200,`${path}: ${response.status}`);return response.json();}
 const list=await api('/api/traces');assert.deepEqual(list.map(t=>[t.trace,t.recordCount]),[['ui-design-sample',40],['ui-design-companion',2]]);
 const base='/api/trace/ui-design-sample';
 const graph=await api(base);assert.equal(graph.nodes.length,40);assert.equal(graph.session,'synthetic-outage-main');assert.equal(graph.edges.length,main.reduce((n,r)=>n+(r.supports?.length??0),0));
 for(const r of all) assert.deepEqual(await api(`/api/trace/${r.trace}/record/${r.id}`),r);
 const groups=await api(base+'/patterns');assert.equal(groups.length,1);assert.equal(groups[0].count,8);assert.equal(groups[0].traceCount,2);
 for(const trace of ['ui-design-sample','ui-design-companion']){
  const transcript=await api(`/api/trace/${trace}/session`);
  assert.equal(transcript.messages.length,4);
  const text=transcript.messages.map(m=>m.text).join('\n');
  assert(!text.includes('ABANDONED')&&!text.includes('SYNTHETIC SYSTEM'));
  assert(text.includes('toolCall synthetic_replay')&&text.includes('SYNTHETIC reasoning')&&text.includes('expired=12'));
 }
 const vaults=await api('/api/vaults');assert.equal(vaults.length,1);assert.equal(vaults[0].path,scratch);
 // Review writes go to the throwaway copy, never the checked-in fixture.
 const review=await api(base+'/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetIds:['d2'],text:'SYNTHETIC smoke review only',failureClass:'renewal-starvation'})});
 assert.equal(review.kind,'review');assert.equal(review.agent,'human');assert.deepEqual(review.supports,['d2']);
 console.log('Server API smoke OK: isolated vault/list, graph, 42 record details, 8 cross-trace patterns, 2 active-branch sessions, temporary human review.');
} finally {
 if(child && child.exitCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}
 if(sessions) await rm(sessions,{recursive:true,force:true});
 if(scratch) await rm(scratch,{recursive:true,force:true});
}
