/* Graph geometry only: keep the original drawing, grow local conversation threads. */
(function(root){
 const CARD={width:161,height:83,padding:26},DOT={width:38,height:34};
 function intersects(a,b,padding=0){return a.x<b.x+b.width+padding&&a.x+a.width+padding>b.x&&a.y<b.y+b.height+padding&&a.y+a.height+padding>b.y;}
 const card=n=>({x:n.cx,y:n.cy,width:CARD.width,height:CARD.height});
 const dot=n=>({x:n.x-DOT.width/2,y:n.y-DOT.height/2,...DOT});
 function pointOnCurve(c,t){if(c.segments){const index=Math.min(c.segments.length-1,Math.floor(t*c.segments.length));return pointOnCurve(c.segments[index],t*c.segments.length-index);}const u=1-t;return {x:u*u*u*c.a.x+3*u*u*t*c.b.x+3*u*t*t*c.c.x+t*t*t*c.d.x,y:u*u*u*c.a.y+3*u*u*t*c.b.y+3*u*t*t*c.c.y+t*t*t*c.d.y};}
 function curve(a,d,side=0,bulge=0){const dx=d.x-a.x;return {a:{x:a.x,y:a.y},b:{x:a.x+Math.max(18,dx*.8-bulge*.9),y:a.y-10+side*bulge},c:{x:d.x-Math.max(55,dx*.42),y:d.y-side*20},d:{x:d.x,y:d.y}};}
 function hits(c,rects,pad=7){let count=0;for(let i=1;i<45;i++){const p=pointOnCurve(c,i/45);if(rects.some(r=>p.x>r.x-pad&&p.x<r.x+r.width+pad&&p.y>r.y-pad&&p.y<r.y+r.height+pad))count++;}return count;}
 const path=c=>{const segments=c.segments||[c];return `M${segments[0].a.x} ${segments[0].a.y} `+segments.map(s=>`C${s.b.x} ${s.b.y},${s.c.x} ${s.c.y},${s.d.x} ${s.d.y}`).join(' ');};
 function around(a,d,side,dx,dy){const w={x:a.x+dx,y:a.y+side*dy},length=Math.hypot(d.x-a.x,d.y-a.y)||1,v={x:(d.x-a.x)/length*40,y:(d.y-a.y)/length*40};return {segments:[{a:{x:a.x,y:a.y},b:dy>dx?{x:a.x+8,y:a.y+side*75}:{x:a.x+80,y:a.y-8},c:{x:w.x-v.x,y:w.y-v.y},d:w},{a:w,b:{x:w.x+v.x,y:w.y+v.y},c:{x:d.x-45,y:d.y-side*20},d:{x:d.x,y:d.y}}]};}

 function layout(items,seeds=[]){
  const original=new Map(seeds.map(n=>[n.id,n])),placed=new Map(),edges=[],obstaclePoints=[];
  const roots=items.filter(n=>!n.parent||!items.some(p=>p.id===n.parent));
  const mainY=x=>440-(x-110)*42/170;
  const available=(candidate)=>!obstaclePoints.some(p=>p.x>candidate.cx-10&&p.x<candidate.cx+CARD.width+10&&p.y>candidate.cy-10&&p.y<candidate.cy+CARD.height+10)&&[...placed.values()].every(n=>!intersects(card(candidate),card(n),CARD.padding)&&!intersects(dot(candidate),card(n),18)&&!intersects(card(candidate),dot(n),18)&&!intersects(dot(candidate),dot(n),22));
  function placeCard(n,preferred){
   const choices=[{cx:n.x-80,cy:n.y+(preferred<0?-120:35)},{cx:n.x-80,cy:n.y+(preferred<0?35:-120)},{cx:n.x+34,cy:n.y-42},{cx:n.x-195,cy:n.y-42}];
   for(const c of choices){const candidate={...n,...c};if(available(candidate))return candidate;}
   return null;
  }
  // Original main and branch positions are anchors; old appended coordinates are never reused.
  const base=items.filter(n=>!n.custom&&original.has(n.id));
  for(const n of base){const seed=original.get(n.id),side=n.parent?(seed.y<mainY(seed.x)?-1:1):0;placed.set(n.id,{...n,x:seed.x,y:seed.y,cx:seed.cx,cy:seed.cy,side});}
  const reserveCurve=c=>{for(let i=0;i<=50;i++)obstaclePoints.push(pointOnCurve(c,i/50));};
  for(const n of base){const p=placed.get(n.parent),q=placed.get(n.id);if(p)reserveCurve({a:p,b:{x:p.x+90,y:p.y-10},c:{x:q.x-130,y:q.y+30},d:q});const m=placed.get(n.merge);if(m)reserveCurve({a:q,b:{x:q.x+160,y:q.y-30},c:{x:m.x-120,y:m.y+30},d:m});}
  const anchoredMain=roots.map(n=>placed.get(n.id)).filter(Boolean);for(let i=1;i<anchoredMain.length;i++){const a=anchoredMain[i-1],d=anchoredMain[i];reserveCurve({a,b:{x:a.x+(d.x-a.x)/3,y:a.y+(d.y-a.y)/3},c:{x:a.x+2*(d.x-a.x)/3,y:a.y+2*(d.y-a.y)/3},d});}
  roots.forEach((n,i)=>{if(placed.has(n.id))return;const x=110+i*170,y=mainY(x);let p=placeCard({...n,x,y,side:0},i%2?-1:1);if(!p){for(let distance=20;!p;distance+=20)for(const side of [i%2?-1:1,i%2?1:-1]){const q={...n,x,y,side:0,cx:x-80,cy:y+side*(120+distance)};if(available(q)){p=q;break;}}}placed.set(n.id,p);});
  const pending=items.filter(n=>!placed.has(n.id));
  while(pending.length){let progress=false;
   for(let i=0;i<pending.length;){const n=pending[i],parent=placed.get(n.parent);if(!parent){i++;continue;}
    const side=parent.side||(n.type==='review'?-1:1);
    let best=null,bestScore=Infinity,bestCurve;
    // Each conversation advances from its own parent and fans outward smoothly.
    // Prefer short, diagonal continuations; search more vertical space before widening.
    const distances=parent.side?[100,140,180,230,290]:[170,210,260,320,390];
    for(let extra=0;extra<=items.length*130;extra+=130){
     for(const dy of distances)for(const dx of [175,210,140,250]){
      const point={...n,x:parent.x+dx,y:parent.y+side*(dy+extra),side};
      const candidate=placeCard(point,side);if(!candidate)continue;
      const rects=[...placed.values()].map(card).concat(card(candidate));
      const routes=[0,35,75,130].map(bulge=>({c:curve(parent,candidate,side,bulge),cost:bulge*.4}));
      if(routes.every(r=>hits(r.c,rects)>0))for(const [wx,wy] of [[125,35],[35,135],[145,90]])routes.push({c:around(parent,candidate,side,wx,wy),cost:45});
      for(const {c,cost} of routes){const crossings=hits(c,rects),score=extra*2+dy+Math.abs(dx-175)*.6+crossings*300+cost;
       if(score<bestScore){best=candidate;bestScore=score;bestCurve=c;}
      }
     }
     if(best&&bestScore<distances.at(-1)+extra*2+300)break;
    }
    placed.set(n.id,best);reserveCurve(bestCurve);edges.push({source:parent.id,target:n.id,type:n.type,curve:bestCurve});pending.splice(i,1);progress=true;
   }
   if(!progress){const n=pending.shift(),x=110+placed.size*175,y=mainY(x);let q={...n,x,y,side:1,cx:x-80,cy:y+35};while(!available(q)){q.y+=150;q.cy+=150;}placed.set(n.id,q);}
  }
  // Seed connections retain the original broad organic arcs.
  for(const n of items){const p=placed.get(n.id),parent=placed.get(n.parent);if(parent&&!edges.some(e=>e.target===n.id)){const c={a:{x:parent.x,y:parent.y},b:{x:parent.x+90,y:parent.y-10},c:{x:p.x-130,y:p.y+30},d:{x:p.x,y:p.y}};edges.push({source:parent.id,target:n.id,type:n.type,curve:c});}
   const merge=placed.get(n.merge);if(merge)edges.push({source:n.id,target:merge.id,type:n.type,curve:{a:{x:p.x,y:p.y},b:{x:p.x+160,y:p.y-30},c:{x:merge.x-120,y:merge.y+30},d:{x:merge.x,y:merge.y}}});
  }
  const positioned=items.map(n=>placed.get(n.id)),main=roots.map(n=>placed.get(n.id)),first=main[0]||{x:110,y:440},last=main.at(-1)||first;
  const start={x:first.x-75,y:first.y+75*42/170},end={x:last.x+85,y:last.y-85*42/170};
  const samples=edges.flatMap(e=>Array.from({length:21},(_,i)=>pointOnCurve(e.curve,i/20)));
  const xs=[start.x-65,end.x+70,...positioned.flatMap(n=>[n.cx-10,n.cx+CARD.width+10,n.x-25,n.x+25]),...samples.map(p=>p.x)];
  const ys=[start.y-14,start.y+30,end.y-14,end.y+30,...positioned.flatMap(n=>[n.cy-10,n.cy+CARD.height+10,n.y-24,n.y+24]),...samples.map(p=>p.y)];
  const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  return {nodes:positioned,main,edges,start,end,bounds};
 }
 // Live graphs keep every drawable support edge; position never implies a connection.
 // Reuse the reference's organic spine geometry without reducing arbitrary
 // supports to the prototype's single-parent conversations.
 function layoutLive(items,supportEdges){
  // Only targeted reviews leave the file-order main sequence. Parentage is
  // display-only: the complete, directed support multigraph remains authoritative.
  const ids=new Set(items.map(n=>n.id)),parents=new Map();
  for(const n of items)if(n.kind==='review'){
   const target=(n.supports||[]).find(id=>id!==n.id&&ids.has(id));
   if(target)parents.set(n.id,target);
  }
  // Break one link per cycle in file order. Forward references remain valid;
  // every resulting chain reaches a main record before layout starts.
  for(const n of items){
   const chain=new Set();let id=n.id;
   while(parents.has(id)){
    if(chain.has(id)){parents.delete(id);break;}
    chain.add(id);id=parents.get(id);
   }
  }
  const base=layout(items.map(n=>({...n,type:n.kind,parent:parents.get(n.id)||null,merge:null})));
  const nodes=base.nodes.map((n,i)=>({...n,parent:items[i].parent,merge:items[i].merge,layoutParent:parents.get(n.id)||null}));
  const branchCurves=new Map(base.edges.map(e=>[e.target,e.curve]));
  const byId=new Map(nodes.map(n=>[n.id,n]));
  // Hand-edited traces may reference absent records. Keep those edges as metadata,
  // but do not let an undrawable connection hide the readable records.
  const danglingEdges=supportEdges.filter(edge=>!byId.has(edge.source)||!byId.has(edge.target));
  const multiplicity=new Map();
  const edges=supportEdges.filter(edge=>byId.has(edge.source)&&byId.has(edge.target)).map(edge=>{
   const a=byId.get(edge.source),d=byId.get(edge.target);
   const key=JSON.stringify([a.id,d.id]),lane=multiplicity.get(key)||0;
   multiplicity.set(key,lane+1);
   // Opposite directions use opposite sides of the spine. Duplicate entries
   // retain their own lanes; endpoints terminate at the ellipse boundary.
   const side=nodes.indexOf(a)<nodes.indexOf(d)?-1:1;
   const bend=65+lane*24+Math.min(160,Math.abs(d.x-a.x)*.12);
   const boundary=(n,p)=>{
    const vx=p.x-n.x,vy=p.y-n.y,A=vx*vx/121+vy*vy/49;
    const B=-8*vy/49,C=16/49-1;
    // Clip to the union of the reference dot and its lower ellipse/shadow.
    const k=Math.max(1/Math.sqrt(A),(-B+Math.sqrt(B*B-4*A*C))/(2*A));
    return {x:n.x+vx*k,y:n.y+vy*k};
   };
   let c;
   // Reverse the placement arc for the first support to the display parent:
   // the arrow still means review → target, never parent → review.
   if(a.layoutParent===d.id&&lane===0){
    const original=branchCurves.get(a.id),segments=(original.segments||[original]).slice().reverse().map(s=>({a:s.d,b:s.c,c:s.b,d:s.a}));
    segments[0]={...segments[0],a:boundary(a,segments[0].b)};
    const last=segments.length-1;segments[last]={...segments[last],d:boundary(d,segments[last].c)};
    c=segments.length===1?segments[0]:{segments};
   }
   else if(a.id===d.id){const loopSide=a.cy<a.y?1:-1,b={x:a.x-70-lane*25,y:a.y+loopSide*(110+lane*25)},control={x:a.x+70+lane*25,y:a.y+loopSide*(110+lane*25)};c={a:boundary(a,b),b,c:control,d:boundary(a,control)};}
   else {
    const dx=d.x-a.x,dy=d.y-a.y;
    // A fixed global side for each direction avoids reversed identical curves.
    const obstacles=nodes.map(card);
    let best=Infinity;
    // Bounded deterministic search prefers short arcs, then fewer card crossings.
    // The direction's half-plane stays fixed, including reciprocal connections.
    for(let extra=0;extra<=600;extra+=50){
     const b={x:a.x+dx/3,y:a.y+dy/3+side*(bend+extra)};
     const control={x:a.x+dx*2/3,y:a.y+dy*2/3+side*(bend+extra)};
     const candidate={a:boundary(a,b),b,c:control,d:boundary(d,control)};
     const score=hits(candidate,obstacles)*1000+extra;
     if(score<best){c=candidate;best=score;}
     if(score<1000)break;
    }
   }
   return {...edge,curve:c};
  });
  const samples=edges.flatMap(e=>Array.from({length:21},(_,i)=>pointOnCurve(e.curve,i/20)));
  const xs=[base.bounds.x,base.bounds.x+base.bounds.width,...nodes.flatMap(n=>[n.cx-15,n.cx+CARD.width+15]),...samples.map(p=>p.x)];
  const ys=[base.bounds.y,base.bounds.y+base.bounds.height,...nodes.flatMap(n=>[n.y-20,n.cy+CARD.height+15]),...samples.map(p=>p.y)];
  const bounds=nodes.length?{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}:{x:0,y:0,width:1,height:1};
  const main=base.main.map(n=>byId.get(n.id));
  const sequence=main.slice(1).map((n,i)=>({source:main[i].id,target:n.id,curve:curve(main[i],n)}));
  return {nodes,main,edges,sequence,danglingEdges,bounds};
 }
 const api={layout,layoutLive,card,dot,intersects,path,pointOnCurve,hits,CARD};if(typeof module==='object')module.exports=api;else root.OrganicGraph=api;
})(typeof window==='object'?window:globalThis);
