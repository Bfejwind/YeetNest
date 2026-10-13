import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Keypair, SystemProgram, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { claimBlockhashOnlyChange, claimWalletAdjustment } from '../src/claim-message.js';

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

test('claim wallet fee adjustment preserves instructions and permissions with bounded compute fees', () => {
  const owner = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
  const hash = Keypair.generate().publicKey.toBase58();
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
  const claim = SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 1 });
  const compile = instructions => new TransactionMessage({ payerKey: owner, recentBlockhash: hash, instructions }).compileToV0Message();
  const original = compile([limit, claim]).serialize();
  const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 400 });
  assert.equal(claimWalletAdjustment(original, compile([limit, price, claim])), true);
  assert.equal(claimWalletAdjustment(original, compile([limit, price, SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 2 })])), false);
  assert.equal(claimWalletAdjustment(original, compile([limit, price, price, claim])), false);
  assert.equal(claimWalletAdjustment(original, compile([limit, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000000 }), claim])), false);
  assert.equal(claimWalletAdjustment(original, compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), price, claim])), false);
});
