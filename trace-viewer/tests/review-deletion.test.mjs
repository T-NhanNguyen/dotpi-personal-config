// Gate-approved fixed representatives 1–9 and 12. No generated test products.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
 names,created,record as r,encode,decode,sha,select,withoutSupports,changeTuples,
 fixture,operation,child,server,authorized,reviewInput,extensionInput,
} from './review-deletion-support.mjs';

const run = (index, fn) => test(names[index-1],{timeout:45000},fn);
const ledger = fx => fs.existsSync(fx.file()+'.reserved-ids') ? fs.readFileSync(fx.file()+'.reserved-ids') : null;
const ledgerIds = fx => decode(ledger(fx));

run(1,async t=>{
 const rows=[r('f1'),r('f2'),r('f3'),r('r1',['f2','f1','f2']),r('r2',['r1','f3']),r('r3',['f3','r2','f3','r1']),r('r4',['f1','f1'])];
 const fx=fixture(t,rows), selection=select(rows,['r1','r2']);
 const result=await operation(t,fx,{mode:'plan',records:rows,selection});
 assert.deepEqual(result.plan.conflicts,[]);
 assert.deepEqual(changeTuples(result.plan),[['r3',['f3','r2','f3','r1'],['f3','f2','f1']]]);
 assert.equal(result.commit.status,200);
 const expected=[...rows.slice(0,3),{...rows[5],supports:['f3','f2','f1']},rows[6]];
 assert.deepEqual(fx.rows(),expected);assert.deepEqual(fx.bytes(),encode(expected));fx.clean();
});

run(2,async t=>{
 const rows=[r('f1'),r('r1',['r2','r3','f1']),r('r2',['r1']),r('r3',['r1','r3']),r('r4',['r5']),r('r5',['r4']),r('r6',['r4'])];
 const fx=fixture(t,rows),selection=select(rows,['r1','r2','r4','r5']);
 // The child watchdog also bounds a planner cycle that never returns.
 const result=await operation(t,fx,{mode:'plan',records:rows,selection});
 assert.deepEqual(result.plan.conflicts,[]);
 assert.deepEqual(changeTuples(result.plan),[['r3',['r1','r3'],['f1','r3']],['r6',['r4'],[]]]);
 assert.equal(result.commit.status,200);
 const expected=[rows[0],{...rows[3],supports:['f1','r3']},withoutSupports(rows[6])];
 assert.deepEqual(fx.rows(),expected);assert.deepEqual(fx.bytes(),encode(expected));
 assert.equal(Object.hasOwn(fx.rows()[2],'supports'),false);fx.clean();
});

run(3,async t=>{
 const rows=[r('f1',['r1','r1']),r('r1'),r('r2'),r('r3',['r2'])];
 const fx=fixture(t,rows),s=await server(t,fx),selection=select(rows,['r1','r2']),before=fx.bytes();
 const p=await authorized(s,selection);
 assert.deepEqual(p.conflicts,[{id:'r1',reason:'Protected review: a non-review record directly supports it.'}]);
 assert.equal((await s.commit(selection,p.authorization)).status,409);assert.deepEqual(fx.bytes(),before);
 const retained=[selection[1]],fresh=await authorized(s,retained);
 assert.deepEqual(fresh.selected,[{id:'r2',title:'r2',text:'body r2'}]);assert.deepEqual(fresh.conflicts,[]);
 assert.deepEqual(changeTuples(fresh),[['r3',['r2'],[]]]);
 assert.equal((await s.commit(retained,fresh.authorization)).status,200);
 assert.deepEqual(fx.bytes(),encode([rows[0],rows[1],withoutSupports(rows[3])]));fx.clean();
});

