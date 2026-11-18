// Representatives 10/11 use built assets and a real writable server, never fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 names,record as r,encode,select,withoutSupports,fixture,server,operation,reviewInput,
} from './review-deletion-support.mjs';
import {browser} from './review-deletion-browser-support.mjs';

const urlFor=(s,fx)=>s.url+'/?trace=t&vault='+encodeURIComponent(fx.cwd);
const traceBytes=fx=>[fx.bytes(),fx.bytes(fx.cwd,'u'),fx.bytes(fx.other),fx.bytes(fx.other,'u')];
const patterns=(ids)=>[{failureClass:'deletion-fixture',count:ids.length,traceCount:1,agents:[],records:ids.map(id=>({trace:'t',id,kind:'review',title:id}))}];
const patternRows=()=>[r('f1'),r('r1',undefined,{failureClass:'deletion-fixture'}),r('r2'),r('r3',['r1'],{failureClass:'deletion-fixture'})];
const confirmDisabled=(b,label)=>b.evaluate(`[...document.querySelectorAll('dialog button')].find(e=>e.textContent===${JSON.stringify(label)}).disabled`);

test(names[9],{timeout:90000},async t=>{
 const rows=patternRows(),fx=fixture(t,rows);
 for(const [project,trace] of [[fx.cwd,'u'],[fx.other,'t'],[fx.other,'u']])fx.seed(rows.map(({failureClass,...r})=>({...r,trace})),project,trace);
 let s=await server(t,fx);assert.equal((await s.request('/api/vaults',{path:fx.other})).status,200);
 let b=await browser(t,fx,urlFor(s,fx));const original=traceBytes(fx);
 assert.deepEqual((await s.request('/api/trace/t/patterns')).body,patterns(['r1','r3']));
 await b.stage('r1');await b.stage('r2');await b.marked(['r1','r2']);assert.deepEqual(traceBytes(fx),original);
 assert(await b.evaluate(`(()=>{const group=document.querySelector('.deletion-actions'),buttons=[...group.children],rects=buttons.map(e=>e.getBoundingClientRect()),reference=getComputedStyle(document.querySelector('#graphTab')),style=getComputedStyle(buttons[0]);return group.classList.contains('segmented-control') && buttons.map(b=>b.textContent).join('/')==='Undo/Review/Cancel' && rects.every(r=>Math.abs(r.top-rects[0].top)<1 && Math.abs(r.width-rects[0].width)<1) && reference.borderRadius===style.borderRadius && reference.fontSize===style.fontSize;})()`),'batch actions are three equal segments using the view-switch styling');
 await b.click('[data-step="r1"]');
 assert.equal(await b.evaluate(`document.querySelector('.deletion-actions [data-unstage]').dataset.unstage`),'r1','Undo targets the selected staged review');
 await b.click('.deletion-actions [data-unstage]');await b.marked(['r2']);assert.deepEqual(traceBytes(fx),original);
 await b.stage('r1');await b.marked(['r1','r2']);
 await b.click('#detailsToggle');
 assert(await b.evaluate(`document.querySelector('#details').hidden`));
 await b.click('[data-step="r2"]');
 assert(await b.evaluate(`document.querySelector('#details').hidden`),'record changes retain collapsed panel state');
 await b.click('#detailsToggle');await b.marked(['r1','r2']);assert.deepEqual(traceBytes(fx),original);
 await b.click('#timelineTab');
 assert(await b.evaluate(`document.querySelector('[data-row="r1"]').getBoundingClientRect().height>0 && document.querySelector('[data-row="r2"]').getBoundingClientRect().height>0`));
 await b.marked(['r1','r2']);assert.deepEqual(traceBytes(fx),original);await b.click('#graphTab');
 assert(await b.evaluate(`document.querySelector('.node[data-id="r1"]').getBoundingClientRect().height>0`));
 await b.preview();let text=await b.dialogText();
 for(const value of ['r1 · r1','body r1','r2 · r2','body r2','r3 · r3: [r1] → trace-level','There is no archive or recovery copy. Cancel writes nothing.'])assert(text.includes(value),value);
 assert.deepEqual(traceBytes(fx),original);
 await b.button('Unstage r1');await b.wait(`document.querySelector('dialog')?.textContent.includes('No surviving parent connections change.')`);
 assert.deepEqual(await b.staged(),['r2']);assert(!(await b.dialogText()).includes('body r1'));assert.deepEqual(traceBytes(fx),original);
 await b.button('Cancel');await b.wait(`!document.querySelector('dialog')`);await b.marked(['r2']);assert.deepEqual(traceBytes(fx),original);
 await b.click('#cancelDeletions');assert.deepEqual(await b.staged(),[]);assert.deepEqual(traceBytes(fx),original);
 await b.stage('r1');
 const discarded=await b.guard(()=>b.click('[data-trace="u"]'),false);assert(discarded.message.includes('Discard staged review deletions'));
 await b.marked(['r1']);assert.equal(await b.evaluate(`new URL(location.href).searchParams.get('trace')`),'t');assert.deepEqual(traceBytes(fx),original);
 await b.guard(()=>b.click('[data-trace="u"]'),true);
 await b.wait(`new URL(location.href).searchParams.get('trace')==='u' && document.querySelectorAll('.node').length===4`);
 assert.deepEqual(await b.staged(),[]);assert.deepEqual(traceBytes(fx),original);
 await b.stage('r2');await b.click('#vaultSelectButton');
 await b.guard(()=>b.click(`#vaultSelectListbox [data-value="${fx.other}"]`),false);await b.marked(['r2']);assert.deepEqual(traceBytes(fx),original);
 await b.click('#vaultSelectButton');await b.guard(()=>b.click(`#vaultSelectListbox [data-value="${fx.other}"]`),true);
 await b.wait(`new URL(location.href).searchParams.get('vault')===${JSON.stringify(fx.other)} && document.querySelectorAll('.node').length===4`);
 assert.deepEqual(await b.staged(),[]);assert.deepEqual(traceBytes(fx),original);
 await b.navigate(urlFor(s,fx));await b.stage('r1');
 // Stage clicked through trusted CDP input supplies the sticky user activation.
 await b.guard(()=>b.cdp('Page.reload'),false,'beforeunload');await b.marked(['r1']);assert.deepEqual(traceBytes(fx),original);
 await b.guard(()=>b.cdp('Page.reload'),true,'beforeunload');
 await b.wait(`document.querySelectorAll('.node').length===4 && !document.querySelector('[data-unstage]')`);
 assert.deepEqual(await b.staged(),[]);assert.deepEqual(traceBytes(fx),original);
 await b.stage('r1');await b.preview();assert.deepEqual(traceBytes(fx),original);await b.button('Permanently delete 1 review');
 await b.wait(`document.querySelectorAll('.node').length===3 && !document.querySelector('.node[data-id="r1"]')`);
 const expected=[rows[0],rows[2],withoutSupports(rows[3])];assert.deepEqual(fx.bytes(),encode(expected));
 assert.equal(await b.evaluate(`document.querySelector('#totalcount').textContent`),'3');
 assert.deepEqual((await s.request('/api/trace/t/patterns')).body,patterns(['r3']));
 assert.deepEqual(traceBytes(fx).slice(1),original.slice(1));
 await b.close();await s.close();s=await server(t,fx);b=await browser(t,fx,urlFor(s,fx));
 await b.wait(`document.querySelectorAll('.node').length===3`);assert.deepEqual(fx.rows(),expected);assert.deepEqual(await b.staged(),[]);
 assert.deepEqual((await s.request('/api/trace/t/patterns')).body,patterns(['r3']));
 await b.close();
 // Protected selection is independently seeded and retains non-review bytes.
 const protectedRows=[{...rows[0],supports:['r2']},...rows.slice(1)];fx.seed(protectedRows);
 b=await browser(t,fx,urlFor(s,fx));const protectedBytes=fx.bytes();await b.stage('r1');await b.stage('r2');await b.preview();
 assert.equal(await confirmDisabled(b,'Permanently delete 2 reviews'),true);assert.equal(await b.evaluate(`document.querySelector('dialog [role="alert"]').textContent`),'r2 · r2 — Protected review: a non-review record directly supports it.');
 await b.button('Unstage r2');await b.wait(`document.querySelector('dialog')?.textContent.includes('body r1') && !document.querySelector('dialog')?.textContent.includes('body r2')`);
 assert.deepEqual(await b.staged(),['r1']);assert.equal(await confirmDisabled(b,'Permanently delete 1 review'),false);assert.deepEqual(fx.bytes(),protectedBytes);
 await b.button('Cancel');await b.click('#cancelDeletions');assert.deepEqual(await b.staged(),[]);assert.deepEqual(fx.bytes(),protectedBytes);fx.clean();
});

