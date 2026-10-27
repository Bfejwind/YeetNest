-- Automation is a separate, explicitly enabled worker. Never store private keys here.
CREATE TABLE automation_days (
  day TEXT PRIMARY KEY CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  data JSONB NOT NULL,
  updated BIGINT NOT NULL
);
CREATE TABLE automation_metadata (
  creator TEXT NOT NULL,
  artwork TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (creator, artwork)
);
