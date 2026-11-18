// Real installed Chromium/CDP only; missing runtime is a required-case failure,
// classified invalid by the evidence runner, never a passing skip.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
export async function browser(t, fx, url) {
 const chrome=process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 assert(fs.existsSync(chrome),'required Chromium unavailable');
 assert.equal(typeof WebSocket,'function','required native WebSocket unavailable');
 const profile=path.join(fx.directory,'chrome-'+Date.now());
 const proc=spawn(chrome,['--headless=new','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let stderr='';proc.stderr.on('data',chunk=>{stderr+=chunk;});
 let exited=false;const exit=once(proc,'exit').then(()=>{exited=true;});
 fx.cleanup(async()=>{if(!exited){proc.kill('SIGKILL');await exit;}});
 let port;
 // This is endpoint readiness polling, not a concurrency ordering oracle.
 for(let i=0;i<150&&!port;i++){
  if(exited)assert.fail('required Chromium exited: '+stderr);
  port=await fs.promises.readFile(path.join(profile,'DevToolsActivePort'),'utf8').then(s=>s.split('\n')[0],()=>null);
  if(!port)await sleep(40);
 }
 assert(port,'required Chromium endpoint unavailable');
 const pages=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(ws,'open');
 fx.cleanup(()=>ws.close());
 const pending=new Map(), listeners=new Set(), events=[];let serial=0;
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}
  else {events.push(message);for(const listener of [...listeners])listener(message);}
 });
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP watchdog: '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const next=(method,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(listener);reject(Error('CDP event watchdog: '+method));},10000);
  const listener=message=>{if(message.method===method&&predicate(message.params)){clearTimeout(timer);listeners.delete(listener);resolve(message.params);}};listeners.add(listener);
 });
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{/* A navigation may replace the execution context. */}await sleep(30);}assert.fail('DOM watchdog: '+expression);};
 const point=async selector=>{
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('Target obstructed: '+${JSON.stringify(selector)});return {x,y};})()`);
 };
 const click=async selector=>{
  const p=await point(selector);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
 };
 const key=async key=>{const code={Enter:13,Escape:27,ArrowDown:40,Home:36,End:35}[key];await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});};
 const button=async text=>{
  const selector=await evaluate(`(()=>{const e=[...document.querySelectorAll('dialog button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Dialog button missing');e.dataset.fixtureAction='target';return 'dialog [data-fixture-action="target"]';})()`);
  await click(selector);
 };
 const navigate=async destination=>{await cdp('Page.navigate',{url:destination});await wait(`document.querySelectorAll('.node').length>0`);};
 const guard=async(action,accept,type='confirm')=>{
  const opening=next('Page.javascriptDialogOpening');const triggered=action();
  const dialog=await opening;assert.equal(dialog.type,type);
  await cdp('Page.handleJavaScriptDialog',{accept});await triggered;return dialog;
 };
 await cdp('Page.enable');await cdp('Network.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1512,height:1000,deviceScaleFactor:1,mobile:false});
 await navigate(url);
 const stage=async id=>{await click(`[data-step="${id}"]`);await click('#stageReviewDeletion');await wait(`document.querySelector('[data-unstage="${id}"]')!==null`);};
 const preview=async()=>{await click('#previewDeletions');await wait(`!!document.querySelector('dialog[open]')`);};
 const staged=async()=>evaluate(`[...document.querySelectorAll('.node[data-staged="true"]')].map(e=>e.dataset.id)`);
 const dialogText=()=>evaluate(`document.querySelector('dialog')?.textContent`);
 const marked=async ids=>{
  assert.deepEqual(await staged(),ids);
  for(const id of ids){
   assert(await evaluate(`document.querySelector('.node[data-id="${id}"]').textContent.includes('[staged]')`));
   assert(await evaluate(`document.querySelector('[data-row="${id}"]').textContent.includes('staged for deletion')`));
  }
 };
 const close=async()=>{ws.close();if(!exited){proc.kill('SIGKILL');await exit;}};
 return {cdp,next,evaluate,wait,click,key,button,navigate,guard,stage,preview,staged,dialogText,marked,events,close};
}
