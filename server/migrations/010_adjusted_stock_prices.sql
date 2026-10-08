-- Historical game prices and model inputs share one versioned adjustment basis.
ALTER TABLE stock_price_detail ADD COLUMN IF NOT EXISTS adjustment_factor NUMERIC;
ALTER TABLE stock_price_detail ADD COLUMN IF NOT EXISTS adjusted_volume NUMERIC;
CREATE TABLE IF NOT EXISTS market_data_versions (
  version TEXT PRIMARY KEY,
  price_basis TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_market_data_version
  ON market_data_versions(active) WHERE active;
