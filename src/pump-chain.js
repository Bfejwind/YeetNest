import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { fromUnits, toUnits, minimumOutput } from './amounts.js';
import { validateLocalInstructions } from './pump-validation.js';

const SOL = 'So11111111111111111111111111111111111111112';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
async function sdk(connection, moduleOverride) {
  const module = moduleOverride || await import('@pump-fun/pump-sdk');
  return { ...module, online: module.online || new module.OnlinePumpSdk(connection) };
}

export async function pumpCreatorFeeBalance(context) {
  const pump = await sdk(context.connection, context.pumpSdk);
  const value = await pump.online.getCreatorVaultBalanceBothPrograms(context.wallet());
  return { amount: fromUnits(value.toString(), 9), symbol: 'SOL/WSOL', protocol: 'pump' };
}

export async function preparePumpCreatorClaim(context) {
  const pump = await sdk(context.connection, context.pumpSdk), owner = context.wallet();
  const balance = await pumpCreatorFeeBalance(context);
  if (balance.amount === '0') throw new Error('No collected Pump/PumpSwap SOL creator fees are available. Unswept curve/pool fees are not included.');
  const curveBalance = await pump.online.getCreatorVaultBalance(owner);
  const total = new BN(toUnits(balance.amount, 9));
  const hasAmmFees = total.gt(curveBalance);
  const instructions = (await pump.online.collectCoinCreatorFeeInstructions(owner, owner)).filter(instruction => {
    if (instruction.programId.equals(pump.PUMP_PROGRAM_ID)) return !curveBalance.isZero();
    return hasAmmFees && !(instruction.programId.toBase58() === TOKEN && instruction.data[0] === 9);
  });
  const built = await preparedTransaction(context, instructions, { refreshBeforeSigning: true, record: { operation: 'creator-claim', protocol: 'pump' } });
  return { ...built, ...balance };
}

async function preparedTransaction(context, instructions, { signers = [], spend = 0n, record = {}, onSubmitted, refreshBeforeSigning = false } = {}) {
  const { connection, wallet, submit } = context, owner = wallet().toBase58();
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const reviewed = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...instructions];
  let transaction = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(owner), recentBlockhash: blockhash.blockhash, instructions: reviewed }).compileToV0Message());
  transaction.sign(signers);
  validateLocalInstructions(transaction, reviewed, owner, signers.map(signer => signer.publicKey.toBase58()));
  const fee = (await connection.getFeeForMessage(transaction.message, 'confirmed')).value;
  if (fee === null || fee > 10000000) throw new Error('Pump network fee is unavailable or exceeds the 0.01 SOL cap.');
  // Reserve rent for creation/Token-2022/volume accounts; simulation validates the actual requirements.
  const rentReserve = BigInt(await connection.getMinimumBalanceForRentExemption(4096));
  if (BigInt(await connection.getBalance(new PublicKey(owner))) < spend + rentReserve + BigInt(fee)) throw new Error('Insufficient SOL for the input, network fee and account rent reserve.');
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) throw new Error(`Pump simulation failed: ${JSON.stringify(simulation.value.err)}`);
  const expires = Date.now() + 45000;
  let used = false;
  return { expires, networkFee: fromUnits(String(fee), 9), rentReserve: fromUnits(String(rentReserve), 9), async execute() {
    if (used || Date.now() > expires) throw new Error('Pump review used or expired. Prepare again.');
    if (wallet()?.toBase58() !== owner) throw new Error('Wallet changed. Prepare again.');
    if (refreshBeforeSigning) {
      const fresh = await connection.getLatestBlockhash('confirmed');
      transaction = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(owner), recentBlockhash: fresh.blockhash, instructions: reviewed }).compileToV0Message());
      transaction.sign(signers);
      const checked = await connection.simulateTransaction(transaction);
      if (checked.value.err) throw new Error(`Pump claim simulation failed: ${JSON.stringify(checked.value.err)}. No transaction was submitted.`);
      if (wallet()?.toBase58() !== owner || Date.now() > expires || used) throw new Error('Claim review changed or expired. Prepare again.');
    }
    validateLocalInstructions(transaction, reviewed, owner, signers.map(signer => signer.publicKey.toBase58()));
    used = true;
    return submit(transaction, record, onSubmitted);
  } };
}

