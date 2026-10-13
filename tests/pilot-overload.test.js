import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { databaseConfig } from '../server/database-config.js';
import { createIndexerQueue } from '../server/indexer-queue.js';
import { createPilotControl } from '../server/pilot-control.js';

test('isolated pilot overload: priorities, dedup, leases, temporary failures, shared quota and cooldown', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const base = process.env.YEETNEST_TEST_DATABASE_URL;
  const schema = 'pilot_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client(databaseConfig(base));
  await admin.connect();
  let q, second, control, replica;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query('CREATE TABLE indexed_trades(pool text,block_time bigint,slot bigint); CREATE TABLE catalogue_coins(mint text PRIMARY KEY,data jsonb)');
    for (const migration of ['005-indexer-jobs.sql', '007-worker-heartbeats.sql', '014-small-launchpad.sql']) await admin.query(await readFile(new URL('../server/migrations/' + migration, import.meta.url), 'utf8'));
    const url = new URL(base); url.searchParams.set('options', '-c search_path=' + schema);
    let clock = Date.now();
    q = createIndexerQueue(url.href, { name: 'pump', now: () => clock, maxAttempts: 1, leaseMs: 1000 });
    second = createIndexerQueue(url.href, { name: 'pump', now: () => clock, maxAttempts: 1, leaseMs: 1000 });
    await q.enqueue([{ signature: 'old', priority: 0 }, { signature: 'live', priority: 3 }, { signature: 'backfill', priority: 1 }]);
    await q.enqueue([{ signature: 'live', priority: 2 }]);
    const live = await q.claim(); assert.equal(live.signature, 'live');
    await q.fail(live, 'RPC_RATE_LIMIT');
    assert.equal((await q.status('live')).attempts, 0);
    const others = await Promise.all([q.claim(), second.claim()]);
    assert.equal(new Set(others.map(job => job.signature)).size, 2);
    for (const job of others) await q.complete(job);
    clock += 60001;
    const retried = await q.claim(); assert.equal(retried.signature, 'live'); await q.complete(retried);
    assert.equal((await q.status('live')).status, 'done');
    assert.equal((await q.stats()).completedLastMinute, 1);
    await q.enqueue([{ signature: 'invalid' }]); await q.fail(await q.claim(), 'INVALID_TRANSACTION');
    assert.equal((await q.status('invalid')).status, 'failed');
    assert.equal(await q.recoverTransient(), 0);
    await q.enqueue([{ signature: 'restart' }]); const lease = await q.claim(); clock += 1001;
    assert.equal(await second.complete(lease), false);
    assert.equal((await second.claim()), null);
    await q.enqueue(Array.from({ length: 12 }, (_, n) => ({ signature: 'burst-' + n, priority: n % 2 ? 2 : 1 })));
    let completed = 0;
    for (let n = 0; n < 6; n++) {
      const batch = await Promise.all([q.claim(), second.claim()]);
      assert.equal(new Set(batch.map(job => job.signature)).size, 2);
      for (const job of batch) { assert.equal(await q.complete(job), true); completed++; }
    }
    assert.equal(completed, 12);
    await admin.query("UPDATE indexer_jobs SET error_code='RPC_TIMEOUT',updated=$1 WHERE signature='invalid'", [clock - 300001]);
    assert.equal(await q.recoverTransient(1), 1);
    assert.equal((await q.status('invalid')).status, 'pending');
    control = createPilotControl(url.href); replica = createPilotControl(url.href);
    await control.touch('active');
    assert.ok((await replica.targets()).some(row => row.mint === 'active'));
    const starts = [];
    const fetcher = async () => { starts.push(Date.now()); return new Response('{}'); };
    await Promise.all([control.fetch(fetcher, 100)('https://rpc.example'), replica.fetch(fetcher, 100)('https://rpc.example')]);
    assert.ok(starts[1] - starts[0] >= 85);
    await control.fetch(async () => new Response('{}', { status: 429 }), 100)('https://quota.example');
    const cooldown = await admin.query('SELECT cooldown_until FROM rpc_budgets WHERE cooldown_until>0');
    assert.ok(Number(cooldown.rows[0].cooldown_until) > Date.now());
    const stop = new AbortController(); stop.abort(new Error('Shutdown'));
    await assert.rejects(replica.fetch(fetcher, 100, stop.signal)('https://quota.example'), /Shutdown/);
  } finally {
    await Promise.all([q?.close(), second?.close(), control?.close(), replica?.close()]);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});
