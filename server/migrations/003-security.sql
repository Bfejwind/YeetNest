CREATE TABLE IF NOT EXISTS security_records (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS security_records_expiry ON security_records(expires);
