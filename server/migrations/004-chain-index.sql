CREATE TABLE IF NOT EXISTS indexed_launches (
  pool TEXT PRIMARY KEY,
  mint TEXT UNIQUE NOT NULL,
  creator TEXT NOT NULL,
  config TEXT NOT NULL,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  uri TEXT NOT NULL,
  decimals SMALLINT NOT NULL,
  status SMALLINT NOT NULL,
  raised NUMERIC(20,0) NOT NULL,
  target NUMERIC(20,0) NOT NULL,
  supply NUMERIC(20,0) NOT NULL,
  created BIGINT,
  updated BIGINT NOT NULL,
  slot BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS indexed_launches_created ON indexed_launches(created DESC, pool);
CREATE TABLE IF NOT EXISTS indexed_trades (
  signature TEXT NOT NULL,
  event_index TEXT NOT NULL,
  pool TEXT NOT NULL REFERENCES indexed_launches(pool),
  slot BIGINT NOT NULL,
  block_time BIGINT,
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  base_amount NUMERIC(20,0) NOT NULL,
  quote_amount NUMERIC(20,0) NOT NULL,
  fee_amount NUMERIC(20,0) NOT NULL,
  PRIMARY KEY(signature,event_index)
);
CREATE INDEX IF NOT EXISTS indexed_trades_pool_time ON indexed_trades(pool,block_time DESC,slot DESC);
