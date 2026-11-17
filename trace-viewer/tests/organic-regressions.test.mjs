import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({module:{exports:{}}});
vm.runInContext(await readFile(new URL('../public/organic-layout.js',import.meta.url),'utf8'),context);
const graph=context.module.exports;
const plain=value=>JSON.parse(JSON.stringify(value));

test('organic file-order geometry has bounded, noncolliding full-size cards at 40 records',()=>{
 const records=Array.from({length:40},(_,i)=>({id:'f'+i,kind:'finding',title:'Record '+i}));
 const data=graph.layoutLive(records,[]);
 assert.equal(data.nodes.length,40);assert.equal(data.sequence.length,39);assert.equal(data.edges.length,0);
 assert.deepEqual(plain(data.nodes.map(n=>n.id)),records.map(n=>n.id));
 for(let i=0;i<data.nodes.length;i++){
  const n=data.nodes[i];assert(n.x>=(data.nodes[i-1]?.x||0),'left-to-right file order');
  assert.equal(graph.card(n).width,161);assert.equal(graph.card(n).height,83);
  for(const other of data.nodes.slice(i+1))assert(!graph.intersects(graph.card(n),graph.card(other)),`${n.id}/${other.id} overlap`);
 }
 assert(data.bounds.width<40*260);assert(data.bounds.height<40*90);
});

test('supports preserve direction and duplicates, route reciprocity separately, terminate at dots',()=>{
 const nodes=['a','b','c'].map(id=>({id,kind:'finding'}));
 const edges=[{source:'a',target:'b'},{source:'b',target:'a'},{source:'a',target:'b'},{source:'b',target:'b'},{source:'a',target:'c'},{source:'a',target:'missing'}];
 const data=graph.layoutLive(nodes,edges),byId=new Map(data.nodes.map(n=>[n.id,n]));
 assert.deepEqual(plain(data.edges.map(({source,target})=>({source,target}))),edges.slice(0,-1));
 assert.deepEqual(plain(data.danglingEdges),edges.slice(-1));
 assert.equal(new Set(data.edges.map(e=>graph.path(e.curve))).size,5);
 const forward=graph.pointOnCurve(data.edges[0].curve,.5),reverse=graph.pointOnCurve(data.edges[1].curve,.5);
 assert(Math.hypot(forward.x-reverse.x,forward.y-reverse.y)>20);
 for(const edge of data.edges){
  assert(!graph.path(edge.curve).includes('NaN'));
  for(const [point,id] of [[edge.curve.a,edge.source],[edge.curve.d,edge.target]]){
   const n=byId.get(id),ellipse=Math.min((point.x-n.x)**2/121+(point.y-n.y)**2/49,(point.x-n.x)**2/121+(point.y-n.y-4)**2/49);
   // Clip to the visible union, including the lower ellipse/shadow.
   assert(ellipse>.95 && ellipse<1.15,`${edge.source} → ${edge.target}: ${ellipse}`);
  }
 }
 assert.equal(data.sequence.length,2,'file order remains a separate edge collection');
});

function assertGeometry(records,data){
 assert.deepEqual(plain(data.nodes.map(n=>n.id)),records.map(n=>n.id),'JSONL order is retained');
 assert.equal(data.nodes.length,new Set(data.nodes.map(n=>n.id)).size,'no lost or duplicate records');
 for(const n of data.nodes){
  assert(Number.isFinite(n.x)&&Number.isFinite(n.y));
  for(const other of data.nodes.filter(o=>o.id!==n.id))assert(!graph.intersects(graph.card(n),graph.card(other)),`${n.id}/${other.id} overlap`);
  assert(n.cx>=data.bounds.x&&n.cy>=data.bounds.y);
  assert(n.cx+graph.CARD.width<=data.bounds.x+data.bounds.width);
  assert(n.cy+graph.CARD.height<=data.bounds.y+data.bounds.height);
 }
 for(const e of data.edges)for(let i=0;i<=100;i++){
  const p=graph.pointOnCurve(e.curve,i/100);
  assert(p.x>=data.bounds.x-1&&p.x<=data.bounds.x+data.bounds.width+1);
  assert(p.y>=data.bounds.y-1&&p.y<=data.bounds.y+data.bounds.height+1);
 }
}

