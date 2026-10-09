import 'dotenv/config';
import { createRequire } from 'node:module';
import { Connection, PublicKey } from '@solana/web3.js';
import { createAppStore } from './app-store.js';
import { createIndexerQueue } from './indexer-queue.js';
import { scanPage } from './indexer-scan.js';
import pg from 'pg';
import { databaseConfig } from './database-config.js';
const require = createRequire(import.meta.url), pump = require('@pump-fun/pump-sdk'), amm = require('@pump-fun/pump-swap-sdk');
const mint = new PublicKey(process.argv[2]);
const pages = Number(process.argv[3] || 5);
if (!Number.isInteger(pages) || pages < 1 || pages > 100) throw new Error('Use npm run charts:backfill -- <mint> [pages 1..100].');
if (!process.env.DATABASE_URL || !process.env.SOLANA_RPC_URL) throw new Error('DATABASE_URL and SOLANA_RPC_URL are required.');
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(25000) }) });
const records = createAppStore({ databaseUrl: process.env.DATABASE_URL });
const queue = createIndexerQueue(process.env.DATABASE_URL, { name: 'pump' });
const lock = new pg.Client(databaseConfig(process.env.DATABASE_URL));
try {
  await Promise.all([records.ready(), queue.ready(), lock.connect()]);
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Mainnet RPC required.');
  const acquired = (await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`chart-backfill:${mint.toBase58()}`])).rows[0].acquired;
  if (!acquired) throw new Error('This mint already has a backfill running.');
  const curve = pump.bondingCurvePda(mint), swap = amm.canonicalPumpPoolPda(mint, new PublicKey('So11111111111111111111111111111111111111112'));
  const account = await connection.getAccountInfo(curve);
  if (!account?.owner.equals(pump.PUMP_PROGRAM_ID)) throw new Error('Mint does not have a Pump curve.');
  for (const program of [curve, swap]) {
    const exists = await connection.getAccountInfo(program);
    if (!exists) continue;
    const key = `chart-backfill:${program.toBase58()}`;
    let state = (await records.get(key))[0] || {};
    for (let page = 0; page < pages && !state.backfillComplete; page++) {
      const stats = await queue.stats();
      if (stats.pending + stats.processing >= 10000) throw new Error('Queue backpressure; let the worker drain and retry.');
      state = await scanPage({ connection, program, state, backfill: true, limit: 100, enqueue: queue.enqueue });
      await records.mutate(key, entries => entries.splice(0, entries.length, { ...state, updatedAt: Date.now() }));
    }
    console.log(JSON.stringify({ account: program.toBase58(), queued: true, scanComplete: Boolean(state.backfillComplete) }));
  }
  console.log('History queued for the Pump worker. Repeat to resume if scanComplete is false. No transactions were signed or sent.');
} catch (error) {
  console.error(error.code === 429 ? 'RPC rate limit; cursors retained. Retry later.' : `Backfill stopped (${error.name}). Check RPC, database, mint and worker queue; cursors retained.`);
  process.exitCode = 1;
} finally { await Promise.all([records.close(), queue.close(), lock.end()]); }
