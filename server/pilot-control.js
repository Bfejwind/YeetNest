import pg from 'pg';
import { createHash } from 'node:crypto';
import { databaseConfig } from './database-config.js';
import { setTimeout as sleep } from 'node:timers/promises';

export function createPilotControl(databaseUrl) {
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 2 });
  pool.on('error', () => console.error('Pilot control database unavailable.'));
  return {
    close: () => pool.end(),
    ready: () => pool.query('SELECT scope FROM rpc_budgets LIMIT 0'),
    scanState: async () => {
      const result = await pool.query("SELECT value->0 AS state FROM app_records WHERE key LIKE 'target-indexer:%' ORDER BY (value->0->>'updatedAt')::bigint DESC NULLS LAST LIMIT 200");
      const states = result.rows.map(row => row.state).filter(Boolean);
      return { updatedAt: states[0]?.updatedAt || null, error: states.find(state => state.error)?.error || null, backfillComplete: false, trackedAddresses: states.length };
    },
    touch: mint => pool.query('INSERT INTO indexer_interest(mint,touched) VALUES($1,$2) ON CONFLICT(mint) DO UPDATE SET touched=EXCLUDED.touched WHERE indexer_interest.touched<$2::bigint-300000', [mint, Date.now()]),
    targets: async () => {
      await pool.query('DELETE FROM indexer_interest WHERE touched<$1', [Date.now() - 86400000]);
      await pool.query('DELETE FROM indexer_interest WHERE mint IN (SELECT mint FROM indexer_interest ORDER BY touched DESC,mint OFFSET 1000 LIMIT 1000)');
      return (await pool.query(`SELECT mint,max(priority) AS priority FROM (
        SELECT mint,3 AS priority FROM catalogue_coins WHERE data->>'protocol'='pump'
        UNION ALL SELECT mint,2 AS priority FROM indexer_interest WHERE touched>$1
      ) t GROUP BY mint ORDER BY priority DESC,mint LIMIT 100`, [Date.now() - 3600000])).rows;
    },
    fetch: (fetcher, interval = 500, signal) => async (url, options) => {
      const scope = createHash('sha256').update(String(url)).digest('hex');
      // Signed submissions compete more promptly for the same shared quota slot.
      // The interval and provider cooldown remain unchanged for all requests.
      let submission = false;
      try { submission = JSON.parse(options?.body || '{}').method === 'sendTransaction'; } catch { /* Ordinary fetch. */ }
      const deadline = Date.now() + 60000;
      while (true) {
        if (signal?.aborted) throw signal.reason;
        const time = Date.now();
        await pool.query('INSERT INTO rpc_budgets(scope) VALUES($1) ON CONFLICT DO NOTHING', [scope]);
        const slot = await pool.query('UPDATE rpc_budgets SET next_at=$2::bigint+$3::bigint WHERE scope=$1 AND next_at<=$2::bigint AND cooldown_until<=$2::bigint RETURNING scope', [scope, time, interval]);
        if (slot.rowCount) break;
        if (time > deadline) throw Object.assign(new Error('Shared RPC budget busy'), { code: 'RPC_RATE_LIMIT' });
        await sleep(submission ? Math.min(interval,50) : interval, undefined, { signal });
      }
      const response = await fetcher(url, options);
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(300000, Math.max(10000, seconds * 1000)) : 30000;
        await pool.query('UPDATE rpc_budgets SET cooldown_until=GREATEST(cooldown_until,$2) WHERE scope=$1', [scope, Date.now() + wait]);
      }
      return response;
    },
  };
}
