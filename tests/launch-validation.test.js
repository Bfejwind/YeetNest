import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import * as sdk from '@raydium-io/raydium-sdk-v2';
import { validateLaunchTransaction } from '../src/launch-validation.js';

function fixture() {
  const owner = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const quote = new PublicKey('So11111111111111111111111111111111111111112');
  const token = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const program = sdk.LAUNCHPAD_PROGRAM;
  const config = sdk.getPdaLaunchpadConfigId(program, quote, 0, 0).publicKey;
  const pool = sdk.getPdaLaunchpadPoolId(program, mint, quote).publicKey;
  const instruction = sdk.initializeV2(program, owner, owner, config, sdk.LaunchpadPoolInitParam.platformId,
    sdk.getPdaLaunchpadAuth(program).publicKey, pool, mint, quote,
    sdk.getPdaLaunchpadVaultId(program, pool, mint).publicKey, sdk.getPdaLaunchpadVaultId(program, pool, quote).publicKey,
    sdk.getPdaMetadataKey(mint).publicKey, token, 6, 'Policy fixture', 'FIX', 'https://gateway.pinata.cloud/ipfs/Fixture',
    { type: 'ConstantCurve', migrateType: 'cpmm', supply: new BN('1000000000000000'), totalSellA: new BN('793100000000000'), totalFundRaisingB: new BN('85000000000') },
    new BN(0), new BN(0), new BN(0), 0);
  const build = instructions => new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message());
  const check = tx => validateLaunchTransaction(tx, tx.message.getAccountKeys(), instruction, { owner: owner.toBase58(), mint: mint.toBase58() });
  return { owner, instruction, build, check };
}
test('canonical LaunchLab creation passes while changed metadata and accounts fail', () => {
  const { instruction, build, check } = fixture();
  check(build([instruction]));
  const changedData = build([instruction]);
  const ix = changedData.message.compiledInstructions[0];
  ix.data = Uint8Array.from(ix.data);
  ix.data[ix.data.length - 2] ^= 1;
  assert.throws(() => check(changedData), /parameters changed/);
  const changedAccounts = build([instruction]);
  changedAccounts.message.compiledInstructions[0].accountKeyIndexes[8] = 0;
  assert.throws(() => check(changedAccounts), /account changed/);
});
test('creation rejects extra transfers, multiple launches and excessive priority fees', () => {
  const { owner, instruction, build, check } = fixture();
  assert.throws(() => check(build([instruction, SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1 })])), /Unexpected program/);
  assert.throws(() => check(build([instruction, instruction])), /exactly one/);
  assert.throws(() => check(build([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000 }), instruction])), /Priority fee/);
  check(build([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }), instruction]));
});
