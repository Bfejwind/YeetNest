ALTER TABLE indexer_jobs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
ALTER TABLE indexer_jobs ADD COLUMN IF NOT EXISTS enqueued_at bigint;
UPDATE indexer_jobs SET enqueued_at=updated WHERE enqueued_at IS NULL;
CREATE INDEX IF NOT EXISTS indexer_priority_claim ON indexer_jobs(queue_name,priority DESC,available_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS indexer_interest(mint text PRIMARY KEY, touched bigint NOT NULL);
CREATE TABLE IF NOT EXISTS rpc_budgets(scope text PRIMARY KEY,next_at bigint NOT NULL DEFAULT 0,cooldown_until bigint NOT NULL DEFAULT 0);
