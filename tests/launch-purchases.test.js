import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseStore, reviewablePurchase } from '../src/launch-purchases.js';

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
