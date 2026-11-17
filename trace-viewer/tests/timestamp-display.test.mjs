import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Each process starts with a controlled local timezone, independent of the host.
function formattedIn(timezone) {
 const script = `
  const fs=require('node:fs'), vm=require('node:vm');
  const context=vm.createContext({module:{exports:{}}});
  vm.runInContext(fs.readFileSync('public/app.js','utf8'),context);
  const {formatTimestamp,hydrate}=context.module.exports;
  const values=['2026-11-16T20:30:00Z','2026-11-16T00:00:00Z',null,undefined,'','not a date',42];
  const record={id:'a',ts:values[0],kind:'finding'};
  const node=hydrate({nodes:[{id:'a'}]},[record])[0];
  console.log(JSON.stringify({display:values.map(formatTimestamp),raw:node.time,source:record.ts}));
 `;
 return JSON.parse(execFileSync(process.execPath,['-e',script],{
  cwd:new URL('..',import.meta.url),env:{...process.env,TZ:timezone},encoding:'utf8'
 }));
}

test('timestamps use local readable dates and h23 time without changing raw values',()=>{
 const utc=formattedIn('UTC'), local=formattedIn('America/New_York');
 assert.deepEqual(utc.display,[
  'Nov 16, 2026, 20:30','Nov 16, 2026, 00:00',
  'Not recorded','Not recorded','Not recorded','Invalid timestamp','Invalid timestamp'
 ]);
 assert.equal(local.display[0],'Nov 16, 2026, 15:30');
 assert.equal(local.display[1],'Nov 15, 2026, 19:00');
 assert.equal(utc.raw,'2026-11-16T20:30:00Z');
 assert.equal(utc.source,utc.raw);
});
