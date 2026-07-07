-- =====================================================================
-- ANT SURVIVAL - 초기 스키마 (ARCHITECTURE.md §7 기준)
-- 빈 PostgreSQL 16에서 재실행 가능해야 한다.
-- 뉴스 스키마는 data-pipeline/NEWS_DATA_CONTRACT.md(확정 계약)와 1:1 정합.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 자산 마스터
-- ---------------------------------------------------------------------
CREATE TABLE assets (
  asset_id    VARCHAR(30) PRIMARY KEY,          -- STOCK_005930 / BOND_KTB3Y / COIN_BITCOIN
  asset_type  VARCHAR(10) NOT NULL CHECK (asset_type IN ('stock','bond','coin')),
  code        VARCHAR(30),                      -- 종목코드(6자리, 앞 0 보존) / 채권 시리즈 / coingecko id
  name        VARCHAR(100) NOT NULL,            -- 원 이름(내부용, 게임 응답 노출 금지)
  masked_name VARCHAR(100),                     -- 게임 표시명 (마스킹 후)
  sector      VARCHAR(50),                      -- FICS 섹터 (주식)
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_assets_type ON assets(asset_type);
CREATE INDEX idx_assets_code ON assets(code);

-- ---------------------------------------------------------------------
-- 2. 공통 시세: 거래/평가/차트의 단일 기준
--    코인 USD 시세는 ETL에서 환율(usdkrw) 적용 후 KRW close_price로 적재
-- ---------------------------------------------------------------------
CREATE TABLE asset_prices (
  asset_id    VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  trade_date  DATE NOT NULL,
  close_price NUMERIC NOT NULL,
  change_rate NUMERIC,                          -- 전일 대비 등락률 (소수, 0.012 = +1.2%)
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  PRIMARY KEY (asset_id, trade_date)
);
CREATE INDEX idx_prices_date ON asset_prices(trade_date);

-- ---------------------------------------------------------------------
-- 3. 타입별 상세 시세
-- ---------------------------------------------------------------------
-- 원천: data-pipeline/data/raw/stock/stock_price-volume_npq.xlsx (DataGuide)
CREATE TABLE stock_price_detail (
  asset_id   VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  open_price NUMERIC,
  high_price NUMERIC,
  low_price  NUMERIC,
  volume     BIGINT,
  foreign_net_qty BIGINT,                       -- 외국인 순매수 수량 (npq 시트)
  inst_net_qty    BIGINT,                       -- 기관 순매수 수량
  indiv_net_qty   BIGINT,                       -- 개인 순매수 수량
  shares_outstanding BIGINT,
  market_cap NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

-- 원천: data-pipeline/bond_universe/data/kr_treasury_yields_long.csv (date,series,yield_pct)
-- price_index: 수익률 -> 가격지수 변환값(ETL 계산). 게임 거래가격은 asset_prices에 적재.
CREATE TABLE bond_price_detail (
  asset_id   VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  yield_rate NUMERIC,
  price_index NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

-- 원천: data-pipeline/crypto_universe/data/processed/coin_history_selected.csv
--       (date,coin_id,price,market_cap,total_volume) - USD 원천값 보존
CREATE TABLE coin_price_detail (
  asset_id   VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  price_usd  NUMERIC,
  market_cap_usd NUMERIC,
  volume_usd NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

-- ---------------------------------------------------------------------
-- 4. 타입별 정보 (종목 상세 화면 정보 탭)
-- ---------------------------------------------------------------------
CREATE TABLE stock_financials (
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  fiscal_year INT NOT NULL,
  half SMALLINT NOT NULL CHECK (half IN (1,2)),
  revenue NUMERIC,
  operating_income NUMERIC,
  net_income NUMERIC,
  total_debt NUMERIC,
  cash_equivalents NUMERIC,
  inventory NUMERIC,
  PRIMARY KEY (asset_id, fiscal_year, half)
);

CREATE TABLE stock_valuation (
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  fiscal_year INT NOT NULL,
  half SMALLINT NOT NULL CHECK (half IN (1,2)),
  revenue_growth NUMERIC,
  op_margin NUMERIC,
  net_margin NUMERIC,
  debt_ratio NUMERIC,
  per NUMERIC,
  pbr NUMERIC,
  psr NUMERIC,
  ev_ebitda NUMERIC,
  roe NUMERIC,
  roa NUMERIC,
  eps NUMERIC,
  bps NUMERIC,
  sps NUMERIC,
  market_cap NUMERIC,
  PRIMARY KEY (asset_id, fiscal_year, half)
);

CREATE TABLE bond_info (
  asset_id VARCHAR(30) PRIMARY KEY REFERENCES assets(asset_id),
  bond_type VARCHAR(20),
  credit_rating VARCHAR(10),
  maturity VARCHAR(10)
);

-- 원천: crypto_universe/data/processed/coin_universe_selected.csv + coin_listing_metadata.csv
CREATE TABLE coin_info (
  asset_id VARCHAR(30) PRIMARY KEY REFERENCES assets(asset_id),
  symbol VARCHAR(20),
  market_cap_tier VARCHAR(20),
  first_observed_date DATE,
  last_observed_date DATE,
  max_market_cap NUMERIC,
  survived_to_2023 BOOLEAN
);

-- ---------------------------------------------------------------------
-- 5. 거시지표
--    원천: market_indicator/data/processed/macro_context_daily.csv (wide)
--    ETL이 wide -> long 변환하여 적재. indicator_code = CSV 컬럼명.
-- ---------------------------------------------------------------------
CREATE TABLE macro_indicators (
  indicator_code VARCHAR(50) PRIMARY KEY,
  display_name VARCHAR(80),
  unit VARCHAR(20),
  display_order INT,                            -- 마켓 모달 지표 탭 표시 순서 (NULL=비표시)
  is_game_visible BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE macro_daily (
  indicator_code VARCHAR(50) NOT NULL REFERENCES macro_indicators(indicator_code),
  trade_date DATE NOT NULL,
  value NUMERIC,
  PRIMARY KEY (indicator_code, trade_date)
);

-- ---------------------------------------------------------------------
-- 6. 뉴스 - NEWS_DATA_CONTRACT.md 4개 파일 통합 테이블
--    market_news / stock_news / annual_earnings_news / split_articles
--    news_id: 계약서의 news_id(또는 split_articles의 article_id)를 그대로 사용
--    news_lines: 완성형 기사 문장 배열(JSONB). 게임 화면에 그대로 출력.
--    턴 배치는 반드시 game_publish_date 기준 (계약 §5).
-- ---------------------------------------------------------------------
CREATE TABLE news (
  news_id VARCHAR(120) PRIMARY KEY,
  category VARCHAR(30) NOT NULL CHECK (category IN (
    'market_sector','market_macro','stock_disclosure','annual_earnings','split_article'
  )),
  publish_date DATE NOT NULL,                   -- 원본 사건 발생일
  game_publish_date DATE NOT NULL,              -- 게임 노출일 (거래일 보정 완료값)
  news_lines JSONB NOT NULL,                    -- string[]
  -- 공통 성격 필드
  event_type VARCHAR(40),                       -- sector_leader, rate_move, fx_move ...
  direction VARCHAR(10) CHECK (direction IN ('positive','negative','neutral')),
  strength SMALLINT,                            -- 4|5 (거시), 클수록 강함
  -- market_sector 전용
  market VARCHAR(10),                           -- KOSPI | KOSDAQ
  sector VARCHAR(50),
  -- market_macro 전용: 계약서 asset_id 필드(지표명 문자열, 예: '원/달러 환율')
  macro_asset_label VARCHAR(60),
  -- 개별종목 계열 (stock_disclosure / annual_earnings / split_article)
  stock_code VARCHAR(6),
  asset_id VARCHAR(30) REFERENCES assets(asset_id),  -- ETL이 stock_code로 매칭 (미매칭 NULL)
  event_family VARCHAR(30),                     -- earnings, contract, dividend, investment, asset_transaction
  claim_level VARCHAR(40),                      -- no_market_claim | market_reaction_adjacency
  news_type VARCHAR(40),                        -- corporate_action_disclosure 등
  bundle_id VARCHAR(80),
  -- annual_earnings 전용
  business_year INT,
  date_basis VARCHAR(15),                       -- filing | disclosure | estimated
  fs_div VARCHAR(10),                           -- 연결 | 별도 | ''
  -- split_article 전용
  article_type VARCHAR(30),                     -- disclosure | market_reaction_followup
  source_custom_id VARCHAR(80),                 -- 1·2부 쌍 묶기
  source_rcept_no VARCHAR(20),
  material_reason VARCHAR(40),
  is_masked BOOLEAN NOT NULL DEFAULT FALSE      -- 마스킹 ETL 완료 여부
);
CREATE INDEX idx_news_game_date ON news(game_publish_date);
CREATE INDEX idx_news_category_date ON news(category, game_publish_date);
CREATE INDEX idx_news_asset_date ON news(asset_id, game_publish_date);
CREATE INDEX idx_news_stockcode_date ON news(stock_code, game_publish_date);
CREATE INDEX idx_news_pair ON news(source_custom_id);

CREATE TABLE news_tags (
  news_id VARCHAR(120) NOT NULL REFERENCES news(news_id) ON DELETE CASCADE,
  tag_type VARCHAR(20) NOT NULL CHECK (tag_type IN ('asset','sector','category','importance')),
  tag VARCHAR(50) NOT NULL,
  PRIMARY KEY (news_id, tag_type, tag)
);

-- ---------------------------------------------------------------------
-- 7. 종토방 (읽기 전용 NPC 데이터)
--    원천: npc_generator/data/processed/dci_posts_ready.csv / dci_comments_ready.csv
--    gall_id -> asset_id 매핑은 ETL의 갤러리-종목 매핑표로 해소
-- ---------------------------------------------------------------------
CREATE TABLE community_posts (
  id SERIAL PRIMARY KEY,
  source_post_id VARCHAR(40),                   -- 원본 post_id (추적용)
  gall_id VARCHAR(50),
  post_date DATE NOT NULL,
  asset_id VARCHAR(30) REFERENCES assets(asset_id),
  npc_nickname VARCHAR(80),
  title VARCHAR(300),
  body TEXT,
  view_count INT DEFAULT 0,
  recommend_count INT DEFAULT 0,
  dislike_count INT DEFAULT 0,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral'))
);
CREATE INDEX idx_posts_asset_date ON community_posts(asset_id, post_date);
CREATE INDEX idx_posts_date ON community_posts(post_date);

CREATE TABLE community_comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  npc_nickname VARCHAR(80),
  body TEXT NOT NULL,
  comment_date DATE,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral'))
);
CREATE INDEX idx_comments_post ON community_comments(post_id);

-- ---------------------------------------------------------------------
-- 8. 게임 세션 / 진행
-- ---------------------------------------------------------------------
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','success','failed')),
  difficulty VARCHAR(10) CHECK (difficulty IN ('easy','normal','hard')),
  start_date DATE,
  current_turn INT NOT NULL DEFAULT 1 CHECK (current_turn BETWEEN 1 AND 240),
  action_locked_until_turn INT NOT NULL DEFAULT 0,   -- 기절/입원 행동제한 (이 턴까지 거래 불가)
  initial_cash BIGINT NOT NULL DEFAULT 50000000,
  debt_initial BIGINT NOT NULL,
  cash BIGINT NOT NULL,
  debt BIGINT NOT NULL,
  stress INT NOT NULL DEFAULT 0 CHECK (stress BETWEEN 0 AND 100),
  trust INT NOT NULL DEFAULT 100 CHECK (trust BETWEEN 0 AND 100),
  monthly_living_cost BIGINT,                   -- 이번 달 생활비 (월초 설정, 기획서 §7)
  final_total_asset BIGINT
);

CREATE TABLE game_turns (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 240),
  trade_date DATE NOT NULL,
  PRIMARY KEY (session_id, turn_number),
  UNIQUE (session_id, trade_date)
);
CREATE INDEX idx_game_turns_date ON game_turns(trade_date);

CREATE TABLE holdings (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),   -- 코인 소수수량 허용, 주식/채권 정수검증은 서비스 레이어
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (session_id, asset_id)
);

CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 240),
  asset_id VARCHAR(30) NOT NULL REFERENCES assets(asset_id),
  trade_type VARCHAR(4) NOT NULL CHECK (trade_type IN ('buy','sell')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  realized_pnl NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_trades_session_turn ON trades(session_id, turn_number);

-- ---------------------------------------------------------------------
-- 9. 상태/기록 (상환, 이벤트, 메모, 뉴스 노출, 월간 스냅샷)
-- ---------------------------------------------------------------------
CREATE TABLE repayments (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  month_index INT NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  due_amount BIGINT NOT NULL,
  paid_amount BIGINT NOT NULL,
  ratio NUMERIC,                                -- paid/due
  trust_delta INT,
  stress_delta INT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (session_id, month_index)
);

CREATE TABLE event_log (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 240),
  event_type VARCHAR(30) NOT NULL,              -- eventEngine EVENT_DEFS 키
  detail JSONB,                                 -- 이벤트별 세부값 (선택지, 결과 등)
  cash_delta BIGINT DEFAULT 0,
  stress_delta INT DEFAULT 0,
  trust_delta INT DEFAULT 0,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,      -- 선택형 이벤트: 플레이어 선택 완료 여부
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_event_log_session_turn ON event_log(session_id, turn_number);

CREATE TABLE memos (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_date DATE NOT NULL,
  content VARCHAR(100),
  UNIQUE (session_id, game_date)
);

CREATE TABLE news_exposure (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_date DATE NOT NULL,
  news_id VARCHAR(120) NOT NULL REFERENCES news(news_id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, game_date, news_id)
);

-- 월간 리포트/주간 평가 계산 결과 스냅샷 (reportService가 기록)
CREATE TABLE session_snapshots (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL,
  snapshot_type VARCHAR(15) NOT NULL CHECK (snapshot_type IN ('daily','weekly','monthly','final')),
  total_asset BIGINT,
  cash BIGINT,
  debt BIGINT,
  stress INT,
  trust INT,
  detail JSONB,                                 -- 자산군 비중, 수익률, LLM 평가문 등
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (session_id, turn_number, snapshot_type)
);

-- =====================================================================
-- 기본 시드: 채권 4종 + 거시지표 코드북
-- 주식 117개 / 코인 10개 / 시세 / 뉴스 / 종토방은 seeds/import_all.js가 적재
-- =====================================================================
INSERT INTO assets (asset_id, asset_type, code, name, masked_name, currency) VALUES
  ('BOND_KTB3Y','bond','KTB_3Y','국고채 3년','국채 단기','KRW'),
  ('BOND_KTB10Y','bond','KTB_10Y','국고채 10년','국채 장기','KRW'),
  ('BOND_CORPAA','bond','CORP_AA_MINUS_3Y','회사채 AA-','우량 회사채','KRW'),
  ('BOND_CORPBBB','bond','CORP_BBB_MINUS_3Y','회사채 BBB-','투기 회사채','KRW');

INSERT INTO bond_info VALUES
  ('BOND_KTB3Y','국고채',NULL,'3Y'),
  ('BOND_KTB10Y','국고채',NULL,'10Y'),
  ('BOND_CORPAA','회사채','AA-','3Y'),
  ('BOND_CORPBBB','회사채','BBB-','3Y');

-- indicator_code는 macro_context_daily.csv의 컬럼명과 동일해야 한다 (import_macro.js 참조)
INSERT INTO macro_indicators (indicator_code, display_name, unit, display_order, is_game_visible) VALUES
  ('kospi','KOSPI','지수',1,TRUE),
  ('kosdaq','KOSDAQ','지수',2,TRUE),
  ('kr_policy_rate','기준금리','%',3,TRUE),
  ('usdkrw','USD/KRW 환율','원',4,TRUE),
  ('cpi','소비자물가지수','지수',5,TRUE),
  ('ktb_3y_rate','국고채 3년 금리','%',6,TRUE),
  ('ktb_10y_rate','국고채 10년 금리','%',7,TRUE),
  ('wti_price','WTI 유가','USD',8,TRUE),
  ('gold_price','금 가격','USD',9,TRUE),
  ('leading_index','경기선행지수','지수',10,TRUE),
  ('nasdaq','NASDAQ','지수',NULL,FALSE),
  ('sp500','S&P500','지수',NULL,FALSE),
  ('us_policy_rate','미국 기준금리','%',NULL,FALSE),
  ('ktb_5y_rate','국고채 5년 금리','%',NULL,FALSE),
  ('corp_aa_minus_3y_rate','회사채 AA- 3년 금리','%',NULL,FALSE),
  ('corp_bbb_minus_3y_rate','회사채 BBB- 3년 금리','%',NULL,FALSE),
  ('cd_91d_rate','CD 91일 금리','%',NULL,FALSE),
  ('corp_aa_minus_spread','회사채 AA- 스프레드','%p',NULL,FALSE),
  ('corp_bbb_minus_spread','회사채 BBB- 스프레드','%p',NULL,FALSE),
  ('ktb_10y_3y_spread','국고채 장단기 스프레드','%p',NULL,FALSE),
  ('us_treasury_2y_rate','미국채 2년 금리','%',NULL,FALSE),
  ('us_treasury_5y_rate','미국채 5년 금리','%',NULL,FALSE),
  ('us_treasury_10y_rate','미국채 10년 금리','%',NULL,FALSE),
  ('us_treasury_30y_rate','미국채 30년 금리','%',NULL,FALSE),
  ('us_10y_2y_spread','미국채 10-2년 스프레드','%p',NULL,FALSE),
  ('us_30y_2y_spread','미국채 30-2년 스프레드','%p',NULL,FALSE),
  ('export_amount_usd_thousand','수출액','천USD',NULL,FALSE),
  ('import_amount_usd_thousand','수입액','천USD',NULL,FALSE),
  ('trade_balance_usd_thousand','무역수지','천USD',NULL,FALSE),
  ('industrial_production_index','산업생산지수','지수',NULL,FALSE),
  ('mining_manufacturing_production_index','광공업생산지수','지수',NULL,FALSE),
  ('retail_sales_index','소매판매지수','지수',NULL,FALSE),
  ('facility_investment_index','설비투자지수','지수',NULL,FALSE),
  ('dubai_oil_price','Dubai 유가','USD',NULL,FALSE);
