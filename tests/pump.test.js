import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { validateLocalInstructions } from '../src/pump-validation.js';
import { decodePumpEvents, PUMP_PROGRAM } from '../server/pump-events.js';
import BN from 'bn.js';
import { preparePumpLaunch, preparePumpTrade, preparePumpCreatorClaim } from '../src/pump-chain.js';
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk');

test('creator claim omits empty AMM accounts and resimulates before wallet signing', async () => {
  const owner = Keypair.generate().publicKey;
  const curveInstruction = await pump.PUMP_SDK.offlinePumpProgram.methods.collectCreatorFee().accountsPartial({ creator: owner }).instruction();
  const unused = SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  let simulations = 0, submissions = 0, failSimulation = false;
  const context = { wallet: () => owner, pumpSdk: { ...pump, online: {
    getCreatorVaultBalanceBothPrograms: async () => new BN(10000000), getCreatorVaultBalance: async () => new BN(10000000),
    collectCoinCreatorFeeInstructions: async () => [curveInstruction, unused],
  } }, connection: {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    getFeeForMessage: async () => ({ value: 5000 }), getMinimumBalanceForRentExemption: async () => 10000000,
    getBalance: async () => 100000000, simulateTransaction: async transaction => {
      simulations++;
      assert.equal(TransactionMessage.decompile(transaction.message).instructions.length, 2);
      return { value: { err: failSimulation ? 'controlled failure' : null } };
    },
  }, submit: async () => { submissions++; return 'controlled-claim'; } };
  const claim = await preparePumpCreatorClaim(context);
  assert.equal(await claim.execute(), 'controlled-claim');
  assert.equal(simulations, 2); assert.equal(submissions, 1);
  const rejected = await preparePumpCreatorClaim(context);
  failSimulation = true;
  await assert.rejects(rejected.execute(), /No transaction was submitted/);
  assert.equal(submissions, 1);
});

test('Pump adapter fixes buy budget/sell minimum, simulates and binds execution to the wallet', async () => {
  let owner = Keypair.generate().publicKey, submissions = 0, instructions;
  const mint = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
  const global = { initialVirtualTokenReserves: new BN('1073000000000000'), initialVirtualSolReserves: new BN('30000000000'), initialRealTokenReserves: new BN('793100000000000'), tokenTotalSupply: new BN('1000000000000000'), feeBasisPoints: new BN(100), creatorFeeBasisPoints: new BN(50), poolMigrationFee: new BN('15000000'), createV2Enabled: true, mayhemModeEnabled: false, whitelistedQuoteMints: [], feeRecipient: recipient, feeRecipients: [recipient], reservedFeeRecipients: [], buybackFeeRecipients: [recipient] };
  const curve = { ...pump.newBondingCurve(global, new PublicKey('So11111111111111111111111111111111111111112')), creator: owner };
  const account = { owner: pump.PUMP_PROGRAM_ID, data: Buffer.alloc(0), lamports: 10000000, executable: false };
  const online = { fetchGlobal: async () => global, fetchFeeConfig: async () => null,
    fetchBuyState: async () => ({ bondingCurve: curve, bondingCurveAccountInfo: account, associatedUserAccountInfo: null }),
    fetchSellState: async () => ({ bondingCurve: curve, bondingCurveAccountInfo: account }),
  };
  const context = { wallet: () => owner, pumpSdk: { ...pump, online, PUMP_SDK: { ...pump.PUMP_SDK,
    decodeBondingCurve: () => curve,
    createV2Instruction: args => pump.PUMP_SDK.createV2Instruction(args),
    buyV2Instructions: async args => { instructions = args; return pump.PUMP_SDK.buyV2Instructions(args); },
    sellV2Instructions: async args => { instructions = args; return pump.PUMP_SDK.sellV2Instructions(args); },
  } }, connection: {
    getAccountInfo: async key => key.equals(mint) ? { ...account, owner: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') } : account,
    getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58() }), getFeeForMessage: async () => ({ value: 5000 }),
    getMinimumBalanceForRentExemption: async () => 10000000, getBalance: async () => 1000000000,
    getTokenSupply: async () => ({ value: { amount: global.tokenTotalSupply.toString() } }), simulateTransaction: async () => ({ value: { err: null } }),
  }, submit: async () => { submissions++; return 'controlled-signature'; } };
  const coin = { mint: mint.toBase58(), poolId: pump.bondingCurvePda(mint).toBase58(), ticker: 'TEST' };
  const buy = await preparePumpTrade(context, coin, 'Buy', '0.05', 100);
  assert.equal(buy.inputIsMaximum, true);
  assert.equal(buy.output, buy.minimum);
  assert.equal(instructions.quoteAmount.toString(), '50000000'); assert.equal(instructions.slippage, 0);
  assert.equal(instructions.amount.toString(), new BN(pump.getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: global.tokenTotalSupply, bondingCurve: curve, amount: new BN('50000000'), quoteMint: new PublicKey('So11111111111111111111111111111111111111112') }).toString()).muln(99).divn(100).toString());
  assert.equal(await buy.execute(), 'controlled-signature'); await assert.rejects(buy.execute(), /used or expired/);
  const sell = await preparePumpTrade(context, coin, 'Sell', '100', 100);
  assert.equal(instructions.amount.toString(), '100000000'); assert.equal(instructions.slippage, 0); assert.ok(instructions.quoteAmount.gtn(0));
  owner = Keypair.generate().publicKey; await assert.rejects(sell.execute(), /Wallet changed/); assert.equal(submissions, 1);
  const launch = await preparePumpLaunch(context, { name: 'Test', ticker: 'TEST', uri: 'https://gateway.pinata.cloud/ipfs/Test' });
  assert.equal(launch.protocol, 'pump'); assert.deepEqual(await launch.execute(), ['controlled-signature']);
  context.connection.getFeeForMessage = async () => ({ value: 10000001 });
  await assert.rejects(preparePumpLaunch(context, { name: 'Test', ticker: 'TEST', uri: 'https://gateway.pinata.cloud/ipfs/Test' }), /cap/);
});

