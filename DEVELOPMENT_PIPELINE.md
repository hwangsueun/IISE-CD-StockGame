# 동학개미 서바이벌 (ANT SURVIVAL) — 최종 개발 파이프라인

> 전체 개발의 단일 기준 문서. **스코프 = 캡스톤 중간보고서(풀스코프)**, **기술스택 = 레포 `TECH_STACK.md`/`ARCHITECTURE.md` 정의**. 데이터 → DB → 백엔드 → UI까지 한 곳에 통합한다.

---

## 1. 개요 & 스코프

실제 금융데이터 기반 턴제 투자 시뮬레이션 게임. 1년치 시장을 짧게 체험하며 부채를 상환하는 것이 목표.

| 항목 | 값 |
|---|---|
| 게임 기간 | **240턴**(1년, 주말 제외 거래일), 1턴=거래일 하루, **20턴=1개월** |
| 투자 자산 | **131개 — 주식 117 / 채권 4 / 코인 10** |
| 초기 현금 | 5,000만 원(변경 예정) |
| 부채(난이도) | 5,000만 / 1억 / 1억 5,000만 |
| 상태값 | 현금 · 총자산 · 부채 · **스트레스(0–100)** · **신뢰도(0–100)** |
| 뉴스 | 하루 최대 10건(스트레스 구간별 열람 제한) |
| 성공/실패 | 240턴 내 부채 전액 상환 / 미상환·신뢰도 0 |
| 마스킹 | 회사명 2단계 가명(별칭→정식→가상) |

---

## 2. 기술스택 (레포 정의 유지)

```
React + Vite (JS)  →  Express (Node.js, plain JS)  →  PostgreSQL (Docker)
```

| 레이어 | 기술 |
|---|---|
| 프론트 | React 19 · Vite · JavaScript(JSX) · CSS |
| 백엔드 | Express(Node) plain JS · MVC(routes/controllers/services) · REST · **Supabase 미사용(자체호스팅, pg 직접)** |
| DB | PostgreSQL 16 · Docker(`antsurvival`, 포트 5432) · API 포트 3001 |
| 파이프라인 | Python · GPT-4o(Batch API) · FnGuide DataGuide · CoinGecko · GDELT · 디시인사이드 |

---

## 3. 시스템 아키텍처

```
[데이터 파이프라인 (Python, 오프라인 배치)]
   드라이브 원천(주식·채권·코인·거시) + news_generator + 디시인사이드
        │  ETL (정제·가명 마스킹·적재)
        ▼
[PostgreSQL (Docker)]  ← 자산·시세·거시·뉴스·종토방·플레이어 테이블
        │  SQL (pg)
        ▼
[Express API (plain JS, MVC, :3001)]  routes → controllers → services
        │  REST / JSON
        ▼
[React + Vite 프론트]  (UI: UI_SCREENS.md 참조)
```

런타임(게임)과 데이터 적재(ETL)는 분리. 게임은 DB만 읽고 쓴다.

---

## 4. 데이터 파이프라인 (Python)

| 데이터 | 소스 | 비고 |
|---|---|---|
| 주식 시세 | FnGuide DataGuide (1980~2023 수정종가) | 종가+거래량+**수급(외국인·기관·개인)**+유동주식+시총 |
| 주식 재무/지표 | DataGuide | **반기별** 재무제표 + 가치평가/재무비율(index_total) |
| 채권 | DataGuide+크롤링 | 국고채=**수익률(rate)**→가격지수, 회사채=총수익지수 |
| 코인 | CoinGecko API | 일별 종가(**USD**)+시총+거래량, 시총 층화추출 |
| 거시지표 | 기준금리·USD/KRW·CPI·국채금리·WTI·금·경기선행지수 | |
| 뉴스 | news_generator (거시 pr05 / 개별 pr05d→pr06a, GPT-4o Batch) | 통합 news 테이블 |
| 종토방 | 디시인사이드 101갤 크롤링 → NPC 반응(pr_dci06) | 읽기 전용 |

적재 순서: assets → 타입별 시세 → 타입별 정보(재무/등급/시총) → 거시 → 뉴스(+태그) → 종토방 → **가명 마스킹 일괄**.
데이터 미완성 시 `seeds/import_news.js --stub`로 프론트 개발 진행.

---

## 5. DB 스키마 (최종 — 자산 타입별 분리, 전체 DDL)

