// Real Chromium pointer/keyboard regressions, isolated read-only fixture API.
// CHROME_BIN may override the local executable; no browser dependency/install.
import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
const chrome=process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available=await access(chrome).then(()=>true,()=>false);
const records=async path=>(await readFile(new URL(path,import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real pointer/keyboard menus, bounded viewport, readable graph and exact edges', {skip:!available,timeout:90000},async t=>{
 const sample=await records('../examples/full-feature-workspace/.dev-vault/traces/ui-design-sample/trace.jsonl');
 const real=await records('../../.dev-vault/traces/frontend-swap/trace.jsonl').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
 if(!real)t.diagnostic('Local real frontend-swap trace unavailable; real-dataset cases omitted.');
 const special=[...sample.slice(0,3)].map((r,i)=>({...r,id:'x'+i,body:i===0?'Long evidence paragraph. '.repeat(500):r.body,supports:i===0?['x1','x1','x0','missing']:i===1?['x0','x2']:[]}));
 const replies=[['d1','decision',[]],['r1','review',['d1']],['r2','review',['d1']],['r3','review',['r1']]].map(([id,kind,supports])=>({...sample[0],id,kind,title:'Thread '+id,body:'Body '+id,supports}));
 special[0].check={method:'read',output:'Long verification detail. '.repeat(100)};
 special[0].steps=[{action:'Inspect the bounded evidence pane',ref:'fixture:x0'}];
 special.forEach(row=>{row.failureClass='fixture-pattern';});
 const longVault='/fixture/'+('long-project-directory/'.repeat(18))+'vault';
 const datasets={sample,...(real?{real}:{}),special,replies};
 const longTrace='a-very-long-trace-title-that-must-wrap-and-clamp-without-growing-the-four-complete-sidebar-rows';
 const choices=['sample',longTrace,'special','replies','later',...(real?['real']:[])];
 const requests=[];
 let emptyVaults=false;
 const server=createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost'); let value;
   // Simulate a stale server serving new assets but lacking the read-only preview API.
   if(req.method==='POST' && url.pathname.endsWith('/review-deletions/preview')){
    res.statusCode=404;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'not found'}));return;
   }
   if(req.method!=='GET'){res.statusCode=405;res.end('Read-only isolated fixture');return;}
   requests.push(url.pathname+url.search);
   if(url.pathname==='/api/vaults')value=emptyVaults?[]:[{path:'/loaded',name:'Loaded',traceCount:choices.length,default:true},{path:'/other',name:'Other',traceCount:choices.length,default:false},{path:longVault,name:'Long vault',traceCount:choices.length,default:false}];
   else if(url.pathname==='/api/vaults/known')value=[{path:'/discovered',name:'Discovered',loaded:false}];
   else if(url.pathname==='/api/traces')value=choices.map(trace=>({trace,recordCount:(datasets[trace]||sample).length,created:'2026-11-16T20:30:00Z'}));
   else if(url.pathname.startsWith('/api/trace/')){
    const [, , ,id,suffix,recordId]=url.pathname.split('/'); const rows=datasets[id]||sample;
    value=suffix==='patterns'?(id==='special'?[{failureClass:'fixture-pattern',count:rows.length,traceCount:1,agents:['fixture'],records:rows.map(r=>({...r,trace:id}))}]:[]):suffix==='record'?rows.find(r=>r.id===decodeURIComponent(recordId)):{nodes:rows,edges:rows.flatMap(r=>(r.supports||[]).map(target=>({source:r.id,target}))),session:null};
   } else {
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^[\w./-]+$/.test(name)||name.includes('..'))throw Error('Invalid asset');
    const data=await readFile(new URL('../public/'+name,import.meta.url));
    res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);return;
   }
   res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
  } catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const profile=await mkdtemp(join(tmpdir(),'trace-ui-'));
 const browser=spawn(chrome,['--headless=new','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 t.after(async()=>{browser.kill();await once(browser,'exit');await rm(profile,{recursive:true,force:true});});
 let port;
 for(let i=0;i<150&&!port;i++){await sleep(50);port=await readFile(join(profile,'DevToolsActivePort'),'utf8').then(s=>s.split('\n')[0],()=>null);}
 assert(port,'Chrome debugging endpoint started');
 const pages=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(ws,'open');t.after(()=>ws.close());
 let serial=0;const pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const item=pending.get(msg.id);pending.delete(msg.id);msg.error?item.reject(Error(msg.error.message)):item.resolve(msg.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){try{if(await evaluate(expression))return;}catch{/* Navigation can replace the execution context. */}await sleep(30);}assert.fail('Timed out: '+expression);};
 const click=async selector=>{
  // SVG card labels are siblings of the rect but share its click owner. Keep
  // strict containment for all other targets, including progress and controls.
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y),owner=e.closest('.node');return {x,y,hittable:e.contains(hit)||(e.matches('.node-card')&&!!owner&&hit?.closest('.node')===owner)};})()`);
  assert(p.hittable,selector+' must receive the pointer at its visible center');
  delete p.hittable;
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
 };
 // Enter needs its carriage-return text for Chromium to emit keypress and
 // activate native controls such as summary; keyDown alone only tests handlers.
 const key=async key=>{const windowsVirtualKeyCode={Enter:13,Escape:27,End:35,Home:36,ArrowDown:40}[key];await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode});};
 const navigate=async trace=>{await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?trace=${trace}`});await wait(`document.querySelectorAll('.node').length===${datasets[trace].length} && !!document.querySelector('#filterButton')`);};
 // Count the application's real observer callbacks without changing delivery or rendering.
 const observerHook=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.graphResizeCallbacks=0;
  const NativeResizeObserver=window.ResizeObserver;
  window.ResizeObserver=class extends NativeResizeObserver {
   constructor(callback){super((entries,observer)=>{if(entries.some(entry=>entry.target.id==='graph'))window.graphResizeCallbacks++;callback(entries,observer);});}
  };
 `});
 await t.test('sustained idle, trusted pan and orientation preserve bounded graph state',async()=>{
  const snapshot=()=>evaluate(`(()=>{
   const q=s=>document.querySelector(s),rect=s=>{const r=q(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
   const graph=q('#graph'),svg=q('#graphSvg'),matrix=svg.querySelector('g').transform.baseVal.getItem(0).matrix;
   return {graph:rect('#graph'),svg:rect('#graphSvg'),area:rect('.visual-area'),column:rect('.visual-column'),container:rect('.explorer-body'),playback:rect('.playback'),progress:rect('.progress-track'),viewBox:svg.getAttribute('viewBox'),transform:svg.querySelector('g').getAttribute('transform'),callbacks:window.graphResizeCallbacks,selected:q('.node.selected').dataset.id,zoom:q('#zoomValue').textContent,pan:[matrix.e-graph.clientWidth/2,matrix.f-(94+(graph.clientHeight-128)/2)]};
  })()`);
  const settle=async label=>{
   // A bounded settling window is followed by an independent sustained check;
   // repeated growth cannot be hidden by waiting for a single delayed snapshot.
   let previous=await snapshot();
   for(let i=0;i<12;i++){
    await sleep(100);const current=await snapshot();
    if(JSON.stringify(current)===JSON.stringify(previous))return current;
    previous=current;
   }
   assert.fail(label+' never settled: '+JSON.stringify(previous));
  };
  const stable=async label=>{
   const before=await settle(label);
   assert(before.graph.width>0&&before.graph.height>0,label+' nonzero graph');
   for(const name of ['graph','svg','area','playback','progress']){
    const r=before[name],c=before.column;
    assert(r.x>=c.x-1&&r.y>=c.y-1&&r.x+r.width<=c.x+c.width+1&&r.y+r.height<=c.y+c.height+1,label+' bounded '+name);
   }
   for(let i=0;i<6;i++){await sleep(100);assert.deepEqual(await snapshot(),before,label+' unchanged through '+((i+1)*100)+'ms (including observer callbacks)');}
   t.diagnostic(label+': '+JSON.stringify(before));
   return before;
  };
  const logical=state=>({selected:state.selected,zoom:state.zoom,pan:state.pan});
  const drag=async(kind,dy)=>{
   await evaluate(`document.querySelector('#graph').scrollIntoView({block:'center'});window.panPointerTrusted=null;document.querySelector('#graph').addEventListener('pointerdown',event=>{window.panPointerTrusted=event.isTrusted;},{once:true});`);
   const p=await evaluate(`(()=>{const r=document.querySelector('#graph').getBoundingClientRect();for(let y=Math.max(1,r.top+70);y<Math.min(innerHeight-70,r.bottom-70);y+=20){for(let x=r.left+3;x<r.right;x+=20){const hit=document.elementFromPoint(x,y);if(hit?.closest('#graph')&&!hit.closest('.node')&&!hit.closest('button'))return {x,y};}}throw Error('No visible graph background');})()`);
   const before=await settle(kind+' before drag');
   if(kind==='touch'){
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+dy,id:1}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y+dy,button:'left',buttons:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y+dy,button:'left',clickCount:1});
   }
   assert.equal(await evaluate('window.panPointerTrusted'),true,kind+' uses trusted input');
   const after=await stable(kind+' drag '+dy);
   assert.equal(after.selected,before.selected);assert.equal(after.zoom,before.zoom);
   assert(Math.abs(after.pan[0]-before.pan[0])<.01,kind+' preserves horizontal pan');
   assert(Math.abs(after.pan[1]-before.pan[1]-dy)<.1,kind+' logical vertical pan follows pointer');
   return after;
  };
  for(const [width,height] of [[390,844],[430,932],[800,1280],[1063,1400],[1512,758]]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=680});
   await navigate('special');await evaluate('document.fonts.ready');
   const initial=await stable(width+'x'+height);
   if(width<=680)assert.equal(initial.column.height,464,'mobile keeps fixed visual column height');
   await drag('mouse',32);await drag('mouse',-32);
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate('special');await evaluate('document.fonts.ready');await settle('portrait');
  await click('[data-step="x1"]');await click('#zoomIn');
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await drag('touch',32);const portrait=await drag('touch',-20);
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
  for(const [width,height] of [[844,390],[390,844]]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   const resized=await stable('orientation '+width+'x'+height);
   const expected=logical(portrait),actual=logical(resized);
   assert.equal(actual.selected,expected.selected);assert.equal(actual.zoom,expected.zoom);
   actual.pan.forEach((value,i)=>assert(Math.abs(value-expected.pan[i])<.01,'orientation preserves logical pan, not screen center'));
  }
 });
 await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:observerHook.identifier});
 // Focused layout-only regressions: fixture patterns, long path, and an unsaved draft.
 await cdp('Emulation.setDeviceMetricsOverride',{width:1063,height:777,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?trace=special&vault=${encodeURIComponent(longVault)}`});
 await wait(`document.querySelectorAll('.node').length===3 && !!document.querySelector('#filterButton')`);
 assert.equal(await evaluate(`document.querySelector('#vaultLocation').title`),longVault);
 assert(await evaluate(`document.querySelector('#patternsPanel').open`));
 await click('[data-pattern="fixture-pattern"]');
 await click('#patternsPanel > summary');
 assert.equal(await evaluate(`document.querySelector('#patternsPanel').open`),false);
 await click('[data-step="x1"]'); // renderSidebar must not reopen the panel.
 assert.equal(await evaluate(`document.querySelector('#patternsPanel').open`),false);
 await evaluate(`document.querySelector('#search').value='Thread';document.querySelector('#search').dispatchEvent(new Event('input'))`);
 assert.equal(await evaluate(`document.querySelector('#patternsPanel').open`),false);
 await evaluate(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'))`);
 await evaluate(`document.querySelector('#patternsPanel > summary').focus()`);
 assert(await evaluate(`document.activeElement===document.querySelector('#patternsPanel > summary')`));
 await key('Enter');
 assert(await evaluate(`document.querySelector('#patternsPanel').open`));
 assert.equal(await evaluate(`document.querySelector('.node.selected').dataset.id`),'x1');
 assert.equal(await evaluate(`document.querySelector('[data-pattern="fixture-pattern"]').className`),'active');
 await click('[data-tab="review"]');
 await evaluate(`document.querySelector('#reviewText').value='Keep this draft';document.querySelector('#reviewText').dispatchEvent(new Event('input'));document.querySelector('#failureClass').value='draft-class';document.querySelector('#failureClass').dispatchEvent(new Event('input'));document.querySelector('#search').value='Body';document.querySelector('#search').dispatchEvent(new Event('input'))`);
 await evaluate(`document.querySelector('#filter').value=${JSON.stringify(special[1].kind)};document.querySelector('#filter').dispatchEvent(new Event('change'))`);
 await click('#zoomIn');
 // Compare logical pan, not the viewport center translation changed by resizing.
 const sidebarState=()=>evaluate(`(()=>{const q=s=>document.querySelector(s),g=q('#graph'),tr=q('#graphSvg > g').getAttribute('transform'),xy=tr.match(/translate\\(([-.0-9]+) ([-.0-9]+)\\)/);return {url:location.href,vault:q('#vaultSelect').value,query:q('#search').value,filter:q('#filter').value,pattern:q('[data-pattern="fixture-pattern"]').className,selected:q('.node.selected').dataset.id,zoom:q('#zoomValue').textContent,pan:[Number(xy[1])-g.clientWidth/2,Number(xy[2])-(94+(g.clientHeight-128)/2)],draft:q('#reviewText').value,failure:q('#failureClass').value,targets:[...q('#reviewTargets').selectedOptions].map(o=>o.value)};})()`);
 const beforeSidebar=await sidebarState(),beforeRequests=requests.length;
 const redraw=()=>evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 await click('#sidebarToggle');await redraw();
 assert(await evaluate(`document.querySelector('#sidebarContent').hidden && document.querySelector('#sidebarToggle').getAttribute('aria-expanded')==='false' && document.querySelector('#sidebarToggle').getAttribute('aria-label')==='Expand sidebar' && document.querySelector('#sidebarToggle').getAttribute('aria-controls')==='sidebarContent' && document.querySelector('.session-sidebar').getBoundingClientRect().width===0 && document.querySelector('.app').getBoundingClientRect().left===0`));
 assert.deepEqual(await sidebarState(),beforeSidebar);
 await key('Enter');await redraw();
 assert.equal(await evaluate(`document.querySelector('#sidebarToggle').getAttribute('aria-label')`),'Collapse sidebar');
 assert.deepEqual(await sidebarState(),beforeSidebar);
 assert.equal(requests.length,beforeRequests,'toggles never reload the trace');
 assert(await evaluate(`document.querySelector('#patternsPanel > summary').textContent==='RECORD TAGS' && document.querySelector('.tag-help').textContent.includes('reviews and other records') && document.querySelector('#patternList').textContent.includes('3 records') && document.querySelector('#reviewForm').textContent.includes('Tag (optional)')`),'tags explain grouping without calling every record a failure');
 const detailsWidth=await evaluate(`document.querySelector('#graph').clientWidth`);
 await click('#detailsToggle');await redraw();
 assert(await evaluate(`document.querySelector('#details').hidden && document.querySelector('#detailsToggle').getAttribute('aria-expanded')==='false' && document.querySelector('#detailsToggle').textContent.trim()===document.querySelector('#prev').textContent.trim() && document.querySelector('#detailsPanel').getBoundingClientRect().width===0`));
 assert(await evaluate(`document.querySelector('#graph').clientWidth>${detailsWidth}`),'collapsing details gives its width to the graph');
 assert.deepEqual(await sidebarState(),beforeSidebar,'details collapse preserves draft, filters and logical viewport');
 await click('#timelineTab');
 assert(await evaluate(`document.querySelector('#details').hidden`),'view switching retains panel state');
 await click('#detailsToggle');await redraw();
 assert(await evaluate(`!document.querySelector('#details').hidden && document.querySelector('#detailsToggle').textContent.trim()===document.querySelector('#next').textContent.trim()`));
 await click('#graphTab');await redraw();
 assert.deepEqual(await sidebarState(),beforeSidebar);
 assert.equal(requests.length,beforeRequests,'both panel toggles and mode switches are layout-only');
 for(const width of [1512,1063,800,390,320]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:777,deviceScaleFactor:1,mobile:width<681});await redraw();
  assert(await evaluate(`(()=>{const p=document.querySelector('#vaultLocation'),b=document.querySelector('#copyVaultPath'),r=p.getBoundingClientRect(),s=b.getBoundingClientRect(),row=p.parentElement.getBoundingClientRect(),side=document.querySelector('.session-sidebar').getBoundingClientRect();return p.textContent===p.title && getComputedStyle(p).textOverflow==='ellipsis' && p.scrollWidth>p.clientWidth && Math.abs((r.top+r.height/2)-(s.top+s.height/2))<2 && r.left>=side.left && s.right<=side.right && row.right<=side.right && document.documentElement.scrollWidth<=innerWidth;})()`),'path and copy icon stay in one bounded row at '+width);
  assert(await evaluate(`(()=>{const q=s=>document.querySelector(s),size=e=>{const r=e.getBoundingClientRect();return [r.width,r.height].join(',');};return ['#sidebarToggle','#detailsToggle'].every(s=>size(q(s))===size(q('#fullscreen')));})()`),'both tabs match fullscreen dimensions at '+width);
  await click('#sidebarToggle');await redraw();
  assert(await evaluate(`(()=>{const q=s=>document.querySelector(s),button=q('#sidebarToggle').getBoundingClientRect(),title=q('#traceTitle').getBoundingClientRect();return q('.session-sidebar').getBoundingClientRect().width===0 && q('.app').getBoundingClientRect().left===0 && parseFloat(getComputedStyle(q('.session-sidebar')).borderRightWidth)===0 && button.right<=innerWidth && (button.right<=title.left || button.bottom<=title.top) && document.documentElement.scrollWidth<=innerWidth && q('#sidebarToggle').textContent.trim()===q('#next').textContent.trim();})()`),'zero-width sidebar leaves only the accessible tab at '+width);
  await key('Enter');await redraw();
  assert(await evaluate(`(()=>{const button=document.querySelector('#sidebarToggle').getBoundingClientRect(),side=document.querySelector('.session-sidebar').getBoundingClientRect();return innerWidth<=680 || Math.abs(button.left-side.right)<=1;})()`),'sidebar toggle is an attached outer edge tab');
  await click('#detailsToggle');await redraw();
  assert(await evaluate(`document.querySelector('#details').hidden && document.querySelector('#detailsToggle').getBoundingClientRect().width>0 && document.documentElement.scrollWidth<=innerWidth`),'detail tab stays reachable and bounded at '+width);
  await key('Enter');await redraw();
  assert(await evaluate(`!document.querySelector('#details').hidden && document.querySelector('#detailsToggle').getAttribute('aria-controls')==='details'`));
 }
 // Trusted click invokes the clipboard; controlled mocks isolate permission outcomes.
 await evaluate(`window.copiedPaths=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async path=>{window.copiedPaths.push(path)}}})`);
 await click('#copyVaultPath');await wait(`document.querySelector('#toast').textContent==='Vault path copied.'`);
 assert.deepEqual(await evaluate('window.copiedPaths'),[longVault]);
 await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Permission denied','NotAllowedError')}}})`);
 await click('#copyVaultPath');await wait(`document.querySelector('#toast').textContent.startsWith('Unable to copy')`);
 await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.querySelector('#toast').textContent=''`);
 await click('#copyVaultPath');await wait(`document.querySelector('#toast').textContent.startsWith('Unable to copy')`);
 emptyVaults=true;
 await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait(`document.querySelector('#vaultLocation')?.textContent==='No vault loaded'`);
 assert(await evaluate(`document.querySelector('#copyVaultPath').disabled`),'no-vault copy is disabled');
 emptyVaults=false;
 for(const [width,height] of [[1063,777],[1512,758]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  for(const trace of Object.keys(datasets)){
   await navigate(trace);
   await evaluate('document.fonts.ready');
   assert(await evaluate(`!document.querySelector('#dataCheck').open && document.documentElement.scrollHeight<=innerHeight`),'collapsed Data check fits the desktop without document scroll');
   const list=await evaluate(`(()=>{const l=document.querySelector('#traceList'),box=l.getBoundingClientRect(),rows=[...l.children].map(e=>e.getBoundingClientRect());return {height:l.clientHeight,scrollHeight:l.scrollHeight,width:l.clientWidth,scrollWidth:l.scrollWidth,top:box.top,bottom:box.bottom,rows:rows.map(r=>({top:r.top,bottom:r.bottom,height:r.height})),tooltip:l.children[1].querySelector('strong').title,longTitle:l.children[1].querySelector('strong').getBoundingClientRect().height,patternsOutside:!l.contains(document.querySelector('.patterns'))};})()`);
   assert.equal(list.height,296);assert(list.scrollHeight>list.height);
   assert.equal(list.rows[0].top-list.top,4,'first row starts at the list top padding');
   assert.equal(list.bottom-list.rows[3].bottom,4,'fourth row ends at the list bottom padding');
   assert.equal(list.scrollWidth,list.width,'trace list has no horizontal overflow');
   assert.equal(list.rows.filter(r=>r.top>=list.top&&r.bottom<=list.bottom).length,4,'exactly four complete rows are visible');
   assert(list.rows[4].top>=list.bottom,'no partial fifth row');
   assert(list.rows.slice(0,4).every(r=>r.height===69));assert.equal(list.tooltip,longTrace);assert(list.longTitle>15&&list.longTitle<=30,'long title occupies two clamped lines');assert(list.patternsOutside);
   assert(await evaluate(`(()=>{const row=document.querySelector('#traceList').children[1],title=row.querySelector('strong'),date=row.querySelector('small'),box=row.getBoundingClientRect(),style=getComputedStyle(row);return title.getBoundingClientRect().top>=box.top+parseFloat(style.paddingTop)&&date.getBoundingClientRect().bottom<=box.bottom-parseFloat(style.paddingBottom)&&date.scrollHeight<=date.clientHeight;})()`),'two-line title and full date fit inside the compact row padding');
   await evaluate(`document.querySelector('#traceList').scrollTop=document.querySelector('#traceList').scrollHeight`);
   assert(await evaluate(`(()=>{const l=document.querySelector('#traceList'),r=l.children[4].getBoundingClientRect(),b=l.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom;})()`),'scroll reveals later rows completely');
   await evaluate(`document.querySelector('#traceList').scrollTop=0`);
   assert.equal(await evaluate(`(()=>{const l=document.querySelector('#traceList'),extra=[...l.children].slice(2);extra.forEach(e=>e.remove());const height=l.clientHeight;extra.forEach(e=>l.append(e));return height;})()`),150,'two traces use only two rows, without blank space');
   const check=await evaluate(`(()=>{const q=s=>document.querySelector(s),r=e=>e.getBoundingClientRect();return {gap:r(q('.visual-column')).bottom-r(q('.playback')).bottom,row:r(q('.explorer-body')).height,details:r(q('#details')).height,font:12*Number(q('#zoomValue').textContent.replace('%',''))/100,selected:r(q('.node.selected .node-card')).toJSON(),graph:r(q('#graph')).toJSON(),pairs:[...document.querySelectorAll('.support-edge')].map(e=>[e.dataset.source,e.dataset.target]),sequence:document.querySelectorAll('.sequence-edge').length};})()`);
   assert(Math.abs(check.gap)<2);assert(Math.abs(check.row-check.details)<2);assert(check.font>=11);
   assert(await evaluate(`['SOURCE REFERENCES','VERIFICATION CHECK'].every(label=>!document.querySelector('#detailContent').textContent.includes(label))`),'source references and verification checks are absent even with populated record fields');
   assert(await evaluate(`![...document.querySelectorAll('#detailContent .section-label')].some(e=>e.textContent==='SUPPORTS')`),'support connections use navigable controls rather than a duplicate raw block');
   if(trace==='special'){
    assert(await evaluate(`document.querySelector('#details').scrollHeight>document.querySelector('#details').clientHeight`),'long evidence scrolls inside details');
    assert(await evaluate(`['ORDERED STEPS','SUPPORT CONNECTIONS'].every(label=>document.querySelector('#detailContent').textContent.includes(label))`));
    await click('.connection[data-select="x1"]');
    assert.equal(await evaluate(`document.querySelector('.node.selected').dataset.id`),'x1');
    await click('[data-tab="review"]');
    assert(await evaluate(`document.querySelector('#detailContent').textContent.includes('No reviews for this record.') && !!document.querySelector('#reviewForm')`),'non-review records keep their normal empty-review message');
    await click('[data-tab="detail"]');
   }
   if(trace==='replies'){
    await click('[data-tab="review"]');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.review-card .trace-id')].map(e=>e.textContent)`),['r1','r2']);
    await evaluate(`document.querySelector('#reviewText').value='Draft survives selection';document.querySelector('#reviewText').dispatchEvent(new Event('input'))`);
    for(const [id,expected] of [['r1',['r3']],['r3',[]]]){
     await click(`[data-step="${id}"]`);
     assert.deepEqual(await evaluate(`[...document.querySelectorAll('.review-card .trace-id')].map(e=>e.textContent)`),expected);
     assert(await evaluate(`['#reviewForm','#reviewTargets','#reviewText','#failureClass','#reviewForm button[type="submit"]'].every(s=>!!document.querySelector(s)) && !document.querySelector('#detailContent h2') && !document.querySelector('#detailContent').textContent.includes('No reviews for this record.')`));
     assert.equal(await evaluate(`document.querySelector('#reviewText').value`),'Draft survives selection');
    }
    await click('[data-step="r2"]');await click('[data-tab="detail"]');await click('[data-tab="review"]');
    assert.equal(await evaluate(`document.querySelector('#reviewText').value`),'Draft survives selection');
    assert.equal(await evaluate(`document.querySelectorAll('.review-card').length`),0);
    await click('[data-tab="detail"]');
   }
   assert(check.selected.x>=check.graph.x && check.selected.right<=check.graph.right);
   const ids=new Set(datasets[trace].map(r=>r.id));
   assert.deepEqual(check.pairs,datasets[trace].flatMap(r=>(r.supports||[]).filter(id=>ids.has(id)).map(id=>[r.id,id])));
   const targeted=datasets[trace].filter(r=>r.kind==='review'&&(r.supports||[]).some(id=>id!==r.id&&ids.has(id)));
   assert.equal(check.sequence,datasets[trace].length-targeted.length-1);
   assert(await evaluate(`[...document.querySelectorAll('.sequence-edge')].every(e=>e.getAttribute('stroke')==='#e96847'&&!e.hasAttribute('stroke-dasharray'))`),'main sequence is original solid orange');
   if(trace==='real'){
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.branch-node')].map(e=>[e.dataset.id,e.dataset.layoutParent])`),[['r1','d1'],['r2','d1'],['r3','r1']]);
    assert(await evaluate(`[...document.querySelectorAll('.sequence-edge')].every(e=>!['r1','r2','r3'].includes(e.dataset.source)&&!['r1','r2','r3'].includes(e.dataset.target))`));
    assert(await evaluate(`[...document.querySelectorAll('.support-edge')].filter(e=>['r1','r2','r3'].includes(e.dataset.source)).every(e=>e.getAttribute('stroke')==='#4e78d5')`),'reviews retain their real blue kind');
    for(const id of ['r1','r2','r3']){
     await click(`[data-step="${id}"]`);
     assert.equal(await evaluate(`document.querySelector('.node.selected').dataset.id`),id);
     assert.equal(await evaluate(`document.querySelector('#zoomValue').textContent`),'100%');
     assert(await evaluate(`(()=>{const c=document.querySelector('.node.selected .node-card').getBoundingClientRect(),g=document.querySelector('#graph').getBoundingClientRect();return c.x>=g.x&&c.right<=g.right&&c.y>=g.y&&c.bottom<=g.bottom;})()`),'selected branch card is readable and inside viewport');
     // Progress is the supported way to reveal an offscreen branch. Click the
     // card itself, not the bounding box of the SVG group (which includes its stem).
     await evaluate(`window.branchPointer=null;document.addEventListener('click',event=>{window.branchPointer={trusted:event.isTrusted,id:event.target.closest('.node')?.dataset.id};},{once:true,capture:true})`);
     await click(`.node[data-id="${id}"] .node-card`);
     assert.deepEqual(await evaluate(`window.branchPointer`),{trusted:true,id});
     assert.equal(await evaluate(`document.querySelector('.node.selected').dataset.id`),id);
    }
    if(width===1512){
     // At the wider viewport the nested reply is visible beside its parent;
     // prove a pointer click changes selection, not just reselects the same card.
     await click('[data-step="r1"]');
     assert(await evaluate(`(()=>{const c=document.querySelector('.node[data-id="r3"] .node-card').getBoundingClientRect(),g=document.querySelector('#graph').getBoundingClientRect();return c.x>=g.x&&c.right<=g.right&&c.y>=g.y&&c.bottom<=g.bottom;})()`));
     await click('.node[data-id="r3"] .node-card');
     assert.equal(await evaluate(`document.querySelector('.node.selected').dataset.id`),'r3');
    }
   }
   await click('#reset');assert(await evaluate(`Number(document.querySelector('#zoomValue').textContent.replace('%',''))<100`));
   await click('#readable');assert.equal(await evaluate(`document.querySelector('#zoomValue').textContent`),'100%');
   await click('#progress button:last-child');
   assert(await evaluate(`(()=>{const c=document.querySelector('.node.selected .node-card').getBoundingClientRect(),g=document.querySelector('#graph').getBoundingClientRect();return c.x>=g.x&&c.right<=g.right&&c.y>=g.y&&c.bottom<=g.bottom;})()`));
   if(trace==='real')assert(await evaluate(`document.querySelector('#dataCheckContent').textContent.includes('Main sequence: file order, not support')`));
  }
 }
 await cdp('Emulation.setTimezoneOverride',{timezoneId:'UTC'});
 await navigate('sample');
 const assertFilterRectangle=async()=>{
  const box=await evaluate(`(()=>{const b=document.querySelector('#filterButton'),l=document.querySelector('#filterListbox'),r=b.getBoundingClientRect(),m=l.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(b);return {button:r.toJSON(),menu:m.toJSON(),content:range.getBoundingClientRect().width,viewport:innerWidth};})()`);
  assert(Math.abs(box.menu.right-box.button.right)<2,'Types popup right edge aligns with trigger');
  assert(Math.abs(box.menu.top-box.button.bottom-4)<2,'Types popup stays below trigger');
  assert(box.menu.left>=8 && box.menu.right<=box.viewport-8,'Types popup stays inside viewport');
  assert(box.button.width-box.content<=28,'Types trigger has balanced compact padding');
  assert(box.button.width<100,'All types trigger is content-sized, not forced to 100px');
 };
 await click('#filterButton');await assertFilterRectangle();await key('Escape');
 // Exercise the actual viewport boundary without changing other toolbar controls.
 await evaluate(`Object.assign(document.querySelector('#filterButton').parentElement.style,{position:'fixed',right:'8px',top:'100px',zIndex:'101'})`);
 await click('#filterButton');await assertFilterRectangle();
 await cdp('Emulation.setDeviceMetricsOverride',{width:900,height:758,deviceScaleFactor:1,mobile:false});
 await wait(`Math.abs(document.querySelector('#filterListbox').getBoundingClientRect().right-document.querySelector('#filterButton').getBoundingClientRect().right)<2`);
 await assertFilterRectangle();await key('Escape');
 await click('#filterButton');await assertFilterRectangle();await key('Escape');
 await evaluate(`document.querySelector('#filterButton').parentElement.removeAttribute('style')`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1512,height:758,deviceScaleFactor:1,mobile:false});
 const sidebarDate=await evaluate(`document.querySelector('.trace-choice small').textContent`);
 assert(sidebarDate.includes('Nov 16, 2026, 20:30'));
 assert(!/\d{4}-\d{2}-\d{2}T|\b(?:AM|PM)\b/.test(sidebarDate));
 await click('#timelineTab');
 const timelineDates=await evaluate(`[...document.querySelectorAll('.timeline-item .time')].map(e=>e.textContent)`);
 assert(timelineDates.length>0);
 for(const date of timelineDates){
  assert.match(date,/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}$/);
  assert(!/\d{4}-\d{2}-\d{2}T|\b(?:AM|PM)\b/.test(date));
 }
 await click('#graphTab');
 await click('#filterButton');await click('#filterListbox [data-value="decision"]');
 const count=sample.filter(r=>r.kind==='decision').length;
 assert.equal(await evaluate(`document.querySelector('#filter').value`),'decision');
 assert.equal(await evaluate(`document.querySelector('#filterButton').textContent`),'Decision ▾');
 assert.equal(await evaluate(`Number(document.querySelector('#matchingcount').textContent)`),count);
 assert.equal(await evaluate(`document.querySelectorAll('.node:not(.fade)').length`),count);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.node:not(.fade)')].map(e=>e.dataset.id)`),sample.filter(r=>r.kind==='decision').map(r=>r.id));
 await click('#timelineTab');assert.equal(await evaluate(`document.querySelectorAll('.timeline-item').length`),count);
 await click('#clearFilters');assert.equal(await evaluate(`Number(document.querySelector('#matchingcount').textContent)`),sample.length);
 await click('#filterButton');await key('End');await key('Enter');assert.equal(await evaluate(`document.querySelector('#filter').value`),'deadend');
 await click('#filterButton');await key('Home');await key('ArrowDown');await key('Enter');assert.equal(await evaluate(`document.querySelector('#filter').value`),'finding');
 await click('#filterButton');await key('Escape');assert.equal(await evaluate(`document.activeElement.id`),'filterButton');
 await click('#filterButton');await click('#traceTitle');assert(await evaluate(`document.querySelector('#filterListbox').hidden`));
 await click('.vault-picker summary');await click('#knownVaultsButton');await click('#knownVaultsListbox [data-value="/discovered"]');
 assert.equal(await evaluate(`document.querySelector('#vaultPath').value`),'/discovered');
 assert.equal(await evaluate(`document.activeElement.id`),'vaultPath');
 assert.equal(await evaluate(`document.querySelector('#knownVaults').value`),'/discovered');
 await click('#knownVaultsButton');await key('Home');await key('Enter');
 assert.equal(await evaluate(`document.querySelector('#vaultPath').value`),'');
 await click('#knownVaultsButton');await key('End');await key('Enter');
 assert.equal(await evaluate(`document.querySelector('#vaultPath').value`),'/discovered');
 const beforeSwitch=requests.length;
 await click('#vaultSelectButton');await click('#vaultSelectListbox [data-value="/other"]');
 // Vault navigation fetches asynchronously; filtering above must be synchronous.
 await wait(`new URL(location.href).searchParams.get('vault')==='/other' && document.querySelectorAll('.node').length===${sample.length}`);
 assert.equal(await evaluate(`document.querySelector('#vaultSelect').value`),'/other');
 assert.equal(await evaluate(`document.querySelector('#vaultSelectButton').textContent`),`Other · ${choices.length} traces ▾`);
 assert(requests.slice(beforeSwitch).includes('/api/traces?vault=%2Fother'));
 assert(requests.slice(beforeSwitch).includes('/api/trace/sample?vault=%2Fother'));
 await click('#vaultSelectButton');await key('Home');await key('Enter');
 await wait(`new URL(location.href).searchParams.get('vault')==='/loaded' && document.querySelectorAll('.node').length===${sample.length}`);
 assert.equal(await evaluate(`document.querySelector('#vaultSelect').value`),'/loaded');
 await navigate('replies');await click('[data-step="r1"]');await click('#stageReviewDeletion');
 await click('#previewDeletions');
 await wait(`document.querySelector('#toast').textContent.includes('Reopen with /trace-view')`);
 assert(await evaluate(`document.querySelector('#toast').textContent.includes('Nothing has been deleted') && document.querySelector('.node[data-id="r1"]').dataset.staged==='true' && !document.querySelector('#previewDeletions').disabled && !document.querySelector('dialog')`),'missing preview API gives recovery guidance without losing staged selection');
 await click('#cancelDeletions');
});