test('official Pump creation compiles with canonical mint/creator and rejects changed instructions', async () => {
  const mint = Keypair.generate(), wallet = Keypair.generate().publicKey;
  const instruction = await pump.PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: 'Test', symbol: 'TEST', uri: 'https://gateway.pinata.cloud/ipfs/Test', creator: wallet, user: wallet, mayhemMode: false });
  assert.ok(instruction.programId.equals(pump.PUMP_PROGRAM_ID));
  assert.ok(instruction.keys.some(key => key.pubkey.equals(pump.bondingCurvePda(mint.publicKey))));
  const compile = instructions => new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: PublicKey.default.toBase58(), instructions }).compileToV0Message());
  validateLocalInstructions(compile([instruction]), [instruction], wallet.toBase58(), [mint.publicKey.toBase58()]);
  assert.throws(() => validateLocalInstructions(compile([instruction, SystemProgram.transfer({ fromPubkey: wallet, toPubkey: mint.publicKey, lamports: 10 })]), [instruction], wallet.toBase58(), [mint.publicKey.toBase58()]));
  assert.throws(() => validateLocalInstructions(compile([instruction]), [instruction], wallet.toBase58()));
  const altered = { ...instruction, data: Buffer.from(instruction.data) }; altered.data[9] ^= 1;
  assert.throws(() => validateLocalInstructions(compile([altered]), [instruction], wallet.toBase58(), [mint.publicKey.toBase58()]));
});

test('Pump event decoder rejects failed transactions and spoofed nested program logs', () => {
  const mint = Keypair.generate().publicKey;
  const type = pump.pumpIdl.types.find(type => type.name === 'CompleteEvent');
  assert.ok(type);
  const data = Buffer.alloc(32 * 3 + 8);
  mint.toBuffer().copy(data, 0); mint.toBuffer().copy(data, 32); pump.bondingCurvePda(mint).toBuffer().copy(data, 64);
  data.writeBigInt64LE(100n, 96);
  const prefix = pump.pumpIdl.events.find(event => event.name === 'CompleteEvent').discriminator;
  const encoded = Buffer.concat([Buffer.from(prefix), data]).toString('base64');
  const tx = { transaction: { message: { accountKeys: [] } }, meta: { err: null, logMessages: [`Program ${PUMP_PROGRAM} invoke [1]`, `Program data: ${encoded}`, 'Program 11111111111111111111111111111111 invoke [2]', `Program data: ${encoded}`, 'Program 11111111111111111111111111111111 success', `Program ${PUMP_PROGRAM} success`] } };
  assert.equal(decodePumpEvents(tx).length, 1);
  tx.meta.err = 'failed'; assert.deepEqual(decodePumpEvents(tx), []);
});
