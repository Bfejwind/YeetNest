import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseStore, reviewablePurchase, purchaseWithRecovery } from '../src/launch-purchases.js';

test('initial purchase intent persists separately from creation and never silently evicts unresolved work', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const first = purchaseStore(storage, () => 100);
  first.save({ wallet: 'creator', mint: 'mint', amount: '0.01', state: 'requested' });
  const reopened = purchaseStore(storage, () => 200);
  reopened.save({ wallet: 'creator', mint: 'mint', signature: 'purchase-signature', state: 'unknown' });
  assert.equal(reopened.read().length, 1);
  assert.equal(reopened.read()[0].amount, '0.01');
  assert.equal(reopened.read()[0].updated, 200);
  for (let i = 0; i < 99; i++) reopened.save({ wallet: 'creator', mint: `mint-${i}`, state: 'requested' });
  assert.throws(() => reopened.save({ wallet: 'creator', mint: 'overflow' }), /full/);
});

test('unknown or processed initial buys cannot be quoted again; failures and confirmations reconcile', async () => {
  const intent = { wallet: 'creator', mint: 'mint', signature: 'signature', state: 'unknown' };
  const connection = status => ({ getSignatureStatuses: async () => ({ value: [status] }) });
  for (const status of [null, { confirmationStatus: 'processed' }]) await assert.rejects(reviewablePurchase(intent, connection(status)), /pending or unknown/);
  for (const confirmationStatus of ['confirmed', 'finalized']) assert.equal((await reviewablePurchase(intent, connection({ confirmationStatus }))).state, 'confirmed');
  assert.equal((await reviewablePurchase(intent, connection({ err: 'rejected' }))).state, 'failed');
  assert.deepEqual(await reviewablePurchase({ ...intent, signature: undefined }, connection(null)), { ...intent, signature: undefined });
});


test('skip preserves unresolved signatures and explains that network submissions cannot be cancelled', async () => {
  const intent = { signature: 'original-signature', state: 'unknown' };
  for (const status of [null, { confirmationStatus: 'processed' }]) {
    const connection = { getSignatureStatuses: async () => ({ value: [status] }) };
    await assert.rejects(reviewablePurchase(intent, connection, { action: 'cancel' }), /Skip cannot cancel.*original-signature/);
    assert.equal(intent.state, 'unknown');
  }
  const failed = await reviewablePurchase(intent, { getSignatureStatuses: async () => ({ value: [{ err: 'failed' }] }) }, { action: 'cancel' });
  assert.equal(failed.state, 'failed');
  const unsigned = { state: 'requested' };
  assert.equal(await reviewablePurchase(unsigned, {}, { action: 'cancel' }), unsigned);
});


test('a purchase proven expired can be skipped or prepared again without clearing its signature', async () => {
  const intent = { signature: 'old-signature', blockhash: 'blockhash', lastValidBlockHeight: 100, state: 'unknown' };
  const connection = { getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 101, getTransaction: async () => null };
  for (const action of ['cancel', 'prepare']) {
    const checked = await reviewablePurchase(intent, connection, { action });
    assert.equal(checked.state, 'expired'); assert.equal(checked.signature, 'old-signature');
  }
});


test('purchase recovery fills missing expiry fields only from its matching transaction journal', () => {
  const intent = { signature: 'sig', wallet: 'creator', mint: 'mint', state: 'unknown' };
  const record = { ...intent, blockhash: 'hash', lastValidBlockHeight: 42, signedTransaction: 'payload' };
  assert.equal(purchaseWithRecovery(intent, [record]).lastValidBlockHeight, 42);
  for (const changed of [{ wallet: 'other' }, { mint: 'other' }, { signature: 'other' }]) {
    assert.equal(purchaseWithRecovery(intent, [{ ...record, ...changed }]), intent);
  }
});