run(4,async t=>{
 const initial=[r('f1'),r('r1'),r('r2'),r('r3',['r1'])],fx=fixture(t,initial),s=await server(t,fx);
 const selection=select(initial,['r1','r2']);
 const variants=[
  {rows:[initial[0],{...initial[1],body:'edited'},...initial.slice(2)],reason:'Selected review changed.'},
  {rows:initial.filter(r=>r.id!=='r1'),reason:'Review disappeared.'},
  {rows:[initial[0],{...initial[1],kind:'finding'},...initial.slice(2)],reason:'Record is no longer a review.'},
 ];
 for(const variant of variants){
  fx.seed(initial);const old=await authorized(s,selection);fx.seed(variant.rows);const before=fx.bytes();
  const refreshed=await authorized(s,selection);
  assert.deepEqual(refreshed.conflicts,[{id:'r1',reason:variant.reason}]);
  assert.deepEqual(refreshed.selected,[{id:'r1',title:'r1',text:'body r1'},{id:'r2',title:'r2',text:'body r2'}]);
  for(const token of [old.authorization,refreshed.authorization]){
   const response=await s.commit(selection,token);assert.equal(response.status,409);
   assert.deepEqual(response.body.preview.conflicts,[{id:'r1',reason:variant.reason}]);assert.deepEqual(fx.bytes(),before);
  }
  const retained=[selection[1]],fresh=await authorized(s,retained);
  assert.deepEqual(fresh.conflicts,[]);assert.deepEqual(fresh.changes,[]);
  assert.equal((await s.commit(retained,fresh.authorization)).status,200);
  assert.deepEqual(fx.bytes(),encode(variant.rows.filter(r=>r.id!=='r2')));fx.clean();
 }
});

run(5,async t=>{
 const rows=[r('f1'),r('r1'),r('r2')],fx=fixture(t,rows);let s=await server(t,fx);
 assert.equal((await s.request('/api/vaults',{path:fx.other})).status,200);
 const selection=select(rows,['r1']),p=await authorized(s,selection);
 assert.equal(p.revision,sha(fx.bytes()));
 fs.writeFileSync(fx.file(),Buffer.concat([Buffer.from(' '),fx.bytes()]));const whitespace=fx.bytes();
 const stale=await s.commit(selection,p.authorization);assert.equal(stale.status,409);
 assert.deepEqual(stale.body.preview.conflicts,[]);assert.equal(stale.body.preview.revision,sha(whitespace));
 assert.notEqual(stale.body.preview.authorization,p.authorization);assert.deepEqual(fx.bytes(),whitespace);
 const fresh=await authorized(s,selection);assert.equal((await s.commit(selection,fresh.authorization)).status,200);
 assert.deepEqual(fx.bytes(),Buffer.concat([Buffer.from(' '),encode([rows[0],rows[2]])]));
 const deleted=fx.bytes(),replay=await s.commit(selection,fresh.authorization);
 assert.equal(replay.status,409);assert.deepEqual(replay.body.preview.conflicts,[{id:'r1',reason:'Review disappeared.'}]);assert.deepEqual(fx.bytes(),deleted);
 // Each scope/selection substitution begins with an independently valid preview.
 for(const variant of ['vault','trace','selection','reverse']){
  fx.seed(rows);const original=select(rows,variant==='reverse'?['r1','r2']:['r1']);
  const valid=await authorized(s,original);
  const project=variant==='vault'?fx.other:fx.cwd,trace=variant==='trace'?'u':'t';
  const target=variant==='trace'?select(rows.map(r=>({...r,trace:'u'})),['r1']):variant==='selection'?select(rows,['r2']):variant==='reverse'?[...original].reverse():original;
  // The target is eligible independently; rejection must be authorization, not item conflict.
  assert.deepEqual((await authorized(s,target,project,trace)).conflicts,[]);
  const before=fx.state(),result=await s.commit(target,valid.authorization,project,trace);
  assert.equal(result.status,409);assert.deepEqual(result.body.preview.conflicts,[]);assert.deepEqual(fx.state(),before);
 }
 fx.seed(rows);const preRestart=await authorized(s,selection);await s.close();s=await server(t,fx);
 const before=fx.state(),restarted=await s.commit(selection,preRestart.authorization);
 assert.equal(restarted.status,409);assert.deepEqual(restarted.body.preview.conflicts,[]);assert.deepEqual(fx.state(),before);
 assert.notEqual(restarted.body.preview.authorization,preRestart.authorization);
 assert.equal((await s.commit(selection,restarted.body.preview.authorization)).status,200);fx.clean();
});

