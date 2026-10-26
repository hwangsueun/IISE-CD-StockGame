-- Immutable versions and completed practice reports; independent of player money/challenge prizes.
CREATE TABLE IF NOT EXISTS user_strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  request_key UUID NOT NULL,
  saved_turn INT NOT NULL,
  saved_date DATE NOT NULL,
  initial_cash NUMERIC NOT NULL CHECK(initial_cash > 0),
  config JSONB NOT NULL,
  model JSONB,
  source_hash TEXT NOT NULL,
  source_from DATE NOT NULL,
  quant_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_user_strategy_versions_session ON user_strategy_versions(session_id, created_at);
ALTER TABLE user_strategy_versions ADD COLUMN IF NOT EXISTS fee_bps NUMERIC NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS user_strategy_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_strategy_runs_session ON user_strategy_runs(session_id, created_at);