export async function preparePumpLaunch(context, { name, ticker, uri, onProgress = () => {} }) {
  onProgress('Loading official Pump launch configuration...');
  const pump = await sdk(context.connection, context.pumpSdk), owner = context.wallet(), mint = Keypair.generate();
  const account = await context.connection.getAccountInfo(pump.GLOBAL_PDA);
  if (!account?.owner.equals(pump.PUMP_PROGRAM_ID)) throw new Error('Pump global configuration ownership is invalid.');
  const global = await pump.online.fetchGlobal();
  if (!global.createV2Enabled) throw new Error('Pump create_v2 launches are not currently enabled.');
  const instruction = await pump.PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name, symbol: ticker, uri, creator: owner, user: owner, mayhemMode: false, cashback: false, holderReward: false });
  const poolId = pump.bondingCurvePda(mint.publicKey).toBase58();
  onProgress('Simulating Pump creation...');
  const built = await preparedTransaction(context, [instruction], { signers: [mint], record: { operation: 'launch', protocol: 'pump', mint: mint.publicKey.toBase58(), poolId } });
  return { mint: mint.publicKey.toBase58(), poolId, protocol: 'pump', transactions: 1, supply: fromUnits(global.tokenTotalSupply.toString(), 6),
    economics: { curveSupply: fromUnits(global.initialRealTokenReserves.toString(), 6), fundraisingTarget: 'Determined by Pump curve reserves', migrationFee: fromUnits(global.poolMigrationFee.toString(), 9), protocolFeePercent: `${Number(global.feeBasisPoints.toString()) / 100} (dynamic trade tiers may apply)`, platformFeePercent: '0', creatorFeePercent: `${Number(global.creatorFeeBasisPoints.toString()) / 100} (dynamic trade tiers may apply)`, networkFees: built.networkFee },
    execute: async () => [await built.execute()] };
}

export async function pumpLaunchState(connection, coin, moduleOverride) {
  const pump = await sdk(connection, moduleOverride), mint = new PublicKey(coin.mint), curveId = pump.bondingCurvePda(mint);
  if (!curveId.equals(new PublicKey(coin.poolId))) throw new Error('Noncanonical Pump bonding curve.');
  const account = await connection.getAccountInfo(curveId);
  if (!account?.owner.equals(pump.PUMP_PROGRAM_ID)) throw new Error('Pump bonding curve is not confirmed.');
  const pool = pump.PUMP_SDK.decodeBondingCurve(account);
  if (![PublicKey.default.toBase58(), SOL].includes(pool.quoteMint.toBase58())) throw new Error('This integration supports SOL-quoted Pump coins only.');
  const graduated = pump.isBondingCurveMigrated(pool);
  const global = await pump.online.fetchGlobal();
  const progress = pool.complete ? 100 : Math.max(0, Math.min(100, 100 - Number(pool.realTokenReserves.toString()) / Number(global.initialRealTokenReserves.toString()) * 100));
  return { pool, progress, graduated, migrating: pool.complete && !graduated, raised: fromUnits(pool.realQuoteReserves.toString(), 9), target: '--', pump };
}

export async function preparePumpTrade(context, coin, side, amount, slippageBps, executionContext = {}) {
  if (!['Buy', 'Sell'].includes(side)) throw new Error('Invalid trade side.');
  minimumOutput('1', slippageBps);
  const state = await pumpLaunchState(context.connection, coin, context.pumpSdk);
  if (state.migrating) throw new Error('Pump curve is complete and awaiting PumpSwap migration. Recheck before trading.');
  if (state.graduated) return preparePumpSwap(context, coin, side, amount, slippageBps, executionContext);
  const { pump } = state, mint = new PublicKey(coin.mint), user = context.wallet();
  const mintAccount = await context.connection.getAccountInfo(mint);
  if (!mintAccount || ![TOKEN, TOKEN2022].includes(mintAccount.owner.toBase58())) throw new Error('Unsupported Pump mint owner.');
  const tokenProgram = mintAccount.owner;
  const onlineState = side === 'Buy' ? await pump.online.fetchBuyState(mint, user, tokenProgram) : await pump.online.fetchSellState(mint, user, tokenProgram);
  if (!onlineState.bondingCurveAccountInfo.owner.equals(pump.PUMP_PROGRAM_ID) || onlineState.bondingCurve.complete) throw new Error('Pump curve changed. Refresh the quote.');
  const global = await pump.online.fetchGlobal(), feeConfig = await pump.online.fetchFeeConfig();
  const units = new BN(toUnits(amount, side === 'Buy' ? 9 : 6));
  const supply = new BN((await context.connection.getTokenSupply(mint)).value.amount);
  const args = { global, feeConfig, mintSupply: supply, bondingCurve: onlineState.bondingCurve, amount: units, quoteMint: new PublicKey(SOL) };
  const output = side === 'Buy' ? pump.getBuyTokenAmountFromSolAmount(args) : pump.getSellSolAmountFromTokenAmount(args);
  const minimum = new BN(minimumOutput(output.toString(), slippageBps));
  if (minimum.isZero()) throw new Error('Trade output is too small.');
  const common = { ...onlineState, global, mint, user, tokenProgram, slippage: 0 };
  // Exact token-out bounded by the reviewed SOL budget; sells fix input and minimum SOL out.
  const instructions = side === 'Buy' ? await pump.PUMP_SDK.buyV2Instructions({ ...common, amount: minimum, quoteAmount: units }) : await pump.PUMP_SDK.sellV2Instructions({ ...common, amount: units, quoteAmount: minimum });
  const built = await preparedTransaction(context, instructions, { spend: side === 'Buy' ? BigInt(units.toString()) : 0n, record: { operation: side.toLowerCase(), protocol: 'pump', mint: coin.mint, ...executionContext.record }, onSubmitted: executionContext.onSubmitted });
  return tradeReview(built, coin, side, output, minimum, slippageBps, 'Pump bonding curve');
}