run(6,async t=>{
 const rows=[r('r1'),r('r2')],fx=fixture(t,rows),s=await server(t,fx),selection=select(rows,['r1']);
 const prefix=Buffer.from(' {"id":"f1","trace":"t","kind":"finding","supports":["r9","r9",null],"title":"odd","body":"x"} \r\n\n');
 const tail=Buffer.from(JSON.stringify(rows[1])),raw=Buffer.concat([prefix,encode([rows[0]]),tail]);
 fs.writeFileSync(fx.file(),raw);const p=await authorized(s,selection);
 assert.equal((await s.commit(selection,p.authorization)).status,200);
 assert.deepEqual(fx.bytes(),Buffer.concat([prefix,tail]));assert.notEqual(fx.bytes().at(-1),10);fx.clean();
 for(const variant of ['middle','tail']){
  fs.writeFileSync(fx.file(),raw);const valid=await authorized(s,selection),beforeLedger=ledger(fx);
  const corrupted=variant==='middle'?Buffer.concat([prefix,Buffer.from('{bad\n'),encode([rows[0]]),tail]):Buffer.concat([raw,Buffer.from('\n{bad')]);
  fs.writeFileSync(fx.file(),corrupted);
  for(const result of [await s.preview(selection),await s.commit(selection,valid.authorization)]){
   assert.equal(result.status,500);assert.deepEqual(result.body,{error:'Malformed JSONL; mutation blocked (including a malformed trailing record).'});
   assert.deepEqual(fx.bytes(),corrupted);assert.deepEqual(ledger(fx),beforeLedger);fx.clean();
  }
 }
});

run(7,async t=>{
 const rows=[r('f1'),r('r1'),r('r2',['r1']),r('r3')],fx=fixture(t,rows),selection=select(rows,['r1','r3']);
 for(const fault of ['write','rename']){
  fx.seed(rows);const s=await server(t,fx,{fault}),p=await authorized(s,selection),before=fx.bytes();
  const result=await s.commit(selection,p.authorization);assert.equal(result.status,500);assert.match(result.body.error,new RegExp('injected precommit '+fault+' failure'));
  assert.deepEqual(fx.bytes(),before);assert.deepEqual(fx.rows(),rows);fx.clean();
  s.send({command:'fault',fault:null});await s.wait('configured');
  const fresh=await authorized(s,selection);assert.equal((await s.commit(selection,fresh.authorization)).status,200);
  assert.deepEqual(fx.bytes(),encode([rows[0],withoutSupports(rows[2])]));
  assert.deepEqual(fs.readdirSync(path.dirname(fx.file())).sort(),['meta.json','trace.jsonl','trace.jsonl.reserved-ids']);fx.clean();await s.close();
 }
});

