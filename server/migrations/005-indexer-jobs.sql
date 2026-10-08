CREATE TABLE IF NOT EXISTS indexer_jobs (
  queue_name TEXT NOT NULL DEFAULT 'launchlab',
  signature TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at BIGINT NOT NULL,
  lease_until BIGINT,
  lease_token UUID,
  error_code TEXT,
  updated BIGINT NOT NULL,
  PRIMARY KEY(queue_name,signature)
);
CREATE INDEX IF NOT EXISTS indexer_jobs_pending ON indexer_jobs(queue_name,available_at,signature) WHERE status='pending';
CREATE INDEX IF NOT EXISTS indexer_jobs_leases ON indexer_jobs(queue_name,lease_until) WHERE status='processing';
CREATE INDEX IF NOT EXISTS indexer_jobs_status ON indexer_jobs(queue_name,status) WHERE status<>'done';
CREATE INDEX IF NOT EXISTS indexed_trades_window ON indexed_trades(pool,block_time,slot);
