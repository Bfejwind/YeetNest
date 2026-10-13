import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Keypair, SystemProgram, TransactionMessage } from '@solana/web3.js';
import { claimBlockhashOnlyChange } from '../src/claim-message.js';

test('creator claim accepts only a blockhash refresh, never changed amounts or recipients', () => {
  const owner = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
  const oldHash = Keypair.generate().publicKey.toBase58(), newHash = Keypair.generate().publicKey.toBase58();
  const compile = (hash, lamports = 1, to = recipient) => new TransactionMessage({ payerKey: owner, recentBlockhash: hash, instructions: [SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports })] }).compileToV0Message();
  const original = compile(oldHash).serialize();
  assert.equal(claimBlockhashOnlyChange(original, compile(newHash)), true);
  assert.equal(claimBlockhashOnlyChange(original, compile(oldHash)), false);
  assert.equal(claimBlockhashOnlyChange(original, compile(newHash, 2)), false);
  assert.equal(claimBlockhashOnlyChange(original, compile(newHash, 1, owner)), false);
});
