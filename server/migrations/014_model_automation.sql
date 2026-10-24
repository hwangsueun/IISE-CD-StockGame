CREATE TABLE IF NOT EXISTS user_strategy_automation (
  session_id UUID PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  version_id UUID REFERENCES user_strategy_versions(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  next_review_turn INT NOT NULL DEFAULT 1,
  last_turn INT,
  last_result JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS strategy_version_id UUID
  REFERENCES user_strategy_versions(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS user_strategy_automation_log (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  version_id UUID REFERENCES user_strategy_versions(id) ON DELETE SET NULL,
  turn_number INT NOT NULL,
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id,turn_number)
);
