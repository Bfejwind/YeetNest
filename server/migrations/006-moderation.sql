ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS moderated_by TEXT;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS moderated_at BIGINT;
CREATE INDEX IF NOT EXISTS community_reports_pending ON community_reports(created,post_id) WHERE status='pending';
