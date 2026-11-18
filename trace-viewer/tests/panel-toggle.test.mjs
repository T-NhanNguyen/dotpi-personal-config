import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/panel-toggle.js', import.meta.url), 'utf8');
const context = vm.createContext({module:{exports:{}}});
vm.runInContext(source, context);
const {mount} = context.module.exports;
function panel(side) {
 const attributes = new Map(), classes = new Set(), changes = [];
 const button = {dataset:{}, classList:{add:value=>classes.add(value)}, setAttribute:(key,value)=>attributes.set(key,value)};
 const content = {id:`${side}-content`, hidden:false, draft:{text:'Preserve this draft'}};
 mount({button,content,side,label:'test panel',onChange:value=>changes.push(value)});
 return {button,content,attributes,classes,changes};
}
for (const [side,expanded,collapsed] of [['left','‹','›'],['right','›','‹']]) {
 test(`${side} edge tab reverses arrows and retains accessible state and content identity`, () => {
  const p = panel(side), draft = p.content.draft;
  assert(p.classes.has('panel-toggle'));
  assert.equal(p.button.dataset.side,side);
  assert.equal(p.attributes.get('aria-controls'),p.content.id);
  assert.equal(p.attributes.get('aria-expanded'),'true');
  assert(p.button.innerHTML.includes(expanded));
  assert.deepEqual(p.changes,[],'mount does not trigger layout side effects');
  p.button.onclick();
  assert.equal(p.content.hidden,true);
  assert.equal(p.attributes.get('aria-expanded'),'false');
  assert.equal(p.attributes.get('aria-label'),'Expand test panel');
  assert.equal(p.button.title,'Expand test panel');
  assert(p.button.innerHTML.includes(collapsed));
  p.button.onclick();
  assert.equal(p.content.hidden,false);
  assert.equal(p.attributes.get('aria-label'),'Collapse test panel');
  assert(p.button.innerHTML.includes(expanded));
  assert.equal(p.content.draft,draft,'toggle never replaces content');
  assert.deepEqual(p.changes,[true,false]);
 });
}
test('panel controls are independent', () => {
 const left = panel('left'), right = panel('right');
 left.button.onclick();
 assert.equal(left.content.hidden,true);
 assert.equal(right.content.hidden,false);
 right.button.onclick(); right.button.onclick();
 assert.equal(left.content.hidden,true);
 assert.equal(right.content.hidden,false);
});
