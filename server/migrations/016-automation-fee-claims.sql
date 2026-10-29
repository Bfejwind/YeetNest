CREATE TABLE automation_fee_claims (
  day TEXT NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  wallet TEXT NOT NULL,
  data JSONB NOT NULL,
  updated BIGINT NOT NULL,
  PRIMARY KEY(day,wallet)
);
