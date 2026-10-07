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
    const candles = await index.candles(mint);
    assert.equal(candles.length, 1);
    assert.equal(Number(candles[0].close), 1.5);
    assert.equal(Number(candles[0].volume), 3);
    assert.equal((await index.list({ query: mint, status: 0 })).length, 1);
    assert.equal((await index.list({ query: mint, status: 2 })).length, 0);
    await index.saveLaunch({ ...launch, status: 2, slot: 99 });
    assert.equal((await index.getLaunch(mint)).status, 0);
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
  try {
    await store.ready();
    await store.saveProfile(wallet, { name: 'Verification', bio: 'Temporary test fixture' });
    const post = await store.addPost(mint, wallet, 'Persistence verification');
    await assert.rejects(store.deletePost(post.id, mint), error => error.status === 404);
    await store.close();
    store = createCommunityStore({ databaseUrl });
    assert.equal((await store.getProfile(wallet)).name, 'Verification');
    assert.equal((await store.listPosts(mint))[0].id, post.id);
    await store.deletePost(post.id, wallet);
    assert.deepEqual(await store.listPosts(mint), []);
  } finally {
    await store.close();
    await cleanup.connect();
    await cleanup.query('DELETE FROM community_reports WHERE post_id IN (SELECT id FROM community_posts WHERE wallet=$1 AND mint=$2)', [wallet, mint]);
    await cleanup.query('DELETE FROM community_posts WHERE wallet=$1 AND mint=$2', [wallet, mint]);
    await cleanup.query('DELETE FROM community_profiles WHERE wallet=$1', [wallet]);
    await cleanup.end();
  }
});
