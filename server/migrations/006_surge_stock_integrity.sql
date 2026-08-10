BEGIN;

-- 기능명세서의 급등주 거래 단위는 금액 직접 입력이 아니라 정수 수량이다.
-- 기존 데이터는 당시 invested_amount / buy_price로 수량을 복원한다.
ALTER TABLE surge_stocks
  ADD COLUMN quantity BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN purchased_at TIMESTAMP,
  ADD COLUMN resolved_at TIMESTAMP;

UPDATE surge_stocks
SET quantity = FLOOR(invested_amount / buy_price),
    purchased_at = created_at
WHERE invested_amount > 0 AND buy_price > 0;

UPDATE surge_stocks
SET resolved_at = created_at
WHERE resolved = TRUE;

ALTER TABLE surge_stocks
  ADD CONSTRAINT chk_surge_buy_price_positive CHECK (buy_price > 0),
  ADD CONSTRAINT chk_surge_quantity_nonnegative CHECK (quantity >= 0),
  ADD CONSTRAINT chk_surge_invested_nonnegative CHECK (invested_amount >= 0);

-- 한 세션에 미정산 이벤트성 종목이 둘 이상 생기면 다음 턴 정산 의미가 모호해진다.
CREATE UNIQUE INDEX uq_surge_one_unresolved_per_session
  ON surge_stocks(session_id)
  WHERE resolved = FALSE;

COMMIT;
