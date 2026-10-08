-- Decisions are made after the close; fills occur at a later market open.
CREATE TABLE IF NOT EXISTS market_orders (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  owner TEXT NOT NULL CHECK (owner IN ('player','quant')),
  order_key TEXT NOT NULL,
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  decision_turn INT NOT NULL,
  decision_date DATE NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  reference_price NUMERIC NOT NULL CHECK (reference_price > 0),
  cash_budget NUMERIC NOT NULL DEFAULT 0 CHECK (cash_budget >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filled','partial','cancelled','rejected')),
  execution_turn INT,
  execution_date DATE,
  filled_quantity NUMERIC NOT NULL DEFAULT 0,
  execution_price NUMERIC,
  amount NUMERIC,
  realized_pnl NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, owner, order_key)
);
CREATE INDEX IF NOT EXISTS idx_market_orders_pending ON market_orders(session_id,owner,status);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_id BIGINT UNIQUE REFERENCES market_orders(id);
