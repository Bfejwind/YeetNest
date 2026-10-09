ALTER TABLE indexed_launches ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'raydium';
ALTER TABLE indexed_launches ADD COLUMN IF NOT EXISTS progress NUMERIC;
CREATE INDEX IF NOT EXISTS indexed_launches_protocol_created ON indexed_launches(protocol,COALESCE(created,0) DESC,pool);
