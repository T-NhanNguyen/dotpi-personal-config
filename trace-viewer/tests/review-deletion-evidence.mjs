// Reporting support, not an additional feature representative. Call selfCheck only
// in the separately authorized bringup target, never at import time.
import assert from 'node:assert/strict';
import {oracleSelfCheck} from './review-deletion-support.mjs';

const tuple = row => [row.case,row.status,row.at??null,row.assert??null,row.reason??null];
const oneLine = value => String(value).replace(/\s+/g,' ').trim().slice(0,240);
const location = value => value.replace(/^file:\/\//,'').replace(/:(\d+):\d+$/,':$1');
export function parseCaptured(text, {customPrefix = '', requiredBrowser = [], customRoster = []} = {}) {
 const rows=[],headers=new Map();let current=null,complete=false;
 for(const line of text.split(/\r?\n/)){
  const header=line.match(/^(\s*)# Subtest: (.+)$/);
  if(header){const depth=header[1].length;for(const key of headers.keys())if(key>=depth)headers.delete(key);headers.set(depth,header[2]);continue;}
  // Console '# ok ...' is not a native TAP result. Only the declared legacy
  // custom format gets its own independently reconciled legacy-check roster.
  const custom=line.match(/^(?:# )?ok \d+: (.+)$/);
  if(custom){rows.push({case:customPrefix+custom[1],status:'pass'});current=null;continue;}
  const match=line.match(/^(\s*)(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)(?: (.*))?)?$/);
  if(match){
   const depth=match[1].length,parents=[...headers].filter(([indent])=>indent<depth).sort((a,b)=>a[0]-b[0]).map(([,name])=>name);
   const name=[...parents,match[3]].join(' > '),skip=match[4];
   current=skip?{case:name,status:'invalid',reason:requiredBrowser.includes(name)?'required Chromium unavailable':oneLine(match[5]||skip)}:match[2]==='ok'?{case:name,status:'pass'}:{case:name,status:'fail',at:'<native>:0',assert:'native failure (see run.log)'};
   rows.push(current);continue;
  }
  if(current?.status==='fail'){
   const error=line.match(/^\s+error: (?:['"])?(.+?)(?:['"])?$/);
   if(error){current.assert=oneLine(error[1]);current.multilineError=/^[|>]/.test(error[1]);}
   else if(current.multilineError && line.trim()) {current.assert=oneLine(line);current.multilineError=false;}
   const loc=line.match(/^\s+location: ['"]?(.+?:\d+(?::\d+)?)['"]?$/);
   if(loc)current.at=location(loc[1]);
   const stack=line.match(/\((file:\/\/[^)]+:\d+:\d+)\)/);
   if(stack&&!current.stackLocation){current.at=location(stack[1]);current.stackLocation=true;}
   if(line.includes('required Chromium unavailable')||line.includes('required Chromium endpoint unavailable'))current.requiredMissing=true;
  }
  if(/^# (?:duration_ms|duration)\b/.test(line)||/^PASS(?:ED)?\b|^Passed \d+/.test(line))complete=true;
 }
 // Direct custom scripts abort before printing the failed checked() label.
 // Attribute only when the stack proves checked() was the caller; setup/tool
 // failures outside checked() remain invalid/unreached, never invented failures.
 if(customRoster.length && /AssertionError/.test(text) && /at checked\s*\(/.test(text)){
  const next=customRoster.find(name=>!rows.some(row=>row.case===name));
  const at=text.match(/(?:file:\/\/)?([^\s()]+\.mjs:\d+:\d+)/);
  const message=text.match(/AssertionError[^\n]*?:\s*([^\n]+)/);
  if(next)rows.push({case:next,status:'fail',at:at?location(at[1]):'<native>:0',assert:oneLine(message?.[1]||'custom assertion failed (see run.log)')});
 }
 for(const row of rows){
  if(row.requiredMissing){row.status='invalid';row.reason='required Chromium unavailable';delete row.at;delete row.assert;}
  delete row.requiredMissing;delete row.stackLocation;delete row.multilineError;
 }
 return {rows,complete};
}
export function reconcile(parsed, expected) {
 assert.equal(new Set(expected).size,expected.length,'duplicate expected roster');
 const seen=new Set(),rows=[];
 for(const row of parsed.rows){
  if(seen.has(row.case))throw Error('duplicate result: '+row.case);
  if(!expected.includes(row.case))throw Error('unexpected result: '+row.case);
  seen.add(row.case);rows.push(row);
 }
 for(const name of expected)if(!seen.has(name))rows.push({case:name,status:'invalid',reason:'missing or unreached result'});
 if(!parsed.complete)rows.push({case:'harness/captured-output',status:'invalid',reason:'incomplete native output'});
 return rows;
}
export const counts = rows => ({pass:rows.filter(r=>r.status==='pass').length,fail:rows.filter(r=>r.status==='fail').length,invalid:rows.filter(r=>r.status==='invalid').length});
function keys(value, expected) {assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value),expected);}
export function validateJSONL(text) {
 assert(text.endsWith('\n'),'JSONL must end in LF');
 const rows=text.slice(0,-1).split('\n').map(line=>JSON.parse(line));let summary,rollup;const cases=[];
 for(const row of rows){
  if(Object.hasOwn(row,'case')){
   assert(!summary&&!rollup,'case after summary');
   keys(row,row.status==='pass'?['case','status']:row.status==='fail'?['case','status','at','assert']:['case','status','reason']);
   assert.equal(typeof row.case,'string');assert(['pass','fail','invalid'].includes(row.status));
   for(const key of Object.keys(row))assert.equal(typeof row[key],'string');cases.push(row);
  } else if(Object.hasOwn(row,'summary')){
   assert(!summary&&!rollup);keys(row,['summary']);summary=row.summary;keys(summary,['target','kind','pass','fail','invalid','report','log']);
   assert(['npm','binary','setup'].includes(summary.kind));for(const key of ['target','report','log'])assert.equal(typeof summary[key],'string');
   assert.deepEqual({pass:summary.pass,fail:summary.fail,invalid:summary.invalid},counts(cases));
  } else {
   assert(summary&&!rollup);keys(row,['rollup']);rollup=row.rollup;keys(rollup,['pass','fail','invalid','targets']);
   assert.deepEqual(rollup,{...counts(cases),targets:1});
  }
 }
 assert(summary&&rollup);assert.equal(new Set(cases.map(r=>r.case)).size,cases.length);return rows;
}
export function selfCheck() {
 const literal=`TAP version 13
# Subtest: outer
    # Subtest: child
    ok 1 - child
    1..1
ok 1 - outer
# ok 99 - diagnostic only, not a TAP result
# Subtest: broken
not ok 2 - broken
  ---
  location: 'fixture.test.mjs:7:1'
  error: 'expected 1, actual 2'
  ...
# Subtest: writable-browser-staging-navigation
ok 3 - writable-browser-staging-navigation # SKIP unavailable
1..3
# duration_ms 1
`;
 const parsed=parseCaptured(literal,{requiredBrowser:['writable-browser-staging-navigation']});
 assert.deepEqual(parsed.rows.map(tuple),[
  ['outer > child','pass',null,null,null],['outer','pass',null,null,null],
  ['broken','fail','fixture.test.mjs:7','expected 1, actual 2',null],
  ['writable-browser-staging-navigation','invalid',null,null,'required Chromium unavailable'],
 ]);
 assert.equal(parsed.complete,true);
 const nested=parseCaptured(`# Subtest: parent\n    # Subtest: leaf\n    not ok 1 - leaf\n      error: 'leaf assertion'\n      location: 'x.mjs:9:1'\nnot ok 1 - parent\n  error: '1 subtest failed'\n  location: 'x.mjs:2:1'\n# duration_ms 2\n`);
 assert.deepEqual(nested.rows.map(tuple),[
  ['parent > leaf','fail','x.mjs:9','leaf assertion',null],['parent','fail','x.mjs:2','1 subtest failed',null],
 ]);
 assert.throws(()=>reconcile({rows:[parsed.rows[0],parsed.rows[0]],complete:true},['outer > child']),/duplicate result/);
 assert.throws(()=>reconcile({rows:[{case:'wrong',status:'pass'}],complete:true},['right']),/unexpected result/);
 assert.deepEqual(reconcile(parseCaptured('TAP version 13\nok nonsense\n'),['missing']).map(tuple),[
  ['missing','invalid',null,null,'missing or unreached result'],['harness/captured-output','invalid',null,null,'incomplete native output'],
 ]);
 const custom=parseCaptured('ok 1: custom check\nPassed 1 checks.\n',{customPrefix:'extension/'});
 assert.deepEqual(custom.rows.map(tuple),[['extension/custom check','pass',null,null,null]]);assert.equal(custom.complete,true);
 const customFailure=parseCaptured('ok 1: first\nAssertionError [ERR_ASSERTION]: expected 1, actual 2\n    at fixture.test.mjs:7:1\n    at checked (fixture.test.mjs:2:1)\n',{customPrefix:'legacy/',customRoster:['legacy/first','legacy/broken']});
 assert.deepEqual(customFailure.rows.map(tuple),[['legacy/first','pass',null,null,null],['legacy/broken','fail','fixture.test.mjs:7','expected 1, actual 2',null]]);assert.equal(customFailure.complete,false);
 const summary={summary:{target:'fixture',kind:'binary',...counts(parsed.rows),report:'/tmp/report.jsonl',log:'/tmp/run.log'}};
 const records=[...parsed.rows,summary,{rollup:{...counts(parsed.rows),targets:1}}];
 const jsonl=records.map(r=>JSON.stringify(r)).join('\n')+'\n';assert.deepEqual(validateJSONL(jsonl),records);
 assert.throws(()=>validateJSONL(jsonl.replace('"pass":2','"pass":3')));
 assert.throws(()=>validateJSONL('["not an object"]\n'));
 assert.throws(()=>validateJSONL('{"status":"pass","case":"wrong key order"}\n'));
 assert.throws(()=>validateJSONL(jsonl.trimEnd()));
 oracleSelfCheck();
}
