CREATE TABLE IF NOT EXISTS community_follows (
  wallet TEXT NOT NULL,
  following TEXT NOT NULL,
  created BIGINT NOT NULL,
  PRIMARY KEY(wallet,following),
  CHECK(wallet<>following)
);
CREATE INDEX IF NOT EXISTS community_follows_target ON community_follows(following,created DESC,wallet);
