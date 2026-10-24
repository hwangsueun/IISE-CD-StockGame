BEGIN;

-- Preserve already-finalized awards and the actual basis used for each one.
ALTER TABLE quant_challenge_rounds ADD COLUMN IF NOT EXISTS prize_base NUMERIC(20,0);
UPDATE quant_challenge_rounds r SET prize_base = c.prize_base
  FROM quant_challenges c WHERE c.session_id = r.session_id AND r.prize_base IS NULL;
ALTER TABLE quant_challenge_rounds ALTER COLUMN prize_base SET NOT NULL;
ALTER TABLE quant_challenge_rounds DROP CONSTRAINT IF EXISTS quant_challenge_rounds_prize_base_check;
ALTER TABLE quant_challenge_rounds ADD CONSTRAINT quant_challenge_rounds_prize_base_check CHECK (prize_base >= 0);

-- Waiting entrants have no opening capital until their first comparison period.
ALTER TABLE quant_challenges ALTER COLUMN prize_base DROP NOT NULL;
ALTER TABLE quant_challenges DROP CONSTRAINT IF EXISTS quant_challenges_prize_base_check;
ALTER TABLE quant_challenges ADD CONSTRAINT quant_challenges_prize_base_check CHECK (prize_base >= 0);

COMMIT;
