CREATE INDEX IF NOT EXISTS community_reports_history
ON community_reports (moderated_at DESC,post_id,wallet)
WHERE status<>'pending';
