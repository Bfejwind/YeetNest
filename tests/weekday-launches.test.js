import test from 'node:test';
import assert from 'node:assert/strict';
import { singaporeDay, configureScheduleWallet, loadSchedule, saveSchedule, nextScheduled, executeScheduled } from '../src/weekday-launches.js';
test('Singapore weekday boundary, due hour, two slots, wallet isolation and unresolved registration', () => {
  const values = new Map(); globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  configureScheduleWallet(() => 'owner');
  assert.equal(singaporeDay(new Date('2026-10-25T02:00:00Z')).due, false);
  assert.equal(singaporeDay(new Date('2026-10-26T00:59:00Z')).due, false);
  assert.equal(singaporeDay(new Date('2026-10-26T01:00:00Z')).due, true);
  const now = new Date('2026-10-26T01:00:00Z');
  saveSchedule({ enabled:true, wallet:'owner', templates:[{},{}], attempts:{} });
  assert.equal(nextScheduled(now).key, '2026-10-26:0');
  const s = loadSchedule(); s.attempts['2026-10-26:0'] = { state:'needs-recovery' }; saveSchedule(s);
  assert.equal(nextScheduled(now).key, '2026-10-26:1');
  s.attempts['2026-10-26:1'] = { state:'confirmed' }; saveSchedule(s);
  assert.equal(nextScheduled(now), null);
  configureScheduleWallet(() => 'other'); assert.equal(nextScheduled(new Date('2026-10-27T01:00:00Z')), null);
  configureScheduleWallet(() => 'owner'); values.set('yn-pending-registration', '{}');
  assert.equal(nextScheduled(new Date('2026-10-27T01:00:00Z')), null);
});
test('expired scheduled review cannot request signing', async () => {
  let executed = false;
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ locks:{ request: async (_, fn) => fn() } } });
  await assert.rejects(executeScheduled({key:'2000-01-01:0', wallet:'owner'}, { execute:async()=>{executed=true;} }), /Schedule changed/);
  assert.equal(executed, false);
});
