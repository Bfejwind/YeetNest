import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createAppStore } from '../server/app-store.js';
import { databaseConfig } from '../server/database-config.js';
import { createCommunityStore } from '../server/community-store.js';
import { Keypair } from '@solana/web3.js';
import { createSecurityStore } from '../server/security-store.js';
import { createChainIndexStore } from '../server/chain-index-store.js';
import { createIndexerQueue } from '../server/indexer-queue.js';

test('PostgreSQL queue claims across replicas, recovers leases and retains failed jobs', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const name = `test:${randomUUID()}`;
  let time = Date.now();
  const first = createIndexerQueue(databaseUrl, { name, now: () => time, leaseMs: 1000, maxAttempts: 2 });
  const second = createIndexerQueue(databaseUrl, { name, now: () => time, leaseMs: 1000, maxAttempts: 2 });
  const cleanup = new pg.Client(databaseConfig(databaseUrl));
  try {
    await Promise.all([first.ready(), second.ready()]);
    const rows = Array.from({ length: 8 }, (_, i) => ({ signature: `fixture:${i}`, slot: i, blockTime: 100 }));
    await Promise.all([first.enqueue(rows), second.enqueue(rows)]);
    assert.equal((await first.stats()).pending, 8);
    const jobs = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).claim()));
    assert.equal(new Set(jobs.map(job => job.signature)).size, 8);
    assert.equal(await first.claim(), null);
    for (const job of jobs.slice(1)) assert.equal(await first.complete(job), true);
    time += 1001;
    const recovered = await second.claim();
    assert.equal(recovered.signature, jobs[0].signature);
    assert.notEqual(recovered.lease_token, jobs[0].lease_token);
    assert.equal(await first.complete(jobs[0]), false);
    await second.fail(recovered, '-32015');
    assert.equal((await first.stats()).failed, 1);
    assert.equal(await second.claim(), null);
    await first.enqueue([{ signature: 'retry-fixture', slot: 9 }]);
    const retry = await first.claim();
    await first.fail(retry, 'RPC_TIMEOUT');
    assert.equal(await second.claim(), null);
    time += 2001;
    const next = await second.claim();
    assert.equal(next.signature, 'retry-fixture');
    assert.equal(await second.complete(next), true);
  } finally {
    await cleanup.connect();
    await cleanup.query('DELETE FROM indexer_jobs WHERE queue_name=$1', [name]);
    await Promise.all([first.close(), second.close(), cleanup.end()]);
  }
});

test('PostgreSQL chain index deduplicates trades and builds exact normalized candles', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const index = createChainIndexStore(databaseUrl);
  const cleanup = new pg.Client(databaseConfig(databaseUrl));
  const mint = Keypair.generate().publicKey.toBase58(), pool = Keypair.generate().publicKey.toBase58();
  const launch = { pool, mint, creator: mint, config: mint, platform: mint, name: 'Controlled index fixture', ticker: 'FIXTURE', uri: '', decimals: 6, status: 0, raised: '3000000000', target: '85000000000', supply: '1000000000000000', created: 1700000000000, slot: 100 };
  try {
    await index.ready();
    await index.saveLaunch(launch);
    const trade = { signature: `fixture:${randomUUID()}`, index: 'cpi:1:1', pool, slot: 101, blockTime: 1700000000, side: 'buy', base: '2000000', quote: '3000000000', fees: '1000000' };
    await Promise.all([index.saveTrade(trade), index.saveTrade(trade)]);
    assert.equal((await index.trades(mint)).length, 1);
    const candles = await index.candles(mint, { since: 1699999900 });
    assert.equal(candles.length, 1);
    assert.equal(Number(candles[0].close), 1.5);
    assert.equal(Number(candles[0].volume), 3);
    assert.equal((await index.list({ query: mint, status: 0 })).length, 1);
    assert.equal((await index.list({ query: mint, status: 2 })).length, 0);
    await index.saveLaunch({ ...launch, status: 2, slot: 99 });
    assert.equal((await index.getLaunch(mint)).status, 0);
    await index.saveLaunch({ ...launch, name: '', ticker: '', uri: '', status: 2, slot: 102 });
    await index.saveLaunch({ ...launch, uri: 'https://example.com/late-metadata.json', status: 0, slot: 99 });
    const enriched = await index.getLaunch(mint);
    assert.equal(enriched.status, 2);
    assert.equal(Number(enriched.slot), 102);
    assert.equal(enriched.uri, 'https://example.com/late-metadata.json');
    assert.deepEqual(await index.candles(mint), []);
  } finally {
    await cleanup.connect();
    await cleanup.query('DELETE FROM indexed_trades WHERE pool=$1', [pool]);
    await cleanup.query('DELETE FROM indexed_launches WHERE pool=$1', [pool]);
    await Promise.all([index.close(), cleanup.end()]);
  }
});

