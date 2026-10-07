import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { createAppStore } from './app-store.js';
import { createChainIndexStore } from './chain-index-store.js';
import { decodeLaunchlabEvents, LAUNCHLAB_PROGRAM, tradeAmounts } from './launchlab-events.js';
import { scanPage } from './indexer-scan.js';
import pg from 'pg';
import { databaseConfig } from './database-config.js';
import { LaunchpadPool, getPdaLaunchpadPoolId } from '@raydium-io/raydium-sdk-v2';

if (!process.env.DATABASE_URL || !process.env.SOLANA_RPC_URL) throw new Error('Indexer requires DATABASE_URL and SOLANA_RPC_URL.');
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(25000) }) });
const program = new PublicKey(LAUNCHLAB_PROGRAM);
const records = createAppStore({ databaseUrl: process.env.DATABASE_URL });
const index = createChainIndexStore(process.env.DATABASE_URL);
const lock = new pg.Client(databaseConfig(process.env.DATABASE_URL));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
lock.on('error', () => { stopping = true; });
async function processSignature(row) {
  const transaction = await connection.getTransaction(row.signature, { maxSupportedTransactionVersion: 0, commitment: 'finalized' });
  if (!transaction) throw new Error('Finalized transaction not available; cursor retained for retry.');
  for (const event of decodeLaunchlabEvents(transaction)) {
    if (!['PoolCreateEvent', 'TradeEvent'].includes(event.name)) continue;
    const poolId = new PublicKey(event.data.pool_state);
    const response = await connection.getAccountInfoAndContext(poolId, { commitment: 'finalized' });
    if (!response.value?.owner.equals(program)) throw new Error('Indexed pool ownership is invalid.');
    if (!response.value.data.subarray(0, 8).equals(Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]))) throw new Error('Invalid pool discriminator.');
    const pool = LaunchpadPool.decode(response.value.data);
    if (!getPdaLaunchpadPoolId(program, pool.mintA, pool.mintB).publicKey.equals(poolId)) throw new Error('Invalid pool PDA.');
    // Only classic SPL/SOL pools supported by this site's trading policy.
    if (pool.mintB.toBase58() !== 'So11111111111111111111111111111111111111112' || pool.mintProgramFlag !== 0) continue;
    const params = event.data.base_mint_param;
    await index.saveLaunch({ pool: poolId.toBase58(), mint: pool.mintA.toBase58(), creator: pool.creator.toBase58(), config: pool.configId.toBase58(), platform: pool.platformId.toBase58(), name: params?.name || '', ticker: params?.symbol || '', uri: params?.uri || '', decimals: pool.mintDecimalsA, status: pool.status, raised: pool.realB.toString(), target: pool.totalFundRaisingB.toString(), supply: pool.supply.toString(), created: event.name === 'PoolCreateEvent' ? row.blockTime * 1000 || null : null, slot: response.context.slot });
    if (event.name === 'TradeEvent') await index.saveTrade({ signature: row.signature, index: event.index, pool: poolId.toBase58(), slot: row.slot, blockTime: row.blockTime, ...tradeAmounts(event.data) });
  }
}
try {
  await lock.connect();
  const result = await lock.query('SELECT pg_try_advisory_lock(741922) AS acquired');
  if (!result.rows[0].acquired) throw new Error('A LaunchLab indexer is already running.');
  await Promise.all([records.ready(), index.ready()]);
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Indexer requires Solana mainnet.');
  let state = (await records.get('launchlab-indexer'))[0] || {};
  while (!stopping) {
    try {
      for (const backfill of [false, true]) {
        if (stopping) break;
        state = await scanPage({ connection, program, state, processSignature, backfill });
        await records.mutate('launchlab-indexer', entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: null }); });
      }
    } catch (error) {
      await records.mutate('launchlab-indexer', entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: typeof error.code === 'number' ? error.code : 'INDEXER_RETRY' }); }).catch(() => {});
      console.error('Indexer checkpoint retained for retry.', error.name, typeof error.code === 'number' || /^[A-Z0-9_]{1,30}$/.test(String(error.code)) ? error.code : 'NO_CODE');
      if (process.env.INDEXER_ONCE === 'true') process.exitCode = 1;
    }
    if (process.env.INDEXER_ONCE === 'true') break;
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 15000));
  }
} finally { await Promise.all([records.close(), index.close(), lock.end()]); }
