import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { startAutomationScheduler } from '../server/automation-scheduler.js';

function fixture(options = {}) {
  let date = new Date('2026-10-30T01:14:00Z'), tick, record, reads = 0;
  const workers = [], messages = [];
  const env = { AUTOLAUNCH_ENABLED: 'true', DATABASE_URL: 'private', AUTOLAUNCH_WALLET: 'wallet', AUTOLAUNCH_SECRET_KEY: 'secret', SOLANA_RPC_URL: 'rpc', PINATA_JWT: 'jwt', ...options.env };
  const stop = startAutomationScheduler({ env, now: () => date,
    every: fn => { tick = fn; return { unref() {} }; }, cancel: () => {},
    report: message => messages.push(message),
    openStore: async () => { reads++; if (options.failDatabase) throw new Error('private'); return { get: async () => record, close: async () => {} }; },
    launch: (...args) => { const child = new EventEmitter(); child.kill = signal => { child.signal = signal; }; workers.push({ child, args }); return child; },
  });
  return { stop, workers, messages, get reads() { return reads; }, tick: async () => { await tick?.(); await setImmediate(); }, date: value => { date = new Date(value); }, record: value => { record = value; } };
}

test('starts at 09:15 Singapore, prevents overlap and stops the child on shutdown', async () => {
  const f = fixture();
  await f.tick(); assert.equal(f.reads, 0);
  f.date('2026-10-30T01:15:00Z'); await f.tick();
  assert.equal(f.workers.length, 1);
  assert.ok(f.workers[0].args[1][0].endsWith('autolaunch.js'));
  assert.equal(f.workers[0].args[2].windowsHide, true);
  await f.tick(); assert.equal(f.workers.length, 1);
  f.stop(); assert.equal(f.workers[0].child.signal, 'SIGTERM');
  await f.tick(); assert.equal(f.workers.length, 1);
});

test('zero exit with an incomplete journal retries after five minutes', async () => {
  const f = fixture(); f.date('2026-10-30T02:00:00Z'); await f.tick();
  f.workers[0].child.emit('exit', 0);
  await f.tick(); assert.equal(f.workers.length, 1);
  f.date('2026-10-30T02:05:00Z'); await f.tick();
  assert.equal(f.workers.length, 2); f.stop();
});

test('complete and blocked journals are held, and the next date can launch', async () => {
  for (const record of [{ slots: Array.from({ length: 5 }, () => ({ state: 'confirmed', registered: true })) }, { blocked: { reason: 'REVIEW_REQUIRED' }, slots: [] }]) {
    const f = fixture(); f.record(record); f.date('2026-10-30T02:00:00Z'); await f.tick();
    assert.equal(f.workers.length, 0);
    const reads = f.reads; await f.tick(); assert.equal(f.reads, reads);
    f.record(null); f.date('2026-10-31T01:15:00Z'); await f.tick();
    assert.equal(f.workers.length, 1); f.stop();
  }
});

test('disabled or incomplete configurations never load a wallet or start a worker', async () => {
  for (const env of [{ AUTOLAUNCH_ENABLED: 'false' }, { AUTOLAUNCH_SCHEDULER_ENABLED: 'false' }, { AUTOLAUNCH_SECRET_KEY: '' }]) {
    const f = fixture({ env }); f.date('2026-10-30T02:00:00Z'); await f.tick();
    assert.equal(f.workers.length, 0); assert.equal(f.reads, 0); f.stop();
  }
});

test('database failures are retried without exposing raw errors', async () => {
  const f = fixture({ failDatabase: true }); f.date('2026-10-30T02:00:00Z'); await f.tick();
  assert.equal(f.reads, 1); await f.tick(); assert.equal(f.reads, 1);
  f.date('2026-10-30T02:05:00Z'); await f.tick(); assert.equal(f.reads, 2);
  assert.ok(f.messages.every(message => !message.includes('private'))); f.stop();
});

test('startup after the scheduled time catches up immediately', async () => {
  let calls = 0;
  const stop = startAutomationScheduler({
    env: { AUTOLAUNCH_ENABLED: 'true', DATABASE_URL: 'db', AUTOLAUNCH_WALLET: 'wallet', AUTOLAUNCH_SECRET_KEY: 'secret', SOLANA_RPC_URL: 'rpc', PINATA_JWT: 'jwt' },
    now: () => new Date('2026-10-30T02:00:00Z'), every: () => ({}), cancel() {}, report() {},
    openStore: async () => ({ get: async () => null, close: async () => {} }),
    launch: () => { calls++; const child = new EventEmitter(); child.kill = () => {}; return child; },
  });
  await setImmediate(); assert.equal(calls, 1); stop();
});
