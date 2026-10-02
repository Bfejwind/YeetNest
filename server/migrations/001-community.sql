CREATE TABLE IF NOT EXISTS community_profiles (
  wallet TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 240),
  updated BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 500),
  created BIGINT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS community_posts_mint_time ON community_posts(mint, created DESC, id DESC) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS community_reports (
  post_id UUID REFERENCES community_posts(id),
  wallet TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
  created BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  PRIMARY KEY (post_id, wallet)
);
