import test from 'node:test';
import assert from 'node:assert/strict';
import { pacedRpcFetch } from '../server/indexer-rpc-fetch.js';

test('worker RPC requests are paced and honor provider cooldown', async () => {
  let time = 0;
  const calls = [];
  const request = pacedRpcFetch({ now: () => time, sleep: async wait => { time += wait; }, interval: 1000, fetcher: async () => {
    calls.push(time);
    return new Response('{}', calls.length === 1 ? { status: 429, headers: { 'retry-after': '20' } } : {});
  } });
  await request('https://rpc.example');
  await request('https://rpc.example');
  await request('https://rpc.example');
  assert.deepEqual(calls, [0, 20000, 21000]);
});
