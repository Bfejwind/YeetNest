import test from 'node:test';
import assert from 'node:assert/strict';
import { singaporeDay, configureScheduleWallet, loadSchedule, saveSchedule, nextScheduled, executeScheduled, rotatingTemplate, animalArtwork } from '../src/weekday-launches.js';
test('Singapore weekday boundary, due hour, two slots, wallet isolation and unresolved registration', () => {
  const values = new Map(); globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  configureScheduleWallet(() => 'owner');
  assert.equal(singaporeDay(new Date('2026-10-25T02:00:00Z')).due, false);
  assert.equal(singaporeDay(new Date('2026-10-26T00:59:00Z')).due, false);
  assert.equal(singaporeDay(new Date('2026-10-26T01:25:00Z')).due, true);
  assert.equal(singaporeDay(new Date('2026-10-26T01:24:59Z')).due, false);
  const now = new Date('2026-10-26T01:25:00Z');
  saveSchedule({ enabled:true, wallet:'owner', templates:[{},{}], attempts:{} });
  assert.equal(nextScheduled(now).key, '2026-10-26:0');
  const s = loadSchedule(); s.attempts['2026-10-26:0'] = { state:'needs-recovery' }; saveSchedule(s);
  assert.equal(nextScheduled(now).key, '2026-10-26:1');
  s.attempts['2026-10-26:1'] = { state:'confirmed' }; saveSchedule(s);
  assert.equal(nextScheduled(now), null);
  configureScheduleWallet(() => 'other'); assert.equal(nextScheduled(new Date('2026-10-27T01:25:00Z')), null);
  configureScheduleWallet(() => 'owner'); values.set('yn-pending-registration', '{}');
  assert.equal(nextScheduled(new Date('2026-10-27T01:25:00Z')), null);
});
test('expired scheduled review cannot request signing', async () => {
  let executed = false;
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ locks:{ request: async (_, fn) => fn() } } });
  await assert.rejects(executeScheduled({key:'2000-01-01:0', wallet:'owner'}, { execute:async()=>{executed=true;} }), /Schedule changed/);
  assert.equal(executed, false);
});

test('ten unique animal portraits rotate two per Singapore weekday and repeat weekly', () => {
  const images = [];
  for (let day = 26; day <= 30; day++) for (let slot = 0; slot < 2; slot++) images.push(rotatingTemplate(slot, new Date(`2026-10-${day}T01:25:00Z`)).image);
  assert.equal(new Set(images).size, 10);
  assert.equal(animalArtwork.length, 10);
  assert.equal(rotatingTemplate(0, new Date('2026-11-02T01:25:00Z')).image, images[0]);
  for (let i = 0; i < animalArtwork.length; i++) {
    const [file, name, ticker] = animalArtwork[i];
    const template = rotatingTemplate(i % 2, new Date(`2026-10-${26 + Math.floor(i / 2)}T01:25:00Z`), { fields: { name:'Wrong animal', ticker:'WRONG', website:'https://example.com' } });
    assert.equal(template.image, `/weekday-animals/${file}.png`);
    assert.equal(template.fields.name, name);
    assert.equal(template.fields.ticker, ticker);
    assert.ok(name.length <= 32 && /^[A-Z0-9]{1,10}$/.test(ticker));
    assert.equal(template.fields.website, 'https://example.com');
  }
});