run(8,async t=>{
 const rows=[r('r1'),r('r2')],fx=fixture(t,rows),meta=fs.readFileSync(path.join(path.dirname(fx.file()),'meta.json'));
 let s=await server(t,fx);const selection=select(rows,['r2']),p=await authorized(s,selection);
 assert.equal((await s.commit(selection,p.authorization)).status,200);await s.close();
 s=await server(t,fx);const added=await s.request('/api/trace/t/review',{targetIds:[],text:'viewer append'});
 assert.equal(added.status,200);assert.equal(added.body.id,'r3');await s.close();
 const extension=await operation(t,fx,{mode:'extension',input:extensionInput});
 assert.equal(extension.details.record.id,'f1');
 assert.deepEqual(fx.rows(),[rows[0],added.body,extension.details.record]);
 const before=fx.bytes();await operation(t,fx,{mode:'append',input:reviewInput('failed r4'),fault:'append'},/injected append after reservation failure/);
 assert.deepEqual(fx.bytes(),before);
 s=await server(t,fx);const next=await s.request('/api/trace/t/review',{targetIds:[],text:'after failure'});
 assert.equal(next.status,200);assert.equal(next.body.id,'r5');
 assert.deepEqual(ledgerIds(fx),['r1','r2','r3','f1','r4','r5']);
 assert.deepEqual(fx.rows(),[rows[0],added.body,extension.details.record,next.body]);assert.equal(fx.rows().length,4);
 const summaries=await s.request('/api/traces');assert.equal(summaries.body.find(t=>t.trace==='t').recordCount,4);
 assert.deepEqual(fs.readFileSync(path.join(path.dirname(fx.file()),'meta.json')),meta);assert.equal(JSON.parse(meta).created,created);
 await s.close();const truncated=ledger(fx).subarray(0,-1);fs.writeFileSync(fx.file()+'.reserved-ids',truncated);
 const live=fx.bytes();await operation(t,fx,{mode:'append',input:reviewInput()},/Incomplete ID reservation ledger/);
 assert.deepEqual(fx.bytes(),live);assert.deepEqual(ledger(fx),truncated);fx.clean();
});

run(9,async t=>{
 const rows=[r('f1'),r('r1')],fx=fixture(t,rows),s=await server(t,fx),selection=select(rows,['r1']),old=await authorized(s,selection);
 const lock=fx.file()+'.mutation-lock';
 // Initialize both real writers before taking the short-deadline production lock.
 const extension=child(t,{mode:'extension',cwd:fx.cwd,input:extensionInput,startBarrier:true});
 const viewer=child(t,{mode:'append',cwd:fx.cwd,input:reviewInput('viewer concurrent'),startBarrier:true});
 await Promise.all([extension.wait('prepared'),viewer.wait('prepared')]);
 const holder=child(t,{mode:'hold',cwd:fx.cwd,barrier:'held'});await holder.wait('held');
 extension.release();viewer.release();
 await Promise.all([extension.wait('lock-wait'),viewer.wait('lock-wait')]);holder.release();
 const heldResult=await holder.wait(m=>m.event==='result'||m.event==='error');
 assert.equal(heldResult.event,'result',heldResult.error);await holder.exit;
 const results=await Promise.all([extension.wait(m=>m.event==='result'||m.event==='error'),viewer.wait(m=>m.event==='result'||m.event==='error')]);
 for(const result of results)assert.equal(result.event,'result',result.error);
 assert.equal((await extension.exit).code,0);assert.equal((await viewer.exit).code,0);
 const live=fx.rows();assert.deepEqual(live.slice(0,2),rows);
 const extensionRecord=results[0].result.details.record,viewerRecord=results[1].result;
 assert.notEqual(extensionRecord.id,viewerRecord.id);
 assert.deepEqual(live.slice(2),live[2].id===extensionRecord.id?[extensionRecord,viewerRecord]:[viewerRecord,extensionRecord]);
 assert.deepEqual(live.map(r=>r.id).sort(),['f1','f2','r1','r2']);
 assert.equal(live.filter(r=>r.title==='extension append').length,1);assert.equal(live.filter(r=>r.title==='viewer concurrent').length,1);
 const before=fx.bytes(),stale=await s.commit(selection,old.authorization);assert.equal(stale.status,409);assert.deepEqual(fx.bytes(),before);
 const fresh=await authorized(s,selection);assert.equal((await s.commit(selection,fresh.authorization)).status,200);
 assert.deepEqual(fx.rows(),live.filter(r=>r.id!=='r1'));
 // Second serialization: delete owns lock at the actual rename boundary.
 fx.seed(rows);
 const append=child(t,{mode:'append',cwd:fx.cwd,input:reviewInput('after rename'),startBarrier:true});await append.wait('prepared');
 const deletion=child(t,{mode:'delete',cwd:fx.cwd,selection,barrier:'rename'});await deletion.wait('pre-rename');
 append.release();await append.wait('lock-wait');deletion.release();
 assert.equal((await deletion.wait('result')).result.status,200);assert.equal((await deletion.exit).code,0);
 const appended=(await append.wait('result')).result;assert.equal((await append.exit).code,0);assert.equal(appended.id,'r3');
 assert.deepEqual(fx.rows(),[rows[0],appended]);fx.clean();
 // Existing locks are never stolen, including on the timeout path.
 const unchanged=fx.bytes(),reserved=ledger(fx);fs.mkdirSync(lock);
 const blocked=child(t,{mode:'append',cwd:fx.cwd,input:reviewInput('blocked')});await blocked.wait('lock-wait');
 const failed=await blocked.wait('error');assert.match(failed.error,/locks are never stolen/);assert.equal((await blocked.exit).code,1);
 assert.deepEqual(fx.bytes(),unchanged);assert.deepEqual(ledger(fx),reserved);assert(fs.statSync(lock).isDirectory());fs.rmdirSync(lock);fx.clean();
});

