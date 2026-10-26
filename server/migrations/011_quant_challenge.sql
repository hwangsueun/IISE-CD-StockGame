-- Optional participation; the prototype's existing sessions stay unenrolled.
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS quant_challenge_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS quant_challenges (
  session_id UUID PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  joined_turn INT NOT NULL CHECK (joined_turn BETWEEN 1 AND 240),
  first_month INT NOT NULL CHECK (first_month BETWEEN 1 AND 12),
  prize_base NUMERIC(20,0) NOT NULL CHECK (prize_base > 0),
  performance_factor DOUBLE PRECISION NOT NULL DEFAULT 1,
  reference_asset NUMERIC(20,0),
  invalid_period BOOLEAN NOT NULL DEFAULT FALSE,
  last_boundary INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quant_challenge_rounds (
  session_id UUID NOT NULL REFERENCES quant_challenges(session_id) ON DELETE CASCADE,
  month_index INT NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  end_turn INT NOT NULL CHECK (end_turn = month_index * 20),
  player_return DOUBLE PRECISION,
  quant_return DOUBLE PRECISION,
  excess_return DOUBLE PRECISION,
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'tie', 'unavailable')),
  reason TEXT,
  prize NUMERIC(20,0) NOT NULL CHECK (prize >= 0),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, month_index)
);
