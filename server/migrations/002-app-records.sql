CREATE TABLE IF NOT EXISTS app_records (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(value) = 'array')
);
