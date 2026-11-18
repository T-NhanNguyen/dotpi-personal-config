import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

export const names = [
 'promotion-order-multiplicity','promotion-cycle-self-and-trace-level',
 'protected-conflicts-individual-resolution','selected-snapshot-conflicts',
 'raw-revision-authorization-scope','byte-preservation-and-malformed-fail-closed',
 'atomic-precommit-failure','durable-id-restart-and-failed-reservation',
 'cooperating-writer-barriers','writable-browser-staging-navigation',
 'stale-browser-reconfirmation','mutation-boundary-no-effects',
];
export const created = '2026-01-01T00:00:00Z';
export const record = (id, supports, extra = {}) => ({id, trace:'t', kind:id.startsWith('r')?'review':'finding', title:id, body:'body '+id, refs:[], ts:created, ...(supports === undefined ? {} : {supports}), ...extra});
export const encode = records => Buffer.from(records.map(r => JSON.stringify(r)+'\n').join(''));
// Independent JSONL oracle: never use the tolerant production display reader.
export const decode = bytes => bytes.toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const select = (records, ids) => ids.map(id => ({id, snapshot:structuredClone(records.find(r => r.id === id))}));
export const withoutSupports = r => { const copy = {...r}; delete copy.supports; return copy; };
export const changeTuples = preview => preview.changes.map(c => [c.id,c.before,c.after]);
const resources = new WeakMap();
export function fixture(t, records = [record('f1'),record('r1'),record('r2')]) {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(),'review-delete-'));
 const disposers=[];resources.set(t,disposers);
 t.after(async()=>{try{for(const dispose of [...disposers].reverse())await dispose();}finally{fs.rmSync(directory,{recursive:true,force:true});}});
 const cwd = path.join(directory,'A'), other = path.join(directory,'B');
 const root = project => path.join(project,'.dev-vault/traces');
 const file = (project = cwd, trace = 't') => path.join(root(project),trace,'trace.jsonl');
 const seed = (rows, project = cwd, trace = 't') => {
  fs.mkdirSync(path.dirname(file(project,trace)),{recursive:true});
  fs.writeFileSync(file(project,trace),encode(rows));
  fs.writeFileSync(path.join(path.dirname(file(project,trace)),'meta.json'),JSON.stringify({trace,created})+'\n');
 };
 for (const project of [cwd,other]) for (const trace of ['t','u']) seed(records.map(r=>({...r,trace})),project,trace);
 const config = path.join(directory,'config.json'), sessions = path.join(directory,'sessions');
 fs.mkdirSync(sessions);fs.writeFileSync(config,JSON.stringify({vaults:[]},null,2)+'\n');
 const bytes = (project = cwd, trace = 't') => fs.readFileSync(file(project,trace));
 const rows = (project = cwd, trace = 't') => decode(bytes(project,trace));
 const clean = (project = cwd, trace = 't') => assert.deepEqual(fs.readdirSync(path.dirname(file(project,trace))).filter(n=>n.includes('mutation-lock')||/^\.trace-.*\.tmp$/.test(n)),[]);
 const state = () => {
  const inventory = [];
  const walk = dir => { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir,name); if(fs.statSync(p).isDirectory()) { inventory.push([path.relative(directory,p),null]); walk(p); } else inventory.push([path.relative(directory,p),fs.readFileSync(p).toString('base64')]); } };
  walk(directory); return inventory;
 };
 return {directory,cwd,other,root,file,seed,config,sessions,bytes,rows,clean,state,cleanup:fn=>disposers.push(fn)};
}
export function child(t, options) {
 const proc = fork(new URL('./review-deletion-child.mjs',import.meta.url),[JSON.stringify(options)],{stdio:['pipe','pipe','pipe','ipc'],execArgv:['--import',new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).href]});
 const messages = [], waiters = [];
 let stderr = '', exited = false, exitDetails;
 const failure = prefix => Error(`${prefix}: ${JSON.stringify({exit:exitDetails,messages})} ${stderr}`);
 proc.stdout.on('data',chunk=>{ stderr += 'stdout: '+chunk; });
 proc.stderr.on('data',chunk=>{ stderr += chunk; });
 const exit = once(proc,'exit').then(([code,signal])=>{exited=true;exitDetails={code,signal};for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(failure('Child exited'));}return exitDetails;});
 proc.on('message',message=>{
  messages.push(message);
  for (const waiter of [...waiters]) {
   if (waiter.predicate(message)) {waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}
   else if(message.event==='error'){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.reject(failure('Child reported error'));}
  }
 });
 const wait = (event, timeout = 8000) => {
  const predicate = typeof event === 'function' ? event : message=>message.event===event;
  const found = messages.find(predicate); if(found)return Promise.resolve(found);
  if(messages.some(message=>message.event==='error'))return Promise.reject(failure('Child reported error'));
  if(exited)return Promise.reject(failure('Child already exited'));
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject};waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(failure('IPC watchdog: '+event));},timeout);waiters.push(waiter);});
 };
 const stop = async () => {if(!exited){proc.kill('SIGKILL');await exit;}};
 if(resources.has(t))resources.get(t).push(stop);else t.after(stop);
 return {proc,messages,wait,exit,stop,release:()=>proc.stdin.write('!'),send:message=>proc.send(message)};
}
export async function operation(t, fx, options, expectedError) {
 const worker = child(t,{cwd:fx.cwd,...options});
 const message = await worker.wait(m=>m.event==='result'||m.event==='error');
 const exit = await worker.exit;
 if(expectedError){assert.equal(exit.code,1);assert.match(message.error,expectedError);return message.error;}
 assert.equal(message.event,'result',message.error);assert.equal(exit.code,0);return message.result;
}
export async function server(t, fx, options = {}) {
 const worker = child(t,{mode:'server',cwd:fx.cwd,config:fx.config,sessions:fx.sessions,...options});
 const ready = await worker.wait(m=>m.event==='ready'||m.event==='error');
 assert.equal(ready.event,'ready',ready.error);
 const port = ready.port, url = `http://127.0.0.1:${port}`;
 const request = (pathname, body, headers = {}, raw) => new Promise((resolve,reject)=>{
  const req = http.request(url+pathname,{method:body===undefined&&raw===undefined?'GET':'POST',headers:{...(body!==undefined||raw!==undefined?{'content-type':'application/json'}:{}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,body:text?JSON.parse(text):null,address:res.socket?.remoteAddress});});
  });
  req.on('error',reject); req.end(raw ?? (body===undefined?undefined:JSON.stringify(body)));
 });
 const route = (action, project = fx.cwd, trace = 't') => `/api/trace/${trace}/review-deletions/${action}?vault=${encodeURIComponent(project)}`;
 const preview = (selection, project, trace) => request(route('preview',project,trace),{selection});
 const commit = (selection, authorization, project, trace) => request(route('commit',project,trace),{selection,authorization});
 const close = async () => {worker.send({command:'close'});assert.equal((await worker.exit).code,0);};
 return {...worker,url,port,request,route,preview,commit,close};
}
export async function authorized(s, selection, project, trace) {
 const result = await s.preview(selection,project,trace); assert.equal(result.status,200); return result.body.preview;
}
export const reviewInput = (title = 'appended', targetIds = []) => ({title,body:title,targetIds});
export const extensionInput = {trace:'t',kind:'finding',title:'extension append',body:'extension append',refs:[{type:'file',path:'fixture.c'}]};
export function oracleSelfCheck() {
 const bytes=Buffer.from(' {"id":"f1","supports":["r1","r1"]}\r\n\n{"id":"r1"}');
 assert.deepEqual(decode(bytes).map(r=>[r.id,r.supports??null]),[['f1',['r1','r1']],['r1',null]]);
 assert.equal(bytes.at(-1),125);
}
