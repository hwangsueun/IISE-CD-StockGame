-- Pin the immutable artifact at first access; no effect on player cash/holdings.
CREATE TABLE IF NOT EXISTS quant_session_models (
  session_id UUID PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  artifact_sha256 TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
