import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from './database-config.js';

export function retryDelay(attempt) {
  return Math.min(300000, 1000 * 2 ** Math.min(attempt, 9));
}

export function createIndexerQueue(databaseUrl, { now = Date.now, leaseMs = 120000, maxAttempts = 10, name = 'launchlab' } = {}) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1000 || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid queue configuration.');
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 4, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Indexer queue database connection error.'));
  return {
    ready: async () => { await pool.query('SELECT signature FROM indexer_jobs LIMIT 0'); await pool.query('SELECT id FROM indexer_workers LIMIT 0'); },
    close: () => pool.end(),
    heartbeat: async (id, role) => { await pool.query('INSERT INTO indexer_workers(id,queue_name,role,updated) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET updated=EXCLUDED.updated', [id, name, role, now()]); },
    workers: async () => (await pool.query('SELECT id,role,updated FROM indexer_workers WHERE queue_name=$1 AND updated>$2 ORDER BY updated DESC LIMIT 100', [name, now() - 90000])).rows,
    failed: async () => (await pool.query("SELECT signature,attempts,error_code,updated FROM indexer_jobs WHERE queue_name=$1 AND status='failed' ORDER BY updated,signature LIMIT 100", [name])).rows,
    status: async signature => (await pool.query('SELECT signature,status,attempts,error_code,updated FROM indexer_jobs WHERE queue_name=$1 AND signature=$2', [name, signature])).rows[0] || null,
    recoverTransient: async (limit = 10) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid recovery limit.');
      return (await pool.query(`WITH selected AS (
        SELECT signature FROM indexer_jobs WHERE queue_name=$1 AND status='failed' AND updated<$3::bigint-300000
        AND error_code IN ('RPC_RATE_LIMIT','RPC_TIMEOUT','RPC_NETWORK_ERROR') ORDER BY updated LIMIT $2 FOR UPDATE SKIP LOCKED
      ) UPDATE indexer_jobs SET status='pending',attempts=0,error_code=NULL,available_at=$3,updated=$3
        WHERE queue_name=$1 AND signature IN (SELECT signature FROM selected)`, [name, limit, now()])).rowCount;
    },
    retryFailed: async (limit = 10) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Retry batch must be between 1 and 100.');
      return (await pool.query(`WITH selected AS (
        SELECT signature FROM indexer_jobs WHERE queue_name=$1 AND status='failed'
        ORDER BY updated,signature LIMIT $2 FOR UPDATE SKIP LOCKED
      ) UPDATE indexer_jobs SET status='pending',attempts=0,error_code=NULL,lease_until=NULL,lease_token=NULL,available_at=$3,updated=$3
        WHERE queue_name=$1 AND status='failed' AND signature IN (SELECT signature FROM selected)`, [name, limit, now()])).rowCount;
    },
    retry: async signature => (await pool.query("UPDATE indexer_jobs SET status='pending',attempts=0,error_code=NULL,lease_until=NULL,lease_token=NULL,available_at=$3,updated=$3 WHERE queue_name=$1 AND signature=$2 AND status='failed'", [name, signature, now()])).rowCount === 1,
    prune: async () => {
      const cutoff = now() - 7 * 86400000;
      const result = await pool.query("DELETE FROM indexer_jobs WHERE queue_name=$1 AND signature IN (SELECT signature FROM indexer_jobs WHERE queue_name=$1 AND status='done' AND updated<$2 ORDER BY updated LIMIT 1000)", [name, cutoff]);
      await pool.query('DELETE FROM indexer_workers WHERE queue_name=$1 AND id IN (SELECT id FROM indexer_workers WHERE queue_name=$1 AND updated<$2 LIMIT 1000)', [name, cutoff]);
      return result.rowCount;
    },
    enqueue: async rows => {
      if (!rows.length) return;
      const time = now();
      await pool.query(`INSERT INTO indexer_jobs(queue_name,signature,payload,available_at,updated,priority,enqueued_at)
        SELECT $3,entry->>'signature',entry,$2,$2,COALESCE((entry->>'priority')::integer,0),$2 FROM jsonb_array_elements($1::jsonb) entry
        ON CONFLICT(queue_name,signature) DO UPDATE SET priority=GREATEST(indexer_jobs.priority,EXCLUDED.priority)`, [JSON.stringify(rows), time, name]);
    },
    claim: async () => {
      const time = now(), token = randomUUID();
      await pool.query(`UPDATE indexer_jobs SET status='failed',error_code='LEASE_RETRY_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated=$1
        WHERE queue_name=$3 AND status='processing' AND lease_until<=$1 AND attempts>=$2`, [time, maxAttempts, name]);
      const result = await pool.query(`WITH candidate AS (
        SELECT signature FROM indexer_jobs WHERE queue_name=$5 AND attempts<$4 AND
        ((status='pending' AND available_at<=$1) OR (status='processing' AND lease_until<=$1))
        ORDER BY priority DESC,available_at,signature FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE indexer_jobs j SET status='processing',attempts=j.attempts+1,lease_token=$2,lease_until=$3,updated=$1
        FROM candidate WHERE j.queue_name=$5 AND j.signature=candidate.signature RETURNING j.*`, [time, token, time + leaseMs, maxAttempts, name]);
      return result.rows[0] || null;
    },
    renew: async job => (await pool.query(`UPDATE indexer_jobs SET lease_until=$3,updated=$4 WHERE queue_name=$5 AND signature=$1 AND lease_token=$2 AND status='processing' AND lease_until>$4`, [job.signature, job.lease_token, now() + leaseMs, now(), name])).rowCount === 1,
    complete: async job => (await pool.query(`UPDATE indexer_jobs SET status='done',lease_token=NULL,lease_until=NULL,error_code=NULL,updated=$3
      WHERE queue_name=$4 AND signature=$1 AND lease_token=$2 AND status='processing' AND lease_until>$3`, [job.signature, job.lease_token, now(), name])).rowCount === 1,
    fail: async (job, code = 'PROCESSING_ERROR') => {
      const time = now();
      const safeCode = /^[A-Z0-9_-]{1,40}$/.test(String(code)) ? String(code) : 'PROCESSING_ERROR';
      if (safeCode === 'INDEX_VALIDATION_FAILED') {
        return (await pool.query("UPDATE indexer_jobs SET status='failed',error_code=$3,updated=$4,lease_token=NULL,lease_until=NULL WHERE queue_name=$5 AND signature=$1 AND lease_token=$2 AND status='processing'", [job.signature, job.lease_token, safeCode, time, name])).rowCount === 1;
      }
      if (['RPC_RATE_LIMIT', 'RPC_TIMEOUT', 'RPC_NETWORK_ERROR'].includes(safeCode)) {
        return (await pool.query(`UPDATE indexer_jobs SET status='pending',attempts=GREATEST(0,attempts-1),available_at=$3,updated=$4,error_code=$5,lease_token=NULL,lease_until=NULL
          WHERE queue_name=$6 AND signature=$1 AND lease_token=$2 AND status='processing'`, [job.signature, job.lease_token, time + 60000, time, safeCode, name])).rowCount === 1;
      }
      return (await pool.query(`UPDATE indexer_jobs SET status=CASE WHEN attempts>=$4 THEN 'failed' ELSE 'pending' END,
        available_at=$5,lease_token=NULL,lease_until=NULL,error_code=$3,updated=$6
        WHERE queue_name=$7 AND signature=$1 AND lease_token=$2 AND status='processing' AND lease_until>$6`, [job.signature, job.lease_token, safeCode, maxAttempts, time + retryDelay(job.attempts), time, name])).rowCount === 1;
    },
    stats: async () => {
      const { rows } = await pool.query(`SELECT status,count(*)::int AS count,min(COALESCE(enqueued_at,updated)) AS oldest FROM indexer_jobs WHERE queue_name=$1 AND status<>'done' GROUP BY status`, [name]);
      const counts = { pending: 0, processing: 0, failed: 0, oldestPendingAt: null };
      for (const row of rows) { counts[row.status] = row.count; if (row.status === 'pending') counts.oldestPendingAt = Number(row.oldest); }
      counts.completedLastMinute = (await pool.query("SELECT count(*)::int AS count FROM indexer_jobs WHERE queue_name=$1 AND status='done' AND updated>$2", [name, now() - 60000])).rows[0].count;
      counts.failuresByCode = (await pool.query("SELECT error_code,count(*)::int AS count FROM indexer_jobs WHERE queue_name=$1 AND status='failed' GROUP BY error_code", [name])).rows;
      counts.oldestPendingAgeMs = counts.oldestPendingAt === null ? null : Math.max(0, now() - counts.oldestPendingAt);
      return counts;
    },
  };
}
