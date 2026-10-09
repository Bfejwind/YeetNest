import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueStore } from '../server/catalogue-store.js';
import { encodeCursor, decodeCursor } from '../server/discovery-cursor.js';

test('catalogue ownership, immutable imports, expiry and wallet isolation', async () => {
  const records = new Map();
  const fallback = { get: async key => structuredClone(records.get(key) || []), mutate: async (key, fn) => {
    const rows = structuredClone(records.get(key) || []);
    const result = fn(rows); records.set(key, rows); return result;
  } };
  const store = createCatalogueStore({ fallback });
  await store.insert({ mint: 'a', creator: 'owner', image: 'old' });
  await store.insert({ mint: 'a', creator: 'intruder' });
  await assert.rejects(store.image('a', 'intruder', 'bad'), { status: 403 });
  await store.image('a', 'owner', 'new');
  assert.equal((await store.find(['a']))[0].image, 'new');
  const reference = { wallet: 'owner', uri: 'https://example.com', expires: Date.now() + 10000 };
  await store.upload(reference);
  await store.upload({ ...reference, expires: 0 }, { overwrite: false });
  assert.deepEqual(await store.getUpload(reference.wallet, reference.uri), reference);
  await store.upload({ ...reference, expires: 0 });
  assert.equal(await store.getUpload(reference.wallet, reference.uri), undefined);
  await store.setWatchlist('owner', ['a']);
  assert.deepEqual(await store.watchlist('other'), []);
  await store.setWatchlist('owner', []);
  assert.deepEqual(await store.watchlist('owner'), []);
});

test('discovery cursors are bounded and bound to their search filters', () => {
  const row = { created: 123, pool: '11111111111111111111111111111111' };
  const cursor = encodeCursor(row, 'cat', 0);
  assert.deepEqual(decodeCursor(cursor, 'cat', 0), row);
  for (const [value, query, status] of [[cursor, 'dog', 0], [cursor, 'cat', 1], ['!', '', undefined], ['a'.repeat(401), '', undefined]]) {
    assert.throws(() => decodeCursor(value, query, status), { status: 400 });
  }
  assert.equal(decodeCursor(undefined, '', undefined), undefined);
});
