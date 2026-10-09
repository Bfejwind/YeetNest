CREATE TABLE IF NOT EXISTS market_events (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS market_events_created ON market_events(created);
