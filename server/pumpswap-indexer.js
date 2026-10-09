import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
const require = createRequire(import.meta.url);
const amm = require('@pump-fun/pump-swap-sdk');
const pump = require('@pump-fun/pump-sdk');
export const PUMPSWAP_PROGRAM = amm.PUMP_AMM_PROGRAM_ID.toBase58();
const SOL = new PublicKey('So11111111111111111111111111111111111111112');
const prefix = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);

export function decodePumpSwapEvents(transaction) {
  if (!transaction?.meta || transaction.meta.err) return [];
  const message = transaction.transaction.message;
  const keys = [...(message.staticAccountKeys || message.accountKeys), ...(transaction.meta.loadedAddresses?.writable || []), ...(transaction.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58());
  const decode = (bytes, index) => {
    const definition = amm.OFFLINE_PUMP_AMM_PROGRAM.idl.events.find(event => ['buyEvent', 'sellEvent'].includes(event.name) && bytes.subarray(0, 8).equals(Buffer.from(event.discriminator)));
    if (!definition || bytes.length < 360 || bytes.length > 4096) return null;
    let result;
    try { result = amm.OFFLINE_PUMP_AMM_PROGRAM.coder.events.decode(bytes.toString('base64')); }
    catch {
      // Later SDK fields are appended to the historical core event layout.
      result = amm.OFFLINE_PUMP_AMM_PROGRAM.coder.events.decode(Buffer.concat([bytes, Buffer.alloc(4096)]).toString('base64'));
    }
    return result && ['buyEvent', 'sellEvent'].includes(result.name) ? { ...result, index } : null;
  };
  const result = [];
  for (const group of transaction.meta.innerInstructions || []) for (const [i, instruction] of group.instructions.entries()) {
    if (keys[instruction.programIdIndex] !== PUMPSWAP_PROGRAM || !instruction.data) continue;
    const bytes = Buffer.from(bs58.decode(instruction.data));
    if (!bytes.subarray(0, 8).equals(prefix)) continue;
    const event = decode(bytes.subarray(8), `cpi:${group.index}:${i}`);
    if (event) result.push(event);
  }
  if (result.length) return result;
  const stack = [];
  for (const [i, line] of (transaction.meta.logMessages || []).entries()) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]); continue; }
    if (/^Program \w+ (success|failed:)/.test(line)) { stack.pop(); continue; }
    if (stack.at(-1) !== PUMPSWAP_PROGRAM || !line.startsWith('Program data: ')) continue;
    const event = decode(Buffer.from(line.slice(14), 'base64'), `log:${i}`);
    if (event) result.push(event);
  }
  return result;
}

export async function indexPumpSwapTransaction({ transaction, row, connection, index }) {
  for (const event of decodePumpSwapEvents(transaction)) {
    const account = await connection.getAccountInfoAndContext(event.data.pool, { commitment: 'finalized' });
    if (!account.value?.owner.equals(amm.PUMP_AMM_PROGRAM_ID)) throw new Error('Invalid PumpSwap account owner.');
    const pool = amm.PUMP_AMM_SDK.decodePool(account.value);
    if (!pool.quoteMint.equals(SOL) || !amm.canonicalPumpPoolPda(pool.baseMint, SOL).equals(event.data.pool)) continue;
    const curveId = pump.bondingCurvePda(pool.baseMint);
    const info = await connection.getAccountInfoAndContext(curveId, { commitment: 'finalized' });
    if (!info.value?.owner.equals(pump.PUMP_PROGRAM_ID)) throw new Error('Invalid migrated Pump curve owner.');
    const curve = pump.PUMP_SDK.decodeBondingCurve(info.value);
    if (!curve.complete || curve.isMayhemMode || curve.isHolderReward || ![PublicKey.default.toBase58(), SOL.toBase58()].includes(curve.quoteMint.toBase58())) continue;
    // Keep the original curve identity, so both venues share a single mint history.
    await index.saveLaunch({ pool: curveId.toBase58(), mint: pool.baseMint.toBase58(), creator: curve.creator.toBase58(), config: pump.GLOBAL_PDA.toBase58(), platform: pump.PUMP_PROGRAM_ID.toBase58(), name: '', ticker: '', uri: '', decimals: 6, status: 2, raised: curve.realQuoteReserves.toString(), target: '0', supply: curve.tokenTotalSupply.toString(), created: null, slot: info.context.slot, protocol: 'pump', progress: 100 });
    const buy = event.name === 'buyEvent', data = event.data;
    const base = buy ? data.baseAmountOut : data.baseAmountIn;
    const quote = buy ? data.quoteAmountIn : data.quoteAmountOut;
    if (base.lten(0) || quote.lten(0)) continue;
    await index.saveTrade({ signature: row.signature, index: event.index, pool: curveId.toBase58(), slot: row.slot, blockTime: row.blockTime, side: buy ? 'buy' : 'sell', base: base.toString(), quote: quote.toString(), fees: data.lpFee.add(data.protocolFee).add(data.coinCreatorFee).add(data.buybackFee).toString(), venue: 'pumpswap' });
  }
}
