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
    ready: () => pool.query('SELECT signature FROM indexer_jobs LIMIT 0'),
    close: () => pool.end(),
    enqueue: async rows => {
      if (!rows.length) return;
      const time = now();
      await pool.query(`INSERT INTO indexer_jobs(queue_name,signature,payload,available_at,updated)
        SELECT $3,entry->>'signature',entry,$2,$2 FROM jsonb_array_elements($1::jsonb) entry
        ON CONFLICT(queue_name,signature) DO NOTHING`, [JSON.stringify(rows), time, name]);
    },
    claim: async () => {
      const time = now(), token = randomUUID();
      await pool.query(`UPDATE indexer_jobs SET status='failed',error_code='LEASE_RETRY_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated=$1
        WHERE queue_name=$3 AND status='processing' AND lease_until<=$1 AND attempts>=$2`, [time, maxAttempts, name]);
      const result = await pool.query(`WITH candidate AS (
        SELECT signature FROM indexer_jobs WHERE queue_name=$5 AND attempts<$4 AND
        ((status='pending' AND available_at<=$1) OR (status='processing' AND lease_until<=$1))
        ORDER BY available_at,signature FOR UPDATE SKIP LOCKED LIMIT 1
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
      return (await pool.query(`UPDATE indexer_jobs SET status=CASE WHEN attempts>=$4 THEN 'failed' ELSE 'pending' END,
        available_at=$5,lease_token=NULL,lease_until=NULL,error_code=$3,updated=$6
        WHERE queue_name=$7 AND signature=$1 AND lease_token=$2 AND status='processing' AND lease_until>$6`, [job.signature, job.lease_token, safeCode, maxAttempts, time + retryDelay(job.attempts), time, name])).rowCount === 1;
    },
    stats: async () => {
      const { rows } = await pool.query(`SELECT status,count(*)::int AS count,min(available_at) AS oldest FROM indexer_jobs WHERE queue_name=$1 AND status<>'done' GROUP BY status`, [name]);
      const counts = { pending: 0, processing: 0, failed: 0, oldestPendingAt: null };
      for (const row of rows) { counts[row.status] = row.count; if (row.status === 'pending') counts.oldestPendingAt = Number(row.oldest); }
      return counts;
    },
  };
}
