CREATE TABLE IF NOT EXISTS catalogue_coins (
  mint TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS catalogue_coins_page ON catalogue_coins(created DESC,mint);
CREATE INDEX IF NOT EXISTS catalogue_creator ON catalogue_coins(creator,created DESC);
CREATE TABLE IF NOT EXISTS upload_references (
  wallet TEXT NOT NULL,
  uri TEXT NOT NULL,
  expires BIGINT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY(wallet,uri)
);
CREATE TABLE IF NOT EXISTS wallet_watchlists (wallet TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS watchlist_items (
  wallet TEXT REFERENCES wallet_watchlists(wallet) ON DELETE CASCADE,
  mint TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(wallet,mint)
);
INSERT INTO catalogue_coins(mint,creator,created,updated,data)
SELECT c->>'mint',c->>'creator',COALESCE((c->>'created')::bigint,0),0,c
FROM app_records CROSS JOIN LATERAL jsonb_array_elements(value) c WHERE key='coins'
ON CONFLICT(mint) DO NOTHING;
INSERT INTO upload_references(wallet,uri,expires,data)
SELECT item->1->>'wallet',item->1->>'uri',(item->1->>'expires')::bigint,item->1
FROM app_records CROSS JOIN LATERAL jsonb_array_elements(value) item WHERE key='upload-references'
ON CONFLICT(wallet,uri) DO NOTHING;
INSERT INTO wallet_watchlists(wallet) SELECT substring(key FROM 11) FROM app_records WHERE key LIKE 'watchlist:%' ON CONFLICT DO NOTHING;
INSERT INTO watchlist_items(wallet,mint,position)
SELECT substring(key FROM 11),item #>> '{}',ordinality::integer FROM app_records
CROSS JOIN LATERAL jsonb_array_elements(value) WITH ORDINALITY AS entries(item,ordinality)
WHERE key LIKE 'watchlist:%' ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS indexed_launches_keyset ON indexed_launches(COALESCE(created,0) DESC,pool);
