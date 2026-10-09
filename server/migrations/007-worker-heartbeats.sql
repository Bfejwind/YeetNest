CREATE TABLE IF NOT EXISTS indexer_workers (
  id UUID PRIMARY KEY,
  queue_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('all','scan','process')),
  updated BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS indexer_workers_active ON indexer_workers(queue_name,updated);
CREATE INDEX IF NOT EXISTS indexer_jobs_retention ON indexer_jobs(queue_name,updated) WHERE status='done';