run(12,async t=>{
 const rows=[r('f1'),r('r1'),r('r2')],fx=fixture(t,rows);
 fs.writeFileSync(fx.file()+'.reserved-ids','"f1"\n"r1"\n"r2"\n');
 const s=await server(t,fx),selection=select(rows,['r1']),p=await authorized(s,selection);
 const baseline=async()=>({files:fx.state(),vaults:(await s.request('/api/vaults')).body});
 const before=await baseline();
 const invalidRows=[
  ['/api/vaults',{path:fx.other},{host:`evil.example:${s.port}`},403],
  ['/api/trace/t/review',{targetIds:[],text:'valid review'},{origin:'https://evil.example'},403],
  [s.route('preview'),{selection},{origin:'null'},403],
  [s.route('commit'),{selection,authorization:p.authorization},{'content-type':'text/plain'},415],
 ];
 for(const [route,body,headers,status] of invalidRows){assert.equal((await s.request(route,body,headers)).status,status);assert.deepEqual(await baseline(),before);fx.clean();}
 const invalidBodies=[{selection},{selection:[selection[0],selection[0]],authorization:p.authorization},{selection:[],authorization:p.authorization},{selection:[{id:'r2',snapshot:rows[1]}],authorization:p.authorization}];
 for(const body of invalidBodies){assert.equal((await s.request(s.route('commit'),body)).status,400);assert.deepEqual(await baseline(),before);fx.clean();}
 assert.equal((await s.request(s.route('preview'),undefined,{},JSON.stringify({selection,padding:'x'.repeat(65537)}))).status,413);
 assert.deepEqual(await baseline(),before);fx.clean();
 // Positive controls have exact effects, rather than only successful status.
 const loaded=await s.request('/api/vaults',{path:fx.other});assert.equal(loaded.status,200);
 const vaults=(await s.request('/api/vaults')).body;assert.deepEqual(vaults.map(v=>v.path),[fx.cwd,fx.other]);
 const append=await s.request('/api/trace/t/review',{targetIds:['f1'],text:'trusted local'}, {host:`localhost:${s.port}`,origin:`http://localhost:${s.port}`});
 assert.equal(append.status,200);assert.equal(append.body.id,'r3');assert.deepEqual(fx.rows(),[...rows,append.body]);assert.deepEqual(ledgerIds(fx),['f1','r1','r2','r3']);
 assert.deepEqual(fx.rows(fx.other),rows);assert.deepEqual(fs.readFileSync(fx.config),Buffer.from(JSON.stringify({vaults:[fx.other]},null,2)+'\n'));fx.clean();
 // Verify the actual listening socket address through isolated child instrumentation.
 assert.equal((await s.wait('ready')).address,'127.0.0.1');
});