test(names[10],{timeout:90000},async t=>{
 const rows=[r('f1'),r('r1'),r('r2'),r('r3',['r1'])],fx=fixture(t,rows),s=await server(t,fx);
 let b=await browser(t,fx,urlFor(s,fx));await b.stage('r1');await b.preview();
 const appended=await operation(t,fx,{mode:'append',input:reviewInput('external r4',['r1'])});assert.equal(appended.id,'r4');
 const appendedBytes=fx.bytes();assert.deepEqual(fx.rows(),[...rows,appended]);
 // Pause the *real* request before delivery, not a fake response. While held,
 // repeated trusted Enter input must not create a second in-flight commit.
 await b.cdp('Fetch.enable',{patterns:[{urlPattern:'*/review-deletions/commit*',requestStage:'Request'}]});
 const paused=b.next('Fetch.requestPaused');const responses=[];
 const commits=()=>b.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.includes('/review-deletions/commit'));
 const click=b.button('Permanently delete 1 review'),request=await paused;await click;
 assert.equal(JSON.parse(request.request.postData).selection[0].id,'r1');
 await b.key('Enter');await b.key('Enter');
 assert.equal(b.events.filter(e=>e.method==='Fetch.requestPaused').length,1);
 assert.equal(commits().length,1);assert.deepEqual(fx.bytes(),appendedBytes);
 const response=b.next('Network.responseReceived',p=>p.response.url.includes('/review-deletions/commit'));
 await b.cdp('Fetch.continueRequest',{requestId:request.requestId});responses.push((await response).response.status);
 await b.wait(`document.querySelector('dialog')?.textContent.includes('r4 · external r4: [r1] → trace-level')`);
 assert.deepEqual(responses,[409]);assert.equal(commits().length,1);await b.marked(['r1']);
 assert((await b.dialogText()).includes('r3 · r3: [r1] → trace-level'));assert.equal(await confirmDisabled(b,'Permanently delete 1 review'),false);
 assert.deepEqual(fx.bytes(),appendedBytes);
 await b.cdp('Fetch.disable');const success=b.next('Network.responseReceived',p=>p.response.url.includes('/review-deletions/commit'));
 await b.button('Permanently delete 1 review');responses.push((await success).response.status);
 await b.wait(`!document.querySelector('.node[data-id="r1"]') && document.querySelectorAll('.node').length===4`);
 assert.deepEqual(responses,[409,200]);assert.equal(commits().length,2);
 assert.deepEqual(fx.bytes(),encode([rows[0],rows[2],withoutSupports(rows[3]),withoutSupports(appended)]));
 await b.close();
 // Both selected snapshots survive refresh; only the changed item is unstaged.
 fx.seed(rows);b=await browser(t,fx,urlFor(s,fx));await b.stage('r1');await b.stage('r2');await b.preview();
 const edited=[rows[0],{...rows[1],body:'edited externally'},...rows.slice(2)];fs.writeFileSync(fx.file(),encode(edited));const editedBytes=fx.bytes();
 const stale=b.next('Network.responseReceived',p=>p.response.url.includes('/review-deletions/commit'));
 await b.button('Permanently delete 2 reviews');assert.equal((await stale).response.status,409);
 await b.wait(`document.querySelector('dialog')?.textContent.includes('Selected review changed.')`);
 assert.equal(await confirmDisabled(b,'Permanently delete 2 reviews'),true);assert.equal(await b.evaluate(`document.querySelector('dialog [role="alert"]').textContent`),'r1 · r1 — Selected review changed.');await b.marked(['r1','r2']);assert.deepEqual(fx.bytes(),editedBytes);
 const text=await b.dialogText();assert(text.includes('body r1'));assert(text.includes('body r2'));
 await b.button('Unstage r1');await b.wait(`document.querySelector('dialog')?.textContent.includes('body r2') && !document.querySelector('dialog')?.textContent.includes('Selected review changed.')`);
 assert.equal(await confirmDisabled(b,'Permanently delete 1 review'),false);await b.marked(['r2']);assert.deepEqual(fx.bytes(),editedBytes);
 await b.button('Permanently delete 1 review');await b.wait(`document.querySelectorAll('.node').length===3`);
 assert.deepEqual(fx.bytes(),encode(edited.filter(r=>r.id!=='r2')));fx.clean();
});
