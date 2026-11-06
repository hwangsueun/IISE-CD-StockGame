BEGIN;
-- Native business-report periods and receipt versions; annual reports can cover fewer than 12 months.
CREATE TABLE IF NOT EXISTS stock_financial_statements (
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  receipt_no VARCHAR(14) NOT NULL CHECK (receipt_no ~ '^[0-9]{14}$'),
  fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 1990 AND 2100),
  period_start DATE,
  period_end DATE NOT NULL,
  published_date DATE NOT NULL,
  available_date DATE NOT NULL,
  fs_div VARCHAR(3) NOT NULL CHECK (fs_div IN ('CFS', 'OFS')),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revenue NUMERIC,
  operating_income NUMERIC,
  net_income NUMERIC,
  total_assets NUMERIC,
  total_liabilities NUMERIC,
  total_equity NUMERIC,
  metric_labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_kind TEXT NOT NULL,
  source_sha256 VARCHAR(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_metadata JSONB NOT NULL,
  PRIMARY KEY (asset_id, receipt_no, fs_div, period_end),
  CHECK (period_start IS NULL OR period_start <= period_end),
  CHECK (period_end <= published_date),
  CHECK (available_date > published_date)
);
CREATE INDEX IF NOT EXISTS stock_financial_statements_available_idx
  ON stock_financial_statements(asset_id, available_date, period_end DESC);
CREATE TABLE IF NOT EXISTS stock_financial_imports (
  version TEXT PRIMARY KEY,
  sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
