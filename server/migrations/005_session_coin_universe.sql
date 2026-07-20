-- =====================================================================
-- 005: 세션별 코인 유니버스 (2026-07-20)
--
-- 배경: assets에는 코인 1,267개가 들어간다. 이건 "참조 유니버스"다 - 종토방/뉴스 본문이
-- 어떤 코인이든 언급할 수 있어야 하므로 마스터에는 전부 필요하다.
-- 반면 게임이 실제로 거래 대상으로 노출하는 코인은 **세션마다 새로 뽑는 20개**다
-- (시총 규모별 랜덤 층화추출). 플레이어가 새 게임을 시작할 때마다 다른 코인이 뜬다.
--
-- 그래서 assets.is_active(전역 플래그)로는 표현할 수 없다. 세션 단위 저장이 필요하다.
-- 이어하기(§8-0 /api/auth/me) 시 같은 20개가 복원돼야 하므로 추출 결과를 영속화한다
-- - 시드만 저장하고 매번 재계산하는 방식은 코인 유니버스 데이터가 갱신되면 같은 시드로도
--   다른 결과가 나와 이어하기가 깨진다.
--
-- 추출 규칙 (기획 확정):
--   후보  = 세션 240거래일 **전 기간에 걸쳐 시세가 존재**하는 코인
--           (listed_from <= 첫 거래일 AND listed_to >= 마지막 거래일)
--           + 시작 시점 가격 1원 이상 (원 단위 현금 체계에서 거래가 성립해야 함)
--   쿼터  = mega 3 / large 5 / mid 6 / small 6 = 20
--   미달  = 특정 티어가 쿼터에 못 미치면 남는 자리를 잔여 후보 풀에서 티어 무관 보충
--   부족  = 후보 총량이 20 미만이면 있는 만큼 전부 사용
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS session_coin_universe (
  session_id UUID        NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  asset_id   VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  tier       VARCHAR(10) NOT NULL,   -- 추출 당시 티어 (mega|large|mid|small)
  slot       SMALLINT,               -- 표시 순서 고정용 (0-based)
  PRIMARY KEY (session_id, asset_id)
);

COMMENT ON TABLE  session_coin_universe IS
  '세션 시작 시 층화추출된 거래 가능 코인 20종. 주식 117/채권 4는 전역이라 여기 없다';
COMMENT ON COLUMN session_coin_universe.tier IS
  '추출 시점 coin_info.market_cap_tier 스냅샷. 사후에 티어가 재계산돼도 추출 근거는 보존된다';

CREATE INDEX IF NOT EXISTS idx_session_coin_universe_session
  ON session_coin_universe(session_id);

COMMIT;
