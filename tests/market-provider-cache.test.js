import test from 'node:test';
import assert from 'node:assert/strict';
import { marketProviderCache } from '../server/market-provider-cache.js';
test('market provider requests deduplicate, cache and stop during host cooldown', async () => {
  let calls = 0, time = 0, limited = false;
  const get = marketProviderCache(async () => { calls++; if (limited) throw Object.assign(new Error('429'), { status: 429 }); return [1]; }, { now: () => time });
  const url = 'https://api.dexscreener.com/token-pairs/v1/solana/test';
  await Promise.all([get(url), get(url)]); assert.equal(calls, 1);
  await get(url); assert.equal(calls, 1);
  time = 300001; limited = true;
  await assert.rejects(get(url), /two minutes/); assert.equal(calls, 2);
  await assert.rejects(get(url + 'other'), /two minutes/); assert.equal(calls, 2);
  time += 120001; limited = false;
  assert.deepEqual(await get(url), [1]); assert.equal(calls, 3);
});
