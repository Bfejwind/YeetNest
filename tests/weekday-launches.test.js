import test from 'node:test';
import assert from 'node:assert/strict';
import { singaporeDay, configureScheduleWallet, loadSchedule, saveSchedule, nextScheduled, executeScheduled, rotatingTemplate, animalArtwork } from '../src/weekday-launches.js';
function setup() {
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 configureScheduleWallet(()=>'owner');return values;
}
test('09:15 Singapore boundary applies every day, including both weekend days',()=>{
 for(const date of ['2026-10-24','2026-10-25','2026-10-26']) {
  assert.equal(singaporeDay(new Date(date+'T01:14:59Z')).due,false);
  assert.equal(singaporeDay(new Date(date+'T01:15:00Z')).due,true);
 }
 assert.equal(singaporeDay(new Date('2026-10-25T16:00:00Z')).date,'2026-10-26');
 assert.equal(singaporeDay(new Date('2026-10-25T16:00:00Z')).due,false);
});
test('legacy two-slot schedule expands to five, preserves attempts, caps daily queue and isolates wallet',()=>{
 const values=setup();const now=new Date('2026-10-26T01:15:00Z');
 saveSchedule({enabled:true,wallet:'owner',templates:[{},{}],attempts:{'2026-10-26:0':{state:'needs-recovery'}}});
 assert.equal(loadSchedule().templates.length,5);
 for(let i=1;i<5;i++) {
  assert.equal(nextScheduled(now).key,`2026-10-26:${i}`);
  const s=loadSchedule();s.attempts[`2026-10-26:${i}`]={state:'confirmed'};saveSchedule(s);
 }
 assert.equal(nextScheduled(now),null);
 const tomorrow=new Date('2026-10-27T01:15:00Z');assert.equal(nextScheduled(tomorrow).key,'2026-10-27:0');
 configureScheduleWallet(()=>'other');assert.equal(nextScheduled(tomorrow),null);
 configureScheduleWallet(()=>'owner');values.set('yn-pending-registration','{}');assert.equal(nextScheduled(tomorrow),null);
});
test('stale scheduled review cannot sign',async()=>{
 setup();let executed=false;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_,fn)=>fn()}}});
 await assert.rejects(executeScheduled({key:'2000-01-01:0',wallet:'owner'},{execute:async()=>{executed=true;}}),/Schedule changed/);
 assert.equal(executed,false);
});
test('five portraits per day rotate all ten with matching names and tickers, preserving social links',()=>{
 const images=[];
 for(let day=26;day<=27;day++) for(let slot=0;slot<5;slot++) {
  const index=(day-26)*5+slot;const [file,name,ticker]=animalArtwork[index];
  const t=rotatingTemplate(slot,new Date(`2026-10-${day}T01:15:00Z`),{fields:{name:'Wrong',ticker:'WRONG',website:'https://example.com'}});
  images.push(t.image);assert.equal(t.image,`/weekday-animals/${file}.png`);assert.equal(t.fields.name,name);assert.equal(t.fields.ticker,ticker);
  assert.equal(t.fields.website,'https://example.com');assert.ok(name.length<=32 && /^[A-Z0-9]{1,10}$/.test(ticker));
 }
 assert.equal(new Set(images).size,10);
 assert.equal(rotatingTemplate(0,new Date('2026-10-28T01:15:00Z')).image,images[0]);
 assert.throws(()=>rotatingTemplate(5),/Invalid daily launch slot/);
});
