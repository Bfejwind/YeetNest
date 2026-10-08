import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { decodeLaunchlabEvents, LAUNCHLAB_PROGRAM, tradeAmounts } from '../server/launchlab-events.js';
import { scanPage } from '../server/indexer-scan.js';
import { indexerSettings } from '../server/indexer-config.js';
import { retryDelay } from '../server/indexer-queue.js';

test('indexer concurrency and polling are bounded and retries back off', () => {
  assert.equal(indexerSettings({}).concurrency, 4);
  assert.equal(indexerSettings({ INDEXER_ROLE: 'process' }).role, 'process');
  assert.throws(() => indexerSettings({ INDEXER_CONCURRENCY: '0' }));
  assert.throws(() => indexerSettings({ INDEXER_CONCURRENCY: '17' }));
  assert.throws(() => indexerSettings({ INDEXER_ROLE: 'unknown' }));
  assert.equal(retryDelay(1), 2000);
  assert.equal(retryDelay(100), 300000);
});

test('scan cursors advance only after durable batch enqueue succeeds', async () => {
  const state = { head: 'old' };
  const rows = [{ signature: 'new', err: null }, { signature: 'bad', err: 'failed' }, { signature: 'old', err: null }];
  const connection = { getSignaturesForAddress: async () => rows };
  await assert.rejects(scanPage({ connection, state, enqueue: async () => { throw Error('Database down'); } }));
  assert.deepEqual(state, { head: 'old' });
  let queued;
  const next = await scanPage({ connection, state, enqueue: async rows => { queued = rows; } });
  assert.equal(next.head, 'new');
  assert.deepEqual(queued.map(row => row.signature), ['new']);
});

function tradeBytes() {
  const bytes = Buffer.alloc(8 + 32 + 13 * 8 + 3);
  Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]).copy(bytes);
  new PublicKey(LAUNCHLAB_PROGRAM).toBuffer().copy(bytes, 8);
  [1000n, 2000n, 3000n, 10n, 20n, 110n, 220n, 202n, 100n, 1n, 1n, 0n, 0n].forEach((value, i) => bytes.writeBigUInt64LE(value, 40 + i * 8));
  bytes[bytes.length - 1] = 1;
  return bytes;
}
test('LaunchLab event decoding rejects spoofed program logs and failed transactions', () => {
  const data = tradeBytes().toString('base64');
  const tx = { transaction: { message: { accountKeys: [] } }, meta: { err: null, logMessages: [`Program ${LAUNCHLAB_PROGRAM} invoke [1]`, `Program data: ${data}`, 'Program 11111111111111111111111111111111 invoke [2]', `Program data: ${data}`, 'Program 11111111111111111111111111111111 success', `Program ${LAUNCHLAB_PROGRAM} success`] } };
  const events = decodeLaunchlabEvents(tx);
  assert.equal(events.length, 1);
  assert.deepEqual(tradeAmounts(events[0].data), { side: 'buy', base: '100', quote: '200', fees: '2' });
  tx.meta.err = { InstructionError: [0, 'Custom'] };
  assert.deepEqual(decodeLaunchlabEvents(tx), []);
});
test('self-CPI events use canonical program and instruction-index identity', () => {
  const data = bs58.encode(Buffer.concat([Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]), tradeBytes()]));
  const tx = { transaction: { message: { accountKeys: [LAUNCHLAB_PROGRAM, '11111111111111111111111111111111'] } }, meta: { err: null, innerInstructions: [{ index: 2, instructions: [{ programIdIndex: 1, data }, { programIdIndex: 0, data }] }] } };
  const events = decodeLaunchlabEvents(tx);
  assert.equal(events.length, 1);
  assert.equal(events[0].index, 'cpi:2:1');
});
test('paged catch-up preserves old head through restart and retries without cursor loss', async () => {
  const rows = ['f', 'e', 'd', 'c', 'b', 'a'].map(signature => ({ signature, err: null }));
  const connection = { getSignaturesForAddress: async (_, options, commitment) => {
    assert.equal(commitment, 'finalized');
    const start = options.before ? rows.findIndex(row => row.signature === options.before) + 1 : 0;
    return rows.slice(start, start + options.limit);
  } };
  const seen = [];
  const processSignature = async row => { seen.push(row.signature); };
  let state = await scanPage({ connection, state: { head: 'a' }, processSignature, limit: 2 });
  assert.equal(state.head, 'a');
  assert.equal(state.catchupBefore, 'e');
  const persisted = JSON.parse(JSON.stringify(state));
  await assert.rejects(scanPage({ connection, state: persisted, processSignature: async () => { throw Error('Provider down'); }, limit: 2 }));
  assert.deepEqual(state, persisted);
  state = await scanPage({ connection, state: persisted, processSignature, limit: 2 });
  state = await scanPage({ connection, state, processSignature, limit: 2 });
  assert.equal(state.head, 'f');
  assert.equal(state.catchupBefore, null);
  assert.deepEqual(seen.sort(), ['b', 'c', 'd', 'e', 'f']);
});
