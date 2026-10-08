import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { createAppStore } from './app-store.js';
import { createChainIndexStore } from './chain-index-store.js';
import { decodeLaunchlabEvents, LAUNCHLAB_PROGRAM, tradeAmounts } from './launchlab-events.js';
import { scanPage } from './indexer-scan.js';
import pg from 'pg';
import { databaseConfig } from './database-config.js';
import { LaunchpadPool, getPdaLaunchpadPoolId } from '@raydium-io/raydium-sdk-v2';
import { createIndexerQueue } from './indexer-queue.js';
import { indexerSettings } from './indexer-config.js';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.env.DATABASE_URL || !process.env.SOLANA_RPC_URL) throw new Error('Indexer requires DATABASE_URL and SOLANA_RPC_URL.');
const settings = indexerSettings(process.env);
const shutdown = new AbortController();
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25000)]) }) });
const program = new PublicKey(LAUNCHLAB_PROGRAM);
const records = createAppStore({ databaseUrl: process.env.DATABASE_URL });
const index = createChainIndexStore(process.env.DATABASE_URL);
const queue = createIndexerQueue(process.env.DATABASE_URL);
const lock = new pg.Client(databaseConfig(process.env.DATABASE_URL));
let stopping = false;
const stop = () => { stopping = true; shutdown.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
lock.on('error', stop);
const pause = ms => delay(ms, undefined, { signal: shutdown.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
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
  if (settings.role !== 'process') await lock.connect();
  await Promise.all([records.ready(), index.ready(), queue.ready()]);
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Indexer requires Solana mainnet.');
  let state = (await records.get('launchlab-indexer'))[0] || {};
  let leader = false;
  async function scanOnce() {
    if (settings.role === 'process' || stopping) return;
    if (!leader) {
      const result = await lock.query('SELECT pg_try_advisory_lock(741922) AS acquired');
      leader = result.rows[0].acquired;
      if (!leader) return;
      state = (await records.get('launchlab-indexer'))[0] || {};
    }
    try {
      const stats = await queue.stats();
      if (stats.pending + stats.processing >= settings.maxJobs) return;
      for (const backfill of [false, true]) {
        if (stopping) break;
        // Reserve headroom for live scans; suspend historical backfill under pressure.
        if (backfill && stats.pending + stats.processing >= settings.maxJobs / 2) continue;
        state = await scanPage({ connection, program, state, enqueue: queue.enqueue, backfill, limit: settings.pageSize });
        await records.mutate('launchlab-indexer', entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: null }); });
      }
    } catch (error) {
      await records.mutate('launchlab-indexer', entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: typeof error.code === 'number' ? error.code : 'INDEXER_RETRY' }); }).catch(() => {});
      console.error('Indexer checkpoint retained for retry.', error.name, typeof error.code === 'number' || /^[A-Z0-9_]{1,30}$/.test(String(error.code)) ? error.code : 'NO_CODE');
      if (process.env.INDEXER_ONCE === 'true') process.exitCode = 1;
    }
  }
  async function processOne() {
    const job = await queue.claim();
    if (!job) return false;
    const heartbeat = setInterval(() => {
      queue.renew(job).catch(() => console.error('Indexer lease renewal failed.'));
    }, 30000);
    try {
      await processSignature(job.payload);
      if (!await queue.complete(job)) console.error('Indexer lease expired; replay remains deduplicated.');
    } catch (error) {
      await queue.fail(job, typeof error.code === 'number' ? error.code : 'PROCESSING_ERROR');
      console.error('Indexing job retained for retry.', typeof error.code === 'number' ? error.code : 'PROCESSING_ERROR');
      if (process.env.INDEXER_ONCE === 'true') process.exitCode = 1;
    } finally { clearInterval(heartbeat); }
    return true;
  }
  if (process.env.INDEXER_ONCE === 'true') {
    await scanOnce();
    if (settings.role !== 'scan') await Promise.all(Array.from({ length: settings.concurrency }, () => processOne()));
  } else {
    const loops = [];
    if (settings.role !== 'process') loops.push((async () => {
      while (!stopping) { await scanOnce(); await pause(settings.scanInterval); }
    })());
    if (settings.role !== 'scan') for (let i = 0; i < settings.concurrency; i++) loops.push((async () => {
      while (!stopping) { if (!await processOne()) await pause(1000); }
    })());
    try { await Promise.all(loops); }
    catch (error) { stop(); await Promise.allSettled(loops); throw error; }
  }
} finally { await Promise.all([records.close(), index.close(), queue.close(), lock.end()]); }
