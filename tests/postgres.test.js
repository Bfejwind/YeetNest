import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createAppStore } from '../server/app-store.js';
import { databaseConfig } from '../server/database-config.js';
import { createCommunityStore } from '../server/community-store.js';
import { Keypair } from '@solana/web3.js';

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
