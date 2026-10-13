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
import { randomUUID } from 'node:crypto';
import { PUMP_PROGRAM } from './pump-events.js';
import { indexPumpTransaction } from './pump-indexer.js';
import { indexPumpSwapTransaction, PUMPSWAP_PROGRAM } from './pumpswap-indexer.js';
import { createRateSampler } from './chart-rates.js';
import { indexerErrorCode } from './indexer-error.js';
import { pacedRpcFetch } from './indexer-rpc-fetch.js';
import { createPilotControl } from './pilot-control.js';
import { createRequire } from 'node:module';
const pumpSdk = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const swapSdk = createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');

if (!process.env.DATABASE_URL || !process.env.SOLANA_RPC_URL) throw new Error('Indexer requires DATABASE_URL and SOLANA_RPC_URL.');
const settings = indexerSettings(process.env);
const shutdown = new AbortController();
const control = createPilotControl(process.env.DATABASE_URL);
const requestInterval = Number(process.env.INDEXER_RPC_INTERVAL_MS || 1000);
if (!Number.isInteger(requestInterval) || requestInterval < 100 || requestInterval > 60000) throw new Error('INDEXER_RPC_INTERVAL_MS must be between 100 and 60000.');
const sharedInterval = Number(process.env.RPC_SHARED_INTERVAL_MS || 500);
if (!Number.isInteger(sharedInterval) || sharedInterval < 100 || sharedInterval > 60000) throw new Error('Invalid RPC_SHARED_INTERVAL_MS.');
const sharedFetch = control.fetch((url, options) => fetch(url, { ...options, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25000)]) }), sharedInterval, shutdown.signal);
const rpcFetch = pacedRpcFetch({ interval: requestInterval, signal: shutdown.signal, fetcher: sharedFetch });
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: rpcFetch });
const protocol = process.env.INDEXER_PROTOCOL || 'pump';
if (!['pump', 'raydium'].includes(protocol)) throw new Error('INDEXER_PROTOCOL must be pump or raydium.');
const checkpoint = protocol === 'pump' ? 'pump-indexer' : 'launchlab-indexer';
const program = new PublicKey(protocol === 'pump' ? PUMP_PROGRAM : LAUNCHLAB_PROGRAM);
const scanPrograms = protocol === 'pump' ? [{ program, key: checkpoint }, { program: new PublicKey(PUMPSWAP_PROGRAM), key: 'pumpswap-indexer' }] : [{ program, key: checkpoint }];
const scope = process.env.INDEXER_SCOPE || 'targeted';
if (!['targeted', 'global'].includes(scope)) throw new Error('INDEXER_SCOPE must be targeted or global.');
let targetOffset = 0;
// Only indexer account reads are cached; wallet quotes never use this cache.
const accountRead = connection.getAccountInfoAndContext.bind(connection);
const accountCache = new Map();
connection.getAccountInfoAndContext = async (key, options) => {
  const id = key.toBase58(), hit = accountCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.task;
  const task = accountRead(key, options).catch(error => { accountCache.delete(id); throw error; });
  if (accountCache.size >= 200) accountCache.delete(accountCache.keys().next().value);
  accountCache.set(id, { task, expires: Date.now() + (id === pumpSdk.GLOBAL_PDA.toBase58() ? 30000 : 2000) });
  return task;
};
connection.getAccountInfo = async (key, options) => (await connection.getAccountInfoAndContext(key, options)).value;
const records = createAppStore({ databaseUrl: process.env.DATABASE_URL });
const index = createChainIndexStore(process.env.DATABASE_URL);
const sampleRate = createRateSampler(index);
const queue = createIndexerQueue(process.env.DATABASE_URL, { name: protocol === 'pump' ? 'pump' : 'launchlab' });
const lock = new pg.Client(databaseConfig(process.env.DATABASE_URL));
let stopping = false;
const stop = () => { stopping = true; shutdown.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
lock.on('error', stop);
const pause = ms => delay(ms, undefined, { signal: shutdown.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
async function processSignature(row) {
  const transaction = await connection.getTransaction(row.signature, { maxSupportedTransactionVersion: 1, commitment: 'finalized' });
  if (!transaction) throw new Error('Finalized transaction not available; cursor retained for retry.');
  if (protocol === 'pump') {
    await indexPumpTransaction({ transaction, row, connection, index });
    return indexPumpSwapTransaction({ transaction, row, connection, index });
  }
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
  await Promise.all([records.ready(), index.ready(), queue.ready(), control.ready()]);
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Indexer requires Solana mainnet.');
  let state = (await records.get(checkpoint))[0] || {};
  let leader = false;
  async function scanOnce() {
    let activeCheckpoint = checkpoint;
    if (settings.role === 'process' || stopping) return;
    if (!leader) {
      const result = await lock.query('SELECT pg_try_advisory_lock($1) AS acquired', [protocol === 'pump' ? 741924 : 741922]);
      leader = result.rows[0].acquired;
      if (!leader) return;
      state = (await records.get(checkpoint))[0] || {};
    }
    try {
      const stats = await queue.stats();
      if (stats.pending + stats.processing >= settings.maxJobs) return;
      await sampleRate().catch(() => console.error('Chart USD rate unavailable; SOL indexing continues.'));
      let scans = scanPrograms;
      if (scope === 'targeted' && protocol === 'pump') {
        const targets = await control.targets();
        const selected = targets.slice(targetOffset, targetOffset + 5);
        targetOffset = targetOffset + 5 >= targets.length ? 0 : targetOffset + 5;
        scans = selected.flatMap(target => {
          const mint = new PublicKey(target.mint);
          return [pumpSdk.bondingCurvePda(mint), swapSdk.canonicalPumpPoolPda(mint, new PublicKey('So11111111111111111111111111111111111111112'))].map(address => ({ program: address, key: `target-indexer:${address.toBase58()}`, priority: Number(target.priority) }));
        });
      }
      for (const scan of scans) {
      activeCheckpoint = scan.key;
      state = (await records.get(scan.key))[0] || {};
      for (const backfill of [false, true]) {
        if (stopping) break;
        // Reserve headroom for live scans; suspend historical backfill under pressure.
        if (backfill && stats.pending + stats.processing >= settings.maxJobs / 2) continue;
        if (backfill && process.env.INDEXER_BACKFILL !== 'true') continue;
        if (backfill && (await queue.stats()).pending > 100) continue;
        state = await scanPage({ connection, program: scan.program, state, enqueue: rows => queue.enqueue(rows.map(row => ({ ...row, priority: backfill ? 1 : scan.priority || 2 }))), backfill, limit: settings.pageSize });
        await records.mutate(scan.key, entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: null }); });
      }
      }
    } catch (error) {
      await records.mutate(activeCheckpoint, entries => { entries.splice(0, entries.length, { ...state, updatedAt: Date.now(), error: indexerErrorCode(error) }); }).catch(() => {});
      console.error('Indexer checkpoint retained for retry.', activeCheckpoint, indexerErrorCode(error));
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
      await queue.fail(job, indexerErrorCode(error));
      console.error('Indexing job retained for retry.', indexerErrorCode(error));
      if (process.env.INDEXER_ONCE === 'true') process.exitCode = 1;
    } finally { clearInterval(heartbeat); }
    return true;
  }
  if (process.env.INDEXER_ONCE === 'true') {
    await scanOnce();
    if (settings.role !== 'scan') await Promise.all(Array.from({ length: settings.concurrency }, () => processOne()));
  } else {
    const loops = [];
    const workerId = randomUUID();
    loops.push((async () => {
      let lastPrune = 0;
      while (!stopping) {
        await queue.heartbeat(workerId, settings.role);
        if (Date.now() - lastPrune > 3600000) { await queue.prune(); await index.pruneEvents(); lastPrune = Date.now(); }
        const metrics = await queue.stats();
        if (metrics.failed || metrics.oldestPendingAgeMs > 300000) console.warn('Indexer backlog alert', JSON.stringify({ pending: metrics.pending, failed: metrics.failed, oldestPendingAgeMs: metrics.oldestPendingAgeMs, completedLastMinute: metrics.completedLastMinute }));
        if (metrics.pending < 100) await queue.recoverTransient(10);
        await pause(30000);
      }
    })());
    if (settings.role !== 'process') loops.push((async () => {
      while (!stopping) { await scanOnce(); await pause(settings.scanInterval); }
    })());
    if (settings.role !== 'scan') for (let i = 0; i < settings.concurrency; i++) loops.push((async () => {
      while (!stopping) { if (!await processOne()) await pause(1000); }
    })());
    try { await Promise.all(loops); }
    catch (error) { stop(); await Promise.allSettled(loops); throw error; }
  }
} finally { await Promise.all([records.close(), index.close(), queue.close(), control.close(), lock.end()]); }