function tradeReview(built, coin, side, output, minimum, slippageBps, route) {
  return { ...built, inputIsMaximum: side === 'Buy', output: fromUnits((side === 'Buy' ? minimum : output).toString(), side === 'Buy' ? 6 : 9), minimum: fromUnits(minimum.toString(), side === 'Buy' ? 6 : 9), outputSymbol: side === 'Buy' ? coin.ticker : 'SOL', route, fee: 'On-chain dynamic fees', slippage: `${slippageBps / 100}%`, feeDetails: [['Network fee estimate', built.networkFee], ['Account rent reserve', built.rentReserve]] };
}

async function preparePumpSwap(context, coin, side, amount, slippageBps, executionContext) {
  const amm = await import('@pump-fun/pump-swap-sdk');
  const mint = new PublicKey(coin.mint), quoteMint = new PublicKey(SOL);
  const poolId = amm.canonicalPumpPoolPda(mint, quoteMint);
  const account = await context.connection.getAccountInfo(poolId);
  if (!account?.owner.equals(amm.PUMP_AMM_PROGRAM_ID)) throw new Error('Canonical PumpSwap pool is not available yet.');
  const state = await new amm.OnlinePumpAmmSdk(context.connection).swapSolanaState(poolId, context.wallet());
  if (!state.pool.baseMint.equals(mint) || !state.pool.quoteMint.equals(quoteMint)) throw new Error('PumpSwap pool mints differ from the reviewed pair.');
  const args = { baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount, virtualQuoteReserves: state.pool.virtualQuoteReserves, feeBucketsTotal: state.pool.protocolFees.add(state.pool.creatorFees), globalConfig: state.globalConfig, feeConfig: state.feeConfig, baseMint: state.baseMint, baseMintAccount: state.baseMintAccount, coinCreator: state.pool.coinCreator, creator: state.pool.creator, quoteMint, isMayhemMode: state.pool.isMayhemMode, creatorFeeBps: state.pool.creatorFeeBps, slippage: 0 };
  const units = new BN(toUnits(amount, side === 'Buy' ? 9 : 6));
  const output = side === 'Buy' ? amm.buyQuoteInput({ ...args, quote: units }).base : amm.sellBaseInput({ ...args, base: units }).uiQuote;
  const minimum = new BN(minimumOutput(output.toString(), slippageBps));
  if (minimum.isZero()) throw new Error('Trade output is too small.');
  const instructions = side === 'Buy' ? await amm.PUMP_AMM_SDK.buyV2Instructions(state, minimum, units) : await amm.PUMP_AMM_SDK.sellV2Instructions(state, units, minimum);
  const built = await preparedTransaction(context, instructions, { spend: side === 'Buy' ? BigInt(units.toString()) : 0n, record: { operation: side.toLowerCase(), protocol: 'pumpswap', mint: coin.mint, ...executionContext.record }, onSubmitted: executionContext.onSubmitted });
  return tradeReview(built, coin, side, output, minimum, slippageBps, 'PumpSwap');
}
