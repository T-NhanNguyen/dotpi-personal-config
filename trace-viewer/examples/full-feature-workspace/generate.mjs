// Deterministic, entirely fictional fixture. No application or session data is read.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const main = 'ui-design-sample';
const rows = [
 ['concept','Request leases are not cache TTLs','A fictional request lease bounds admission, while cache TTL bounds reuse. These clocks must not share a deadline.'],
 ['evidence','Synthetic alert opens incident','Fictional alert: checkout error ratio 18%, p99 4.2 s; no customers or production systems exist here.'],
 ['finding','Admission queue grows before CPU','Synthetic counters show queue depth rising two minutes before CPU.'],
 ['path','Narrow the fictional outage boundary','Start at the client, compare admission counters, then inspect lease renewal.'],
 ['evidence','Client retries are bounded','Fictional client configuration caps retries at two.'],
 ['deadend','DNS failure does not explain queue growth','Fictional resolver replay returned stable addresses; this rejects DNS as the primary cause.'],
 ['finding','Lease renewal stalls under queue pressure','Fictional replay shows renewals waiting behind ordinary requests.'],
 ['decision','Separate renewal from request admission','Choose a dedicated renewal lane; reject increasing global concurrency because it amplifies downstream load.'],
 ['evidence','Synthetic lease histogram has a cliff','Fictional expiry buckets cluster at exactly 30 seconds.'],
 ['concept','A retry storm is a feedback loop','Timeout → retry → more queued work → timeout. A retry budget breaks the loop, not the first slow request.'],
 ['deadend','More worker threads do not restore leases','Fictional replay doubled worker count but the renewal queue still expired.'],
 ['finding','Shared queue is the bottleneck','Independent fictional counters and replay agree on a shared admission gate.'],
 ['evidence','Synthetic scheduler excerpt','```text\nrenewal_lane = ordinary\nlease_window = 30s\n```\nThis is illustrative markdown, not an executable configuration.'],
 ['path','Reproduce without a real service','Construct a fake clock, hold ordinary work, advance time, inspect expired leases.'],
 ['decision','Use a bounded dedicated lane','Reserve two fictional renewal slots and reject unbounded priority queues to avoid starving normal work.'],
 ['evidence','Fake-clock replay reproduces expiry','Fictional check output: 12/12 simulated leases expired before the fix.'],
 ['finding','Lease loss explains synthetic 503s','The fake gateway rejects requests whose lease has expired even when workers remain idle.'],
 ['review','Synthetic human asks for fairness evidence','SYNTHETIC HUMAN REVIEW: confirm normal work still makes progress before accepting the dedicated lane.'],
 ['review','Synthetic human requests a smaller rollout','SYNTHETIC HUMAN REVIEW: the mechanism looks plausible; keep rollout bounded to the fake canary.'],
 ['decision','Gate rollout on fairness and expiry','Accept the lane only if ordinary work progresses and the fake-clock expiry counter stays zero.'],
 ['deadend','Disabling all timeouts hides rather than fixes','The fictional queue drains eventually, but the request budget becomes unbounded.'],
 ['evidence','Fairness replay keeps ordinary work moving','Fictional output: normal completions=200; renewal completions=40; starvation=0.'],
 ['finding','Dedicated lane preserves both budgets','Synthetic replay meets fairness and renewal deadlines under the modeled load.'],
 ['path','Stage a fictional canary','Run baseline, enable the dedicated lane for the fake canary, compare equal windows, then roll back the simulation.'],
 ['evidence','Synthetic canary window is clean','Fictional output: expired=0, synthetic_503=0, p99=180ms.'],
 ['decision','Proceed only inside the simulation','The fictional canary meets the gate; no real rollout is authorized or performed.'],
 ['review','Synthetic human accepts the modeled gate','SYNTHETIC HUMAN REVIEW: accept the simulation result, not a production safety claim.'],
 ['concept','Simulation evidence has a boundary','A fake clock proves modeled ordering only; it does not establish network latency, scheduler fairness, or production capacity.'],
 ['finding','Real deployment capacity remains unknown','No real deployment is available in this fixture. Capacity remains explicitly unverified.'],
 ['evidence','Synthetic runbook separates two clocks','Fictional runbook page 7 distinguishes request budget from renewal budget.'],
 ['decision','Document evidence limits','Keep the model boundary visible and require a separate deployment review outside this sample.'],
 ['deadend','Cache purge cannot repair admission ordering','Synthetic cache-hit and cache-miss paths fail equally while renewals are blocked.'],
 ['finding','Cache changes are not needed for this model','The fictional replay isolates admission ordering without modifying cached data.'],
 ['review','Synthetic human leaves a trace-wide note','SYNTHETIC HUMAN REVIEW: this untargeted note stays on the timeline; it does not approve every record.'],
 ['path','Close the fictional investigation','Preserve the replay summary, record rejected alternatives, list unknowns, and hand off to a fictional reviewer.'],
 ['evidence','Synthetic final replay summary','Fictional final output:\nbaseline expired=12\ndedicated lane expired=0\nnormal work progressed=true'],
 ['finding','Modeled outage cause is renewal starvation','Within this fictional model, a shared queue starves lease renewal and causes admission failures.'],
 ['decision','Keep the bounded-lane recommendation','Recommend only the modeled change; reject timeout removal and broad worker expansion.'],
 ['review','Synthetic human records residual uncertainty','SYNTHETIC HUMAN REVIEW: retain the unknown capacity finding and repeat fairness checks in any future model.'],
 ['concept','Disconnected notebook glossary','A canary here is a fake workload partition, not a host. This glossary has no supports links and remains logically disconnected.'],
];
const links = {3:['e1'],4:['f1'],5:['f1'],6:['f1'],7:['f1','e2'],8:['f2'],9:['f2'],11:['f2'],12:['f2','e3'],13:['f3'],14:['f3'],15:['d1','f3'],16:['d2'],17:['f3','e5'],18:['d2'],19:['d2'],20:['d2','r1'],21:['d3'],22:['d3'],23:['e6','d3'],24:['f5'],25:['p3'],26:['e7','f5'],27:['d4'],30:['c1'],31:['f6','c3'],32:['f3'],33:['x4'],35:['d5'],36:['p4'],37:['e9','f4'],38:['f8','d4'],39:['d6','f6']};
const counts = {}; const prefix = {finding:'f',decision:'d',concept:'c',path:'p',evidence:'e',deadend:'x',review:'r'};
const records = rows.map(([kind,title,body],i) => {
 const id = `${prefix[kind]}${counts[kind] = (counts[kind] ?? 0)+1}`;
 const r = {id,trace:main,kind,title:`[SYNTHETIC] ${title}`,body:`SYNTHETIC FIXTURE — ${body}`,refs:[{type:'other',note:'Fictional incident notebook; not a real source.'}],ts:new Date(Date.UTC(2030,0,15,10,i)).toISOString()};
 if (links[i+1]) r.supports=links[i+1];
 if (i===39) r.supports=[];
 const confidence=['verified','inferred','unverified',undefined][i%4];
 if(confidence) r.confidence=confidence;
 if(confidence==='verified') r.check={method:'fictional replay',output:'SYNTHETIC CHECK ONLY: modeled observation matched the scenario.',revision:'synthetic-revision-001'};
 if(i!==39) r.agent=kind==='review'?'human':['synthetic-investigator','synthetic-replay','synthetic-scribe'][i%3];
 if(i<32) r.session='synthetic-outage-main';
 else if(i<35) r.session='synthetic-outage-secondary';
 if([5,6,10,11,20,31].includes(i)) r.failureClass='renewal-starvation';
 if(kind==='path') r.steps=[{action:'Read the fictional baseline',ref:'synthetic://notebook/baseline'},{action:'Compare the modeled counterexample',ref:'synthetic://notebook/replay'},{action:'Record the bounded conclusion',ref:'synthetic://notebook/summary'}];
 return r;
});
records[1].refs=[{type:'measurement',path:'synthetic://metrics/checkout',lines:'1-4',page:'2',note:'Fictional measurements; no telemetry collected.'}];
records[4].refs=[{type:'file',path:'/synthetic/nonportable/service/client.ts',lines:'12-28',note:'Illustrative path; does not exist.'}];
records[5].refs=[{type:'command',path:'synthetic-replay --resolver',note:'Illustrative only; do not execute.'}];
records[8].refs=[{type:'url',path:'https://outage.example.invalid/leases',note:'Reserved invalid domain.'}];
records[29].refs=[{type:'datasheet',path:'Synthetic lease protocol (invented)',page:'7',note:'Not a real vendor document.'}];
records[27].body += '\n\n**Model boundary — α → β**\n\n'+('Fictional scheduler fairness is an assumption, not a measured deployment property. The bounded replay excludes packet loss, multi-region failover, and process pauses. A clean synthetic result therefore supports only the modeled queue ordering.\n\n').repeat(3)+'Next evidence would need independent timing measurements; none are claimed by this sample.';
const companion=[{id:'x1',trace:'ui-design-companion',kind:'deadend',title:'[SYNTHETIC] Earlier timeout increase failed',body:'SYNTHETIC FIXTURE — A separate invented billing incident kept renewals in the ordinary lane. Increasing the deadline only postponed expiry.',refs:[{type:'other',note:'Fictional historical comparison.'}],failureClass:'renewal-starvation',confidence:'verified',check:{method:'fictional historical replay',output:'SYNTHETIC CHECK ONLY: expiry persisted.'},agent:'synthetic-historian',session:'synthetic-companion',ts:'2030-01-14T09:00:00.000Z'},{id:'f1',trace:'ui-design-companion',kind:'finding',title:'[SYNTHETIC] Queue policy recurs across invented incidents',body:'SYNTHETIC FIXTURE — The same failure class joins traces, not their local record IDs.',refs:[{type:'other',note:'Fictional comparison.'}],supports:['x1'],failureClass:'renewal-starvation',confidence:'inferred',agent:'synthetic-historian',session:'synthetic-companion',ts:'2030-01-14T09:01:00.000Z'}];
async function save(file,data){await mkdir(dirname(file),{recursive:true});await writeFile(file,data);}
for(const [trace,data,created] of [[main,records,'2030-01-15T10:00:00.000Z'],['ui-design-companion',companion,'2030-01-14T09:00:00.000Z']]){
 await save(join(root,'.dev-vault/traces',trace,'trace.jsonl'),data.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await save(join(root,'.dev-vault/traces',trace,'meta.json'),JSON.stringify({trace,created},null,2)+'\n');
}
const stamp=n=>`2030-01-15T10:${String(n).padStart(2,'0')}:00.000Z`;
for(const session of ['synthetic-outage-main','synthetic-outage-secondary','synthetic-companion']){
 const entries=[{type:'session',version:3,id:session,timestamp:stamp(0),cwd:'/synthetic/nonportable/workspace'},
 {type:'message',id:'system',parentId:null,timestamp:stamp(0),message:{role:'system',content:'SYNTHETIC SYSTEM: omitted from timeline.'}},
 {type:'message',id:'u1',parentId:'system',timestamp:stamp(1),message:{role:'user',content:'SYNTHETIC USER: investigate only the fictional outage.'}},
 {type:'message',id:'abandoned',parentId:'u1',timestamp:stamp(59),message:{role:'assistant',content:'SYNTHETIC ABANDONED BRANCH: should not appear.'}},
 {type:'message',id:'a1',parentId:'u1',timestamp:stamp(2),message:{role:'assistant',content:[{type:'thinking',thinking:'SYNTHETIC reasoning: compare the two modeled queues.'},{type:'text',text:'SYNTHETIC α → β: inspect the fake renewal queue.'},{type:'toolCall',id:'call1',name:'synthetic_replay',arguments:{mode:'fake-clock'}}]}},
 {type:'message',id:'t1',parentId:'a1',timestamp:stamp(3),message:{role:'toolResult',content:[{type:'toolResult',content:[{type:'text',text:'SYNTHETIC replay: expired=12'}]}]}},
 {type:'message',id:'a2',parentId:'t1',timestamp:stamp(4),message:{role:'assistant',content:'SYNTHETIC conclusion: the longer branch wins, not the newest short leaf.\nNo real service was contacted.'}}];
 await save(join(root,'sessions','--synthetic-nonportable-workspace--',`2030-01-15T10-00-00-000Z_${session}.jsonl`),entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
}
console.log('Generated SYNTHETIC fixture: 40 main + 2 companion records; 3 session files.');
