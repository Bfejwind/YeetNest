import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppStore } from '../server/app-store.js';

test('JSON fallback serializes writes, survives reopen and isolates wallet keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yeetnest-store-'));
  let store = createAppStore({ directory });
  try {
    await store.ready();
    await Promise.all(Array.from({ length: 20 }, (_, id) => store.mutate('coins', rows => rows.push({ id }))));
    await store.mutate('watchlist:wallet-a', rows => rows.push('mint-a'));
    await store.close();
    store = createAppStore({ directory });
    assert.equal((await store.get('coins')).length, 20);
    assert.deepEqual(await store.get('watchlist:wallet-a'), ['mint-a']);
    assert.deepEqual(await store.get('watchlist:wallet-b'), []);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