test('real frontend-swap reviews fan beside d1 with r3 nested, without changing raw supports',async()=>{
 // Read-only snapshot: never call the live trace API or write to the vault.
 const records=(await readFile(new URL('../../.dev-vault/traces/frontend-swap/trace.jsonl',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
 const edges=records.flatMap(n=>(n.supports||[]).map(target=>({source:n.id,target})));
 const before=JSON.stringify(records),data=graph.layoutLive(records,edges),byId=new Map(data.nodes.map(n=>[n.id,n]));
 assertGeometry(records,data);
 assert.equal(JSON.stringify(records),before);
 for(const [id,parent] of [['r1','d1'],['r2','d1'],['r3','r1']]){
  const n=byId.get(id),p=byId.get(parent);
  assert.equal(n.layoutParent,parent);
  assert(n.x>p.x&&n.x-p.x<=250,'branch advances locally, not to end of spine');
  assert(n.y<p.y,'review blue branch grows outward above its parent');
  assert(!data.main.some(m=>m.id===id));
 }
 assert.deepEqual(plain(data.main.map(n=>n.id)),records.filter(n=>!['r1','r2','r3'].includes(n.id)).map(n=>n.id));
 assert.deepEqual(plain(data.edges.map(({source,target})=>({source,target}))),edges);
 assert.equal(data.edges.length,edges.length,'no synthetic parent arrows');
});

test('forward, nested, multi-target, missing, self and cyclic reviews retain every node and support',()=>{
 const records=[
  {id:'reply',kind:'review',supports:['review']},
  {id:'root',kind:'finding',supports:[]},
  {id:'review',kind:'review',supports:['missing','review','root','sibling','root']},
  {id:'sibling',kind:'review',supports:['root']},
  ...Array.from({length:5},(_,i)=>({id:'chain'+i,kind:'review',supports:[i?'chain'+(i-1):'reply']})),
  {id:'missing',kind:'finding',supports:[]},
  {id:'untargeted',kind:'review',supports:['absent']},
  {id:'self',kind:'review',supports:['self']},
  {id:'cycleA',kind:'review',supports:['cycleB']},
  {id:'cycleB',kind:'review',supports:['cycleA']},
  {id:'normal',kind:'decision',supports:['root'],parent:'root',merge:'reply'}
 ];
 // The first existing non-self target wins, not the last or the title.
 const edges=records.flatMap(n=>n.supports.map(target=>({source:n.id,target})));
 const data=graph.layoutLive(records,edges),byId=new Map(data.nodes.map(n=>[n.id,n]));
 assertGeometry(records,data);
 assert.equal(byId.get('review').layoutParent,'missing');
 assert.equal(byId.get('reply').layoutParent,'review');
 for(const id of ['root','untargeted','self','normal','cycleA'])assert.equal(byId.get(id).layoutParent,null);
 assert.equal(byId.get('normal').parent,'root','raw metadata survives display parent derivation');
 assert.equal(byId.get('normal').merge,'reply');
 assert.equal(byId.get('cycleB').layoutParent,'cycleA');
 assert.deepEqual(plain(data),plain(graph.layoutLive(records,edges)),'cycle resolution and placement are deterministic');
 const valid=edges.filter(e=>byId.has(e.target));
 assert.deepEqual(plain(data.edges.map(({source,target})=>({source,target}))),valid);
 assert.deepEqual(plain(data.danglingEdges),edges.filter(e=>!byId.has(e.target)));
 assert.equal(data.sequence.length,data.main.length-1);
});
