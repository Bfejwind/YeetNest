import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, ComputeBudgetProgram, AddressLookupTableAccount, TransactionInstruction } from '@solana/web3.js';
import { claimBlockhashOnlyChange, claimWalletAdjustment, walletMessageReport, LIGHTHOUSE_PROGRAM } from '../src/claim-message.js';

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

test('Phantom Lighthouse guard from the reported claim is preserved and narrowly allowed', () => {
  const owner = new PublicKey('BjE9givgn76we7v5tFAWe8km5wyP7cnaWDZqGm3ZGz5N');
  const claim = new TransactionInstruction({ programId: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), data: Buffer.from('1416567bc61cdb84', 'hex'), keys: [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: new PublicKey('BxeZhTCkYa1BcSnM5Gsx6hvtSzXpzzqpT2Rzp8SeykUV'), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'), isSigner: false, isWritable: false },
    { pubkey: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), isSigner: false, isWritable: false },
  ] });
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
  const guard = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), data: Buffer.from('06040300e348580a000000000403000001000000000000000000', 'hex'), keys: [{ pubkey: owner, isSigner: true, isWritable: true }] });
  const compile = instructions => new TransactionMessage({ payerKey: owner, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message();
  const reviewed = compile([limit, claim]).serialize();
  const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375000 });
  assert.equal(claimWalletAdjustment(reviewed, compile([limit, price, claim, guard])), true);
  const write = new TransactionInstruction({ ...guard, data: Buffer.from([0, 4, 3]) });
  assert.equal(claimWalletAdjustment(reviewed, compile([limit, price, claim, write])), false);
  assert.equal(claimWalletAdjustment(reviewed, compile([limit, price, guard, claim])), false);
  const fake = new TransactionInstruction({ ...guard, programId: Keypair.generate().publicKey });
  assert.equal(claimWalletAdjustment(reviewed, compile([limit, price, claim, fake])), false);
});

test('trade fee adjustment supports lookup tables but rejects changed lookup references and permissions', () => {
  const owner = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: owner, addresses: [recipient] } });
  const hash = Keypair.generate().publicKey.toBase58();
  const claim = SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 1 });
  const compile = (price, units = 500000) => new TransactionMessage({ payerKey: owner, recentBlockhash: hash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...(price ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })] : []), claim] }).compileToV0Message([table]);
  const original = compile(0).serialize();
  assert.equal(claimWalletAdjustment(original, compile(400), { addressLookupTableAccounts: [table], maxComputeUnits: 1400000 }), true);
  const modified = compile(400); modified.addressTableLookups[0].readonlyIndexes = [...modified.addressTableLookups[0].writableIndexes]; modified.addressTableLookups[0].writableIndexes = [];
  assert.equal(claimWalletAdjustment(original, modified, { addressLookupTableAccounts: [table], maxComputeUnits: 1400000 }), false);
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
  const report = walletMessageReport(original, compile([limit, price, SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 2 })]));
  assert.match(report.summary, /data changed/);
  assert.equal('signatures' in report.returned, false);
  assert.equal('blockhash' in report.returned, false);
  assert.equal(claimWalletAdjustment(original, compile([limit, price, price, claim])), false);
  assert.equal(claimWalletAdjustment(original, compile([limit, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000000 }), claim])), false);
  assert.equal(claimWalletAdjustment(original, compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), price, claim])), false);
  assert.equal(claimWalletAdjustment(original, compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), price, claim]), { maxComputeUnits: 1400000 }), true);
});
