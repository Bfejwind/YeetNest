import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { decodePumpEvents } from './pump-events.js';
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk');

export async function indexPumpTransaction({ transaction, row, connection, index }) {
  const events = decodePumpEvents(transaction);
  if (!events.length) return;
  const global = await new pump.OnlinePumpSdk(connection).fetchGlobal();
  for (const event of events) {
    const mint = event.data.mint, poolId = pump.bondingCurvePda(mint);
    const response = await connection.getAccountInfoAndContext(poolId, { commitment: 'finalized' });
    if (!response.value?.owner.equals(pump.PUMP_PROGRAM_ID)) throw new Error('Indexed Pump curve ownership is invalid.');
    const curve = pump.PUMP_SDK.decodeBondingCurve(response.value);
    if (![PublicKey.default.toBase58(), 'So11111111111111111111111111111111111111112'].includes(curve.quoteMint.toBase58()) || curve.isMayhemMode || curve.isHolderReward) continue;
    const created = event.name === 'CreateEvent';
    const progress = curve.complete ? 100 : Math.max(0, Math.min(100, 100 - Number(curve.realTokenReserves.toString()) / Number(global.initialRealTokenReserves.toString()) * 100));
    await index.saveLaunch({ pool: poolId.toBase58(), mint: mint.toBase58(), creator: curve.creator.toBase58(), config: pump.GLOBAL_PDA.toBase58(), platform: pump.PUMP_PROGRAM_ID.toBase58(), name: created ? event.data.name : '', ticker: created ? event.data.symbol : '', uri: created ? event.data.uri : '', decimals: 6, status: pump.isBondingCurveMigrated(curve) ? 2 : curve.complete ? 1 : 0, raised: curve.realQuoteReserves.toString(), target: '0', supply: curve.tokenTotalSupply.toString(), created: created ? Number(event.data.timestamp.toString()) * 1000 : null, slot: response.context.slot, protocol: 'pump', progress });
    if (event.name === 'TradeEvent') {
      const data = event.data;
      if (data.tokenAmount.isZero() || data.tokenAmount.isNeg() || data.solAmount.isZero()) continue;
      await index.saveTrade({ signature: row.signature, index: event.index, pool: poolId.toBase58(), slot: row.slot, blockTime: row.blockTime, side: data.isBuy ? 'buy' : 'sell', base: data.tokenAmount.toString(), quote: data.solAmount.toString(), fees: data.fee.add(data.creatorFee).add(data.buybackFee).toString() });
    }
  }
}
