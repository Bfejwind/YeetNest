import test from 'node:test';
import assert from 'node:assert/strict';
import { pollTransaction, TransactionOutcomeError } from '../src/transaction-state.js';
import { minimumOutput, toUnits } from '../src/amounts.js';
import { validateCurveInstruction } from '../src/transaction-validation.js';
import { withTimeout } from '../src/async-timeout.js';
import { Keypair, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

test('operation deadlines resolve, preserve rejection and stop waiting for stalled work', async () => {
  assert.equal(await withTimeout(() => Promise.resolve('ready'), 100, 'Timed out'), 'ready');
  await assert.rejects(withTimeout(() => Promise.reject(new Error('Provider rejected')), 100, 'Timed out'), /Provider rejected/);
  let resolve;
  const pending = withTimeout(() => new Promise(done => { resolve = done; }), 5, 'Preparation timed out');
  await assert.rejects(pending, error => error.code === 'OPERATION_TIMEOUT' && error.message === 'Preparation timed out');
  resolve('late result');
});

test('confirmation distinguishes processed, confirmed, finalized, failed and unknown', async () => {
  const connection = values => ({ getSignatureStatuses: async () => ({ value: [values.shift()] }) });
  const states = [];
  assert.equal(await pollTransaction(connection([{ confirmationStatus: 'processed' }, { confirmationStatus: 'confirmed' }]), 'signature', { attempts: 2, sleep: async () => {}, onState: state => states.push(state) }), 'signature');
  assert.deepEqual(states, ['submitted', 'confirmed']);
  assert.equal(await pollTransaction(connection([{ confirmationStatus: 'finalized' }]), 'signature'), 'signature');
  await assert.rejects(pollTransaction(connection([{ err: { InstructionError: [1, 'Custom'] } }]), 'signature'), error => error instanceof TransactionOutcomeError && error.state === 'failed');
  await assert.rejects(pollTransaction(connection([null]), 'signature', { attempts: 1 }), error => error.state === 'unknown' && error.signature === 'signature');
  await assert.rejects(pollTransaction({ getSignatureStatuses: async () => { throw new Error('RPC offline'); } }, 'signature', { attempts: 1 }), error => error.state === 'unknown');
});

test('slippage minimum is integer-safe and invalid decimals are rejected', () => {
  assert.equal(minimumOutput('18446744073709551615', 100), '18262276632972456098');
  assert.equal(minimumOutput('101', 50), '100');
  for (const value of [0, 501, NaN, 1.5]) assert.throws(() => minimumOutput('100', value));
  for (const decimals of [undefined, NaN, -1, 256, 1.5]) assert.throws(() => toUnits('1', decimals));
});

test('curve transaction validator rejects changed side, amounts and destinations', () => {
  const owner = Keypair.generate().publicKey;
  const program = Keypair.generate().publicKey;
  const accounts = [owner, ...Array.from({ length: 10 }, () => Keypair.generate().publicKey)];
  const data = new Uint8Array(32);
  data.set([250, 234, 13, 123, 213, 156, 19, 236]);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, 100n, true); view.setBigUint64(16, 90n, true);
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [new TransactionInstruction({ programId: program, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i === 0 || i >= 4 })), data: Buffer.from(data) })] }).compileToV0Message());
  const keys = transaction.message.getAccountKeys();
  const expected = { owner: owner.toBase58(), program: program.toBase58(), side: 'Buy', input: '100', minimum: '90', pool: accounts[4].toBase58(), userA: accounts[5].toBase58(), userB: accounts[6].toBase58(), vaultA: accounts[7].toBase58(), vaultB: accounts[8].toBase58(), mintA: accounts[9].toBase58(), mintB: accounts[10].toBase58() };
  validateCurveInstruction(transaction, keys, expected);
  for (const changed of [{ side: 'Sell' }, { input: '101' }, { minimum: '89' }, { vaultA: owner.toBase58() }, { userB: owner.toBase58() }]) assert.throws(() => validateCurveInstruction(transaction, keys, { ...expected, ...changed }));
  const curve = new TransactionInstruction({ programId: program, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: true })), data: Buffer.from(data) });
  const withTransfer = destination => new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: owner, toPubkey: destination, lamports: 100 }), curve] }).compileToV0Message());
  const malicious = withTransfer(Keypair.generate().publicKey);
  assert.throws(() => validateCurveInstruction(malicious, malicious.message.getAccountKeys(), { ...expected, maxSystemLamports: '100' }));
  const funded = withTransfer(accounts[6]);
  validateCurveInstruction(funded, funded.message.getAccountKeys(), { ...expected, maxSystemLamports: '100' });
  assert.throws(() => validateCurveInstruction(funded, funded.message.getAccountKeys(), { ...expected, maxSystemLamports: '99' }));
});