test('PostgreSQL authorization survives reopen and consumes once across instances', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const key = randomUUID();
  const first = createSecurityStore(null, Date.now, databaseUrl);
  const second = createSecurityStore(null, Date.now, databaseUrl);
  try {
    await Promise.all([first.ready(), second.ready()]);
    await first.put('verification', key, { wallet: 'test-wallet', expires: Date.now() + 60000 });
    assert.equal((await second.get('verification', key)).wallet, 'test-wallet');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).take('verification', key)));
    assert.equal(results.filter(Boolean).length, 1);
    const counts = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).rate('verification-rate', key, 60000)));
    assert.deepEqual(counts.sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
    await first.put('verification', key, { wallet: 'reopened-wallet', expires: Date.now() + 60000 });
    const reopened = createSecurityStore(null, Date.now, databaseUrl);
    try { assert.equal((await reopened.get('verification', key)).wallet, 'reopened-wallet'); }
    finally { await reopened.close(); }
  } finally {
    await first.take('verification', key);
    await first.take('verification-rate', key);
    await Promise.all([first.close(), second.close()]);
  }
});

test('PostgreSQL application writes serialize, persist and reopen', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const key = `verification:${randomUUID()}`;
  const store = createAppStore({ databaseUrl });
  const cleanup = new pg.Client(databaseConfig(databaseUrl));
  let reopened;
  try {
    await store.ready();
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.mutate(key, entries => entries.push({ i }))));
    assert.equal((await store.get(key)).length, 10);
    await store.close();
    reopened = createAppStore({ databaseUrl });
    await reopened.ready();
    assert.equal((await reopened.get(key)).length, 10);
    await cleanup.connect();
    await cleanup.query('DELETE FROM app_records WHERE key=$1', [key]);
  } finally {
    await reopened?.close();
    if (!reopened) await store.close().catch(() => {});
    await cleanup.end();
  }
});

test('PostgreSQL community persists profiles and comments with owner-only deletion', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const wallet = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
  let store = createCommunityStore({ databaseUrl });
  const cleanup = new pg.Client(databaseConfig(databaseUrl));
  let cleanupConnected = false;
  try {
    await store.ready();
    await store.saveProfile(wallet, { name: 'Verification', bio: 'Temporary test fixture' });
    const post = await store.addPost(mint, wallet, 'Persistence verification');
    await assert.rejects(store.deletePost(post.id, mint), error => error.status === 404);
    await store.close();
    store = createCommunityStore({ databaseUrl });
    assert.equal((await store.getProfile(wallet)).name, 'Verification');
    assert.equal((await store.listPosts(mint))[0].id, post.id);
    await store.reportPost(post.id, wallet, 'Verification');
    assert.ok((await store.listReports()).some(report => report.post === post.id));
    await store.moderatePost(post.id, wallet, 'hide');
    assert.deepEqual(await store.listPosts(mint), []);
    await cleanup.connect(); cleanupConnected = true;
    const audit = await cleanup.query('SELECT status,moderated_by FROM community_reports WHERE post_id=$1', [post.id]);
    assert.equal(audit.rows[0].status, 'resolved');
    assert.equal(audit.rows[0].moderated_by, wallet);
    const second = await store.addPost(mint, wallet, 'Owner deletion verification');
    await store.deletePost(second.id, wallet);
    assert.deepEqual(await store.listPosts(mint), []);
  } finally {
    await store.close();
    if (!cleanupConnected) await cleanup.connect();
    await cleanup.query('DELETE FROM community_reports WHERE post_id IN (SELECT id FROM community_posts WHERE wallet=$1 AND mint=$2)', [wallet, mint]);
    await cleanup.query('DELETE FROM community_posts WHERE wallet=$1 AND mint=$2', [wallet, mint]);
    await cleanup.query('DELETE FROM community_profiles WHERE wallet=$1', [wallet]);
    await cleanup.end();
  }
});
