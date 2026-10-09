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
import { createCatalogueStore } from '../server/catalogue-store.js';

test('PostgreSQL account deletion clears app data and all wallet sessions atomically', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL, wallet = Keypair.generate().publicKey.toBase58(), target = Keypair.generate().publicKey.toBase58();
  const community = createCommunityStore({ databaseUrl }), catalogue = createCatalogueStore({ databaseUrl }), security = createSecurityStore(null, Date.now, databaseUrl), cleanup = new pg.Client(databaseConfig(databaseUrl));
  const token = randomUUID(); let post, connected = false;
  try {
    await Promise.all([community.ready(), catalogue.ready()]);
    await community.saveProfile(wallet, { name: 'Deletion fixture', bio: 'Private bio' });
    post = await community.addPost(target, wallet, 'Private comment');
    await community.reportPost(post.id, target, 'Retained moderation report');
    await community.follow(wallet, target, true); await community.follow(target, wallet, true);
    await catalogue.setWatchlist(wallet, [target]);
    await catalogue.upload({ wallet, uri: 'https://example.com/test', expires: Date.now() + 60000 });
    await security.put('session', token, { wallet, expires: Date.now() + 60000 });
    await community.deleteAccount(wallet);
    assert.notEqual((await community.getProfile(wallet)).name, 'Deletion fixture');
    assert.deepEqual(await community.listPosts(target), []);
    assert.deepEqual(await community.following(wallet), []); assert.deepEqual(await community.following(target), []);
    assert.deepEqual(await catalogue.watchlist(wallet), []);
    assert.equal(await catalogue.getUpload(wallet, 'https://example.com/test'), undefined);
    assert.equal(await security.get('session', token), undefined);
    await cleanup.connect();
    connected = true;
    assert.equal((await cleanup.query('SELECT body,deleted FROM community_posts WHERE id=$1', [post.id])).rows[0].body, '');
    assert.equal((await cleanup.query('SELECT post_id FROM community_reports WHERE post_id=$1', [post.id])).rowCount, 1);
  } finally {
    if (!connected) await cleanup.connect();
    if (post) { await cleanup.query('DELETE FROM community_reports WHERE post_id=$1', [post.id]); await cleanup.query('DELETE FROM community_posts WHERE id=$1', [post.id]); }
    await cleanup.query('DELETE FROM community_profiles WHERE wallet=$1', [wallet]);
    await cleanup.query('DELETE FROM community_follows WHERE wallet=$1 OR following=$1', [wallet]);
    await cleanup.query('DELETE FROM wallet_watchlists WHERE wallet=$1', [wallet]);
    await cleanup.query('DELETE FROM upload_references WHERE wallet=$1', [wallet]);
    await security.take('session', token);
    await Promise.all([community.close(), catalogue.close(), security.close(), cleanup.end()]);
  }
});

test('PostgreSQL normalized catalogue isolates owners and serializes watchlists across replicas', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const first = createCatalogueStore({ databaseUrl }), second = createCatalogueStore({ databaseUrl });
  const cleanup = new pg.Client(databaseConfig(databaseUrl));
  const wallet = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
  const uri = `https://example.com/${randomUUID()}`;
  try {
    await Promise.all([first.ready(), second.ready()]);
    const coin = { mint, creator: wallet, created: Date.now(), image: 'original' };
    await Promise.all([first.insert(coin), second.insert(coin)]);
    assert.equal((await first.find([mint])).length, 1);
    await assert.rejects(second.image(mint, mint, 'stolen'), { status: 403 });
    await first.image(mint, wallet, 'changed');
    assert.equal((await second.find([mint]))[0].image, 'changed');
    const reference = { wallet, uri, expires: Date.now() + 60000 };
    await first.upload(reference);
    await second.upload({ ...reference, expires: 0 }, { overwrite: false });
    assert.deepEqual(await second.getUpload(wallet, uri), reference);
    await Promise.all([first.setWatchlist(wallet, [mint]), second.setWatchlist(wallet, [wallet])]);
    const selected = await first.watchlist(wallet);
    assert.equal(selected.length, 1);
    assert.ok([mint, wallet].includes(selected[0]));
    await second.setWatchlist(wallet, []);
    assert.deepEqual(await first.watchlist(wallet), []);
  } finally {
    await cleanup.connect();
    await cleanup.query('DELETE FROM catalogue_coins WHERE mint=$1', [mint]);
    await cleanup.query('DELETE FROM upload_references WHERE wallet=$1', [wallet]);
    await cleanup.query('DELETE FROM wallet_watchlists WHERE wallet=$1', [wallet]);
    await Promise.all([first.close(), second.close(), cleanup.end()]);
  }
});

test('PostgreSQL discovery cursor is stable when new launches arrive', { skip: !process.env.YEETNEST_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.YEETNEST_TEST_DATABASE_URL;
  const index = createChainIndexStore(databaseUrl), cleanup = new pg.Client(databaseConfig(databaseUrl));
  const name = `cursor-${randomUUID()}`, launches = Array.from({ length: 4 }, (_, i) => {
    const mint = Keypair.generate().publicKey.toBase58();
    return { pool: Keypair.generate().publicKey.toBase58(), mint, creator: mint, config: mint, platform: mint, name, ticker: 'TEST', uri: '', decimals: 6, status: 0, raised: '0', target: '100', supply: '100', created: i === 3 ? 1000 : 100 - i, slot: 1 };
  });
  try {
    await index.ready();
    for (const launch of launches.slice(0, 3)) await index.saveLaunch(launch);
    const first = await index.list({ query: name, limit: 2 });
    await index.saveLaunch(launches[3]);
    const last = first.at(-1);
    const second = await index.list({ query: name, limit: 2, after: { created: Number(last.created), pool: last.pool } });
    assert.deepEqual(second.map(row => row.mint), [launches[2].mint]);
    assert.equal(new Set([...first, ...second].map(row => row.mint)).size, 3);
  } finally {
    await cleanup.connect();
    await cleanup.query('DELETE FROM market_events WHERE mint=ANY($1::text[])', [launches.map(row => row.mint)]);
    await cleanup.query('DELETE FROM indexed_launches WHERE pool=ANY($1::text[])', [launches.map(row => row.pool)]);
    await Promise.all([index.close(), cleanup.end()]);
  }
});

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
    assert.equal((await first.failed()).length, 1);
    assert.equal(await first.retry(recovered.signature), true);
    assert.equal(await second.retry(recovered.signature), false);
    const resumed = await second.claim();
    assert.equal(resumed.attempts, 1);
    await second.complete(resumed);
    const workerId = randomUUID();
    await first.heartbeat(workerId, 'process');
    assert.equal((await second.workers())[0].id, workerId);
    time += 90001;
    assert.deepEqual(await second.workers(), []);
    time += 8 * 86400000;
    assert.equal(await first.prune(), 9);
    assert.equal(await second.prune(), 0);
  } finally {
    await cleanup.connect();
    await cleanup.query('DELETE FROM indexer_jobs WHERE queue_name=$1', [name]);
    await cleanup.query('DELETE FROM indexer_workers WHERE queue_name=$1', [name]);
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
    const eventCursor = await index.latestEvent();
    await index.saveLaunch(launch);
    assert.ok((await index.eventsAfter(eventCursor)).some(event => event.mint === mint));
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
    await cleanup.query('DELETE FROM market_events WHERE mint=$1', [mint]);
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
