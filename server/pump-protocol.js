import { PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
// The official SDK's transitive ESM entry has incompatible Anchor named exports on Node 20.
const require = createRequire(import.meta.url);

export async function verifyPumpLaunch(connection, { mint, poolId, creator }, account) {
  const pump = require('@pump-fun/pump-sdk');
  const expected = pump.bondingCurvePda(new PublicKey(mint));
  if (!expected.equals(new PublicKey(poolId)) || !account?.owner.equals(pump.PUMP_PROGRAM_ID)) throw Object.assign(new Error('Canonical Pump curve is not confirmed.'), { status: 400 });
  const curve = pump.PUMP_SDK.decodeBondingCurve(account);
  if (!curve.creator.equals(new PublicKey(creator))) throw Object.assign(new Error('This wallet does not own the Pump launch.'), { status: 403 });
  if (![PublicKey.default.toBase58(), 'So11111111111111111111111111111111111111112'].includes(curve.quoteMint.toBase58()) || curve.isMayhemMode || curve.isHolderReward) throw Object.assign(new Error('This registration supports standard SOL Pump launches only.'), { status: 400 });
  const mintAccount = await connection.getParsedAccountInfo(new PublicKey(mint));
  if (mintAccount.value?.data?.parsed?.info?.decimals !== 6 || mintAccount.value.owner.toBase58() !== 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') throw Object.assign(new Error('Pump launch mint format is not supported.'), { status: 400 });
  return curve;
}

export async function pumpListing(coin, account, global) {
  const pump = require('@pump-fun/pump-sdk');
  if (!account?.owner.equals(pump.PUMP_PROGRAM_ID) || pump.bondingCurvePda(new PublicKey(coin.mint)).toBase58() !== coin.poolId) return { ...coin, launchStatus: 'Unavailable' };
  const curve = pump.PUMP_SDK.decodeBondingCurve(account);
  const graduated = pump.isBondingCurveMigrated(curve);
  return { ...coin, progress: curve.complete ? 100 : Math.max(0, Math.min(100, 100 - Number(curve.realTokenReserves.toString()) / Number(global.initialRealTokenReserves.toString()) * 100)), launchStatus: graduated ? 'Graduated' : curve.complete ? 'Migrating' : 'Trading', raised: curve.realQuoteReserves.toString(), updatedAt: Date.now() };
}

export async function pumpGlobal(connection) {
  const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
  return new OnlinePumpSdk(connection).fetchGlobal();
}