> 실제 드라이브 데이터 확인 결과 **타입별 가격 구조가 근본적으로 다름**(주식=OHLCV+수급, 채권=수익률 시계열, 코인=USD 종가+시총). 그래서 **공통 마스터/시세 + 타입별 상세**로 분리한다. 아래 DDL은 PostgreSQL 16에서 실행 검증 완료(23테이블). 그대로 `server/migrations/001_init.sql`로 사용.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ===== 공통 =====
CREATE TABLE assets (
  asset_id    VARCHAR(20) PRIMARY KEY,            -- STOCK_005930 / BOND_KTB3Y / COIN_BTC
  asset_type  VARCHAR(10) NOT NULL CHECK (asset_type IN ('stock','bond','coin')),
  code        VARCHAR(20),
  name        VARCHAR(100) NOT NULL,
  masked_name VARCHAR(100),                       -- 게임 표시용 가상명
  sector      VARCHAR(50),
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',  -- KRW | USD(코인)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_assets_type ON assets(asset_type);

-- 거래/평가 공통 최소 시세 (매수·매도·총자산·포트폴리오가 타입 무관하게 사용)
CREATE TABLE asset_prices (
  asset_id    VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date  DATE NOT NULL,
  close_price NUMERIC NOT NULL,
  change_rate NUMERIC,
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  PRIMARY KEY (asset_id, trade_date)
);
CREATE INDEX idx_prices_date ON asset_prices(trade_date);

-- ===== 타입별 상세 시세 =====
CREATE TABLE stock_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  open_price NUMERIC, high_price NUMERIC, low_price NUMERIC, volume BIGINT,
  foreign_qty BIGINT, inst_qty BIGINT, indiv_qty BIGINT,   -- 외국인/기관/개인 수급
  shares_outstanding BIGINT, market_cap NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);
CREATE TABLE bond_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  yield_rate NUMERIC,        -- 수익률(%)
  price_index NUMERIC,       -- 수익률→가격지수 변환
  PRIMARY KEY (asset_id, trade_date)
);
CREATE TABLE coin_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  market_cap NUMERIC, volume_usd NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

-- ===== 타입별 정보 =====
CREATE TABLE stock_financials (   -- 반기별
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  fiscal_year INT NOT NULL, half SMALLINT NOT NULL CHECK (half IN (1,2)),
  revenue NUMERIC, operating_income NUMERIC, net_income NUMERIC,
  total_debt NUMERIC, cash_equivalents NUMERIC, inventory NUMERIC,
  PRIMARY KEY (asset_id, fiscal_year, half)
);
CREATE TABLE stock_valuation (    -- 반기별
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  fiscal_year INT NOT NULL, half SMALLINT NOT NULL CHECK (half IN (1,2)),
  revenue_growth NUMERIC, op_margin NUMERIC, net_margin NUMERIC, debt_ratio NUMERIC,
  per NUMERIC, pbr NUMERIC, psr NUMERIC, ev_ebitda NUMERIC,
  roe NUMERIC, roa NUMERIC, eps NUMERIC, bps NUMERIC, sps NUMERIC, market_cap NUMERIC,
  PRIMARY KEY (asset_id, fiscal_year, half)
);
CREATE TABLE bond_info (
  asset_id VARCHAR(20) PRIMARY KEY REFERENCES assets(asset_id),
  bond_type VARCHAR(20), credit_rating VARCHAR(10), maturity VARCHAR(10)
);
CREATE TABLE coin_info (
  asset_id VARCHAR(20) PRIMARY KEY REFERENCES assets(asset_id),
  symbol VARCHAR(20), market_cap_tier VARCHAR(20),
  listing_year INT, delisting_year INT, survived_to_2023 BOOLEAN
);

-- ===== 거시 =====
CREATE TABLE macro_indicators (indicator_code VARCHAR(30) PRIMARY KEY, display_name VARCHAR(50), unit VARCHAR(20));
CREATE TABLE macro_daily (
  indicator_code VARCHAR(30) NOT NULL REFERENCES macro_indicators(indicator_code),
  trade_date DATE NOT NULL, value NUMERIC, PRIMARY KEY (indicator_code, trade_date)
);

-- ===== 뉴스 =====
CREATE TABLE news (
  id SERIAL PRIMARY KEY, news_date DATE NOT NULL, news_type VARCHAR(30) NOT NULL,
  asset_id VARCHAR(20) REFERENCES assets(asset_id),
  headline VARCHAR(300) NOT NULL, body TEXT,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral')),
  event_family VARCHAR(50), is_masked BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_news_date  ON news(news_date);
CREATE INDEX idx_news_asset ON news(asset_id, news_date);
CREATE TABLE news_tags (
  news_id INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  tag_type VARCHAR(20), tag VARCHAR(50), PRIMARY KEY (news_id, tag_type, tag)
);

-- ===== 종토방 (읽기 전용) =====
CREATE TABLE community_posts (
  id SERIAL PRIMARY KEY, post_date DATE NOT NULL, asset_id VARCHAR(20) REFERENCES assets(asset_id),
  npc_nickname VARCHAR(50), title VARCHAR(300), body TEXT, recommend_count INT DEFAULT 0, sentiment VARCHAR(20)
);
CREATE INDEX idx_posts_asset_date ON community_posts(asset_id, post_date);
CREATE TABLE community_comments (
  id SERIAL PRIMARY KEY, post_id INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  npc_nickname VARCHAR(50), body TEXT NOT NULL, sentiment VARCHAR(20)
);

-- ===== 플레이어 =====
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'active',          -- active | success | failed
  difficulty VARCHAR(10), start_date DATE, current_turn INT DEFAULT 1,
  initial_cash INT DEFAULT 50000000, debt_initial INT NOT NULL,
  cash INT NOT NULL, debt INT NOT NULL,
  stress INT DEFAULT 0   CHECK (stress BETWEEN 0 AND 100),
  trust  INT DEFAULT 100 CHECK (trust  BETWEEN 0 AND 100), final_cash INT
);
CREATE TABLE game_turns (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL, trade_date DATE NOT NULL, PRIMARY KEY