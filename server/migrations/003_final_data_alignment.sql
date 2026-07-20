-- =====================================================================
-- 003: 최종 데이터 구조 정합 (2026-07-20)
--
-- 배경: 001/002는 2026-07-07 기준 인벤토리(ARCHITECTURE.md §6-0)로 설계됐다.
--       이후 data-pipeline의 종토방 산출물이 "평면 CSV(dci_posts_ready.csv)"에서
--       "스레드 JSONL(board_threads_validated_final_screened.jsonl)"로 재설계됐고,
--       코인 종토방(607스레드)이 추가되면서 종토방이 주식 전용이 아니게 됐다.
--
-- 이 마이그레이션이 반영하는 확정 변경:
--   1) 종토방 = 스레드 단위. gall_id 매핑 추정이 아니라 target_id 직접 매핑.
--   2) 자산 공통 상장기간(listed_from/listed_to) 승격 — 코인 상장폐지 강제청산의 단일 기준.
--   3) 마스킹 원문 보존 컬럼 — 게임 응답은 가명, 감사·재처리는 원문.
--   4) 강제청산 거래 구분자.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 자산: 상장기간 + 마스킹 상태
--
-- 기존에는 "시세가 있으면 거래 가능"이라는 암묵 규칙을 pricingService.getPriceAt의
-- NULL 반환으로만 표현했다. 코인 10종 중 일부가 2023년 이전에 데이터가 끊기므로
-- (coin_info.last_observed_date), 상장기간을 자산 공통 컬럼으로 승격해
-- 거래 차단 / 강제청산 / 종목목록 노출이 전부 같은 기준을 보게 한다.
-- 타입별 분기(coin_info 조인) 없이 assets만 보면 되도록 하는 것이 목적이다.
-- ---------------------------------------------------------------------
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS listed_from DATE,     -- 최초 시세일 (이전 턴에는 목록 미노출)
  ADD COLUMN IF NOT EXISTS listed_to   DATE,     -- 최종 시세일 (다음 턴에 강제청산 대상)
  ADD COLUMN IF NOT EXISTS is_masked   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN assets.listed_from IS '최초 시세 존재일. 이 날짜 이전 턴에는 매수 불가/목록 미노출';
COMMENT ON COLUMN assets.listed_to   IS '최종 시세 존재일. 경과 시 다음 턴에 마지막 종가로 강제청산';
COMMENT ON COLUMN assets.is_masked   IS 'masked_name 확정 및 본문 치환 완료 여부';

CREATE INDEX IF NOT EXISTS idx_assets_listing ON assets(listed_from, listed_to);

-- ---------------------------------------------------------------------
-- 2. 뉴스: 마스킹 원문 보존
--
-- news_lines는 게임에 그대로 출력되는 완성형 문장이라 마스킹 후 값을 덮어쓴다.
-- 사전이 갱신되면 재치환해야 하므로 원문을 별도 보존한다.
-- ---------------------------------------------------------------------
ALTER TABLE news
  ADD COLUMN IF NOT EXISTS raw_news_lines JSONB;  -- 마스킹 전 원문 (감사/재처리용)

COMMENT ON COLUMN news.raw_news_lines IS '마스킹 전 원문 news_lines. 게임 응답에 절대 노출 금지';

-- ---------------------------------------------------------------------
-- 3. 종토방: 평면 CSV -> 스레드 JSONL 구조
--
-- 최종 산출: npc_generator/data/processed/dci_board_rewritten/
--            board_threads_validated_final_screened.jsonl (2,502 스레드)
--            = 혐오발언 스크리닝 + 봇 제거 + 닉네임 재부여 완료본
--
-- 구조 변경 요지:
--   - 1 스레드 = 게시글 1건 + 댓글 N건. thread_uid가 자연키.
--   - target_kind(stock|coin) + target_id로 asset_id를 직접 매핑한다.
--     -> 001의 GALL_TO_STOCK_CODE 추정 매핑 TODO는 이 컬럼으로 해소된다.
--   - view_count/dislike_count는 재작성 산출물에 존재하지 않는다.
--     DEFAULT 0을 유지하면 "조회수 0"이라는 거짓 데이터가 되므로 DEFAULT를 제거해
--     미측정(NULL)과 실제 0을 구분한다.
--   - 작성자는 nickname_map(author_key -> 닉네임)으로 스레드 내에서만 유효하다.
--     동일 author_key라도 스레드가 다르면 다른 인물이므로 전역 식별자로 쓰면 안 된다.
-- ---------------------------------------------------------------------
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS thread_uid     VARCHAR(120),  -- board_rw__EVT_000001__economy__150334
  ADD COLUMN IF NOT EXISTS candidate_id   VARCHAR(30),   -- EVT_000001
  ADD COLUMN IF NOT EXISTS target_kind    VARCHAR(10),   -- stock | coin
  ADD COLUMN IF NOT EXISTS target_id      VARCHAR(30),   -- 6자리 종목코드 | coingecko id
  ADD COLUMN IF NOT EXISTS candidate_type VARCHAR(40),   -- community_reaction_only | rumor_or_speculation | market_reaction_news | factual_news_needed
  ADD COLUMN IF NOT EXISTS author_key     VARCHAR(10),   -- u1 (스레드 내부 한정 식별자)
  ADD COLUMN IF NOT EXISTS posted_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS raw_title      VARCHAR(300),  -- 마스킹 전 원문
  ADD COLUMN IF NOT EXISTS raw_body       TEXT;          -- 마스킹 전 원문

ALTER TABLE community_posts
  ADD CONSTRAINT community_posts_target_kind_chk
  CHECK (target_kind IS NULL OR target_kind IN ('stock', 'coin'));

-- 재작성 산출물에 없는 지표: 0이 아니라 NULL이어야 한다
ALTER TABLE community_posts ALTER COLUMN view_count      DROP DEFAULT;
ALTER TABLE community_posts ALTER COLUMN recommend_count DROP DEFAULT;
ALTER TABLE community_posts ALTER COLUMN dislike_count   DROP DEFAULT;

COMMENT ON COLUMN community_posts.thread_uid  IS 'JSONL 자연키. 재적재 멱등성 보장';
COMMENT ON COLUMN community_posts.author_key  IS '스레드 내부 한정 식별자. 전역 인물 동일성 없음';
COMMENT ON COLUMN community_posts.view_count  IS 'NULL = 재작성 산출물이라 미측정 (0과 구분)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_thread_uid ON community_posts(thread_uid);
CREATE INDEX IF NOT EXISTS idx_posts_target ON community_posts(target_kind, target_id, post_date);

-- 댓글: 스레드 내 순서와 시각 보존
ALTER TABLE community_comments
  ADD COLUMN IF NOT EXISTS seq          INT,           -- 스레드 내 표시 순서 (0-based)
  ADD COLUMN IF NOT EXISTS author_key   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS commented_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS raw_body     TEXT;

COMMENT ON COLUMN community_comments.seq IS 'JSONL comments 배열 인덱스. 정렬 기준';

CREATE INDEX IF NOT EXISTS idx_comments_post_seq ON community_comments(post_id, seq);

-- ---------------------------------------------------------------------
-- 4. 강제청산 거래 구분
--
-- 코인 상장폐지 청산은 trades에 'sell'로 남겨야 실현손익 집계에 자연히 포함된다.
-- 다만 리포트에서 "플레이어 판단"과 "시스템 청산"을 구분해야 하므로 플래그를 둔다.
-- ---------------------------------------------------------------------
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS is_forced BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN trades.is_forced IS 'TRUE = 시스템 강제청산(상장폐지 등). 플레이어 주문 아님';

COMMIT;
