-- =====================================================================
-- 004: assets.code 확장 (2026-07-20)
--
-- 실데이터 적재 테스트에서 발견: coin_universe_selected.csv의 coingecko id가
-- 최대 44자다(예: alethea-artificial-liquid-intelligence-token). assets.code는
-- 원본 식별자를 그대로 보관하는 컬럼인데 VARCHAR(30)이라 7개 코인에서
-- "value too long for type character varying(30)"로 적재가 중단됐다.
--
-- 스텁 데이터는 짧은 합성 id만 써서 이 한계가 드러나지 않았다.
--
-- asset_id(PK)는 VARCHAR(30)을 유지한다 - import_coins의 toAssetId가 30자로 자르지만
-- 현재 유니버스 1,267개에서 충돌이 0건임을 확인했고, PK를 넓히면 이를 참조하는
-- 10개 이상 테이블의 FK 컬럼을 전부 함께 바꿔야 해 변경 범위가 과도하다.
-- 대신 import_coins에 절단 충돌 가드를 넣어 조용한 덮어쓰기를 막는다.
-- =====================================================================

BEGIN;

ALTER TABLE assets ALTER COLUMN code TYPE VARCHAR(64);

COMMENT ON COLUMN assets.code IS
  '원본 식별자. 주식=6자리 종목코드, 채권=시리즈명, 코인=coingecko id(최대 44자)';

COMMIT;
