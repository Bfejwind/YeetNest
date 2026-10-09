import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { validateCreatorClaim } from '../src/claim-validation.js';

test('creator claim binds its creator, vault, recipient and exact instruction; rejects transfers and fees', () => {
  const owner = Keypair.generate().publicKey, program = Keypair.generate().publicKey;
  const accounts = [owner, ...Array.from({ length: 7 }, () => Keypair.generate().publicKey)];
  const ix = new TransactionInstruction({ programId: program, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: [0, 2, 3].includes(i) })), data: Buffer.from([26, 97, 138, 203, 132, 171, 141, 252]) });
  const expected = { owner: owner.toBase58(), program: program.toBase58(), recipient: accounts[3].toBase58(), accounts: accounts.map(account => account.toBase58()) };
  const make = instructions => new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message());
  const tx = make([ix]);
  validateCreatorClaim(tx, tx.message.getAccountKeys(), expected);
  const redirected = [...expected.accounts]; redirected[3] = owner.toBase58();
  assert.throws(() => validateCreatorClaim(tx, tx.message.getAccountKeys(), { ...expected, accounts: redirected }), /destination/);
  for (const instructions of [[ix, ix], [SystemProgram.transfer({ fromPubkey: owner, toPubkey: accounts[3], lamports: 1 }), ix], [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000000n }), ix]]) {
    const bad = make(instructions);
    assert.throws(() => validateCreatorClaim(bad, bad.message.getAccountKeys(), expected));
  }
});
