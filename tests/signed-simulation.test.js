import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateSignedFresh } from '../src/signed-simulation.js';

test('signed simulation retries RPC lag without replacing the blockhash or skipping signature checks', async () => {
  const tx = { message: { recentBlockhash: 'signed-hash' } };
  let calls = 0;
  const connection = {
    simulateTransaction: async (transaction, options) => {
      assert.equal(transaction, tx); assert.equal(options.sigVerify, true); assert.equal(options.replaceRecentBlockhash, false); assert.ok(options.minContextSlot >= 100);
      return { context: { slot: 100 }, value: { err: ++calls === 1 ? 'BlockhashNotFound' : null } };
    }, isBlockhashValid: async () => ({ context: { slot: 101 }, value: true }),
  };
  assert.equal((await simulateSignedFresh(connection, tx, { minContextSlot: 100, sleep: async () => {} })).value.err, null);
  assert.equal(calls, 2); assert.equal(tx.message.recentBlockhash, 'signed-hash');
});

test('expired signed hash requires a fresh approval and never silently replaces the message', async () => {
  const connection = { simulateTransaction: async () => ({ value: { err: 'BlockhashNotFound' } }), isBlockhashValid: async () => ({ value: false }) };
  await assert.rejects(simulateSignedFresh(connection, { message: { recentBlockhash: 'old' } }), /Nothing was broadcast/);
});
