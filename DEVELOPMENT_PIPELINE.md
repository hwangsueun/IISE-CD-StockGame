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
  turn_number INT NOT NULL, trade_date DATE NOT NULL, PRIMARY KEY (session_id, turn_number)
);
CREATE TABLE holdings (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  quantity INT NOT NULL CHECK (quantity >= 0), avg_price NUMERIC NOT NULL,
  PRIMARY KEY (session_id, asset_id)
);
CREATE TABLE trades (
  id SERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL, asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_type VARCHAR(4) NOT NULL CHECK (trade_type IN ('buy','sell')),
  quantity INT NOT NULL CHECK (quantity > 0), price NUMERIC NOT NULL, amount NUMERIC NOT NULL,
  realized_pnl NUMERIC, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_trades_session ON trades(session_id, turn_number);
CREATE TABLE repayments (
  id SERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  month_index INT NOT NULL, due_amount INT NOT NULL, paid_amount INT NOT NULL,
  ratio NUMERIC, trust_delta INT, stress_delta INT, created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE event_log (
  id SERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL, event_type VARCHAR(30) NOT NULL, detail JSONB,
  cash_delta INT DEFAULT 0, stress_delta INT DEFAULT 0, trust_delta INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE memos (
  id SERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_date DATE NOT NULL, content VARCHAR(100), UNIQUE (session_id, game_date)
);
CREATE TABLE news_exposure (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_date DATE NOT NULL, news_id INT NOT NULL REFERENCES news(id),
  PRIMARY KEY (session_id, game_date, news_id)
);

-- ===== 시드 (채권 4 + 거시지표 7). 주식 117/코인 10은 ETL 적재. =====
INSERT INTO assets (asset_id, asset_type, code, name, masked_name, currency) VALUES
 ('BOND_KTB3Y','bond','KTB3Y','국고채 3년','국채 단기','KRW'),
 ('BOND_KTB10Y','bond','KTB10Y','국고채 10년','국채 장기','KRW'),
 ('BOND_CORPAAA','bond','CORPAAA','회사채 AAA','우량 회사채','KRW'),
 ('BOND_CORPBBB','bond','CORPBBB','회사채 BBB','투기 회사채','KRW');
INSERT INTO bond_info VALUES
 ('BOND_KTB3Y','국고채',NULL,'3Y'),('BOND_KTB10Y','국고채',NULL,'10Y'),
 ('BOND_CORPAAA','회사채','AAA',NULL),('BOND_CORPBBB','회사채','BBB',NULL);
INSERT INTO macro_indicators VALUES
 ('base_rate','기준금리','%'),('usdkrw','USD/KRW 환율','원'),('cpi','소비자물가지수','지수'),
 ('ktb_yield','국채금리','%'),('wti','WTI 유가','USD'),('gold','금 가격','USD'),('leading_index','경기선행지수','지수');
```

**핵심 조회 패턴**: 거래·총자산은 `asset_prices`만으로(타입 무관). 종목 상세 화면만 `*_price_detail`/타입별 정보 테이블 조인. 포트폴리오 비중은 `holdings ⋈ assets ⋈ asset_prices`.

---

## 6. 백엔드 구조 & API (`server/`)

```
server/src/
├── index.js · db.js(pg 풀+트랜잭션)
├── routes/        game · assets · news · community · portfolio · event · repayment · memo
├── controllers/   (동일)
└── services/  turnSelector(240) · pricingService(환율) · tradeService · valuationService
              · eventEngine(8종) · stressPolicy · trustPolicy · repaymentService · reportService · maskingService
```

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/game/start` | 세션·난이도·240턴 생성 |
| GET | `/api/game/:id` · `/turn/:n` | 상태 / 턴 데이터 |
| POST | `/api/game/:id/trade` · `/next-turn` · `/repay` · `/event` | 거래·턴진행·상환·이벤트 |
| GET | `/api/game/:id/portfolio` · `/report/...` · `/result` | 포트폴리오·리포트·결산 |
| GET | `/api/assets?type=&sort=` · `/assets/:id` · `/assets/:id/prices` | 종목 목록·상세·차트 |
| GET | `/api/macro/:date` · `/news/:date(/:assetId)` · `/community/:assetId` | 지표·뉴스·종토방 |
| ·/·/·/· | `/api/game/:id/memo` | 캘린더 메모 CRUD |

핵심 원칙: 돈·상태·시간(턴)은 **서버 권위**. 거래는 정수·즉시체결·수수료0, 평균단가·실현손익 서버 계산.

---

## 7. UI 화면

기존 디자인 작업물(`디자인/` 10개 HTML) 기준. 상세는 **`UI_SCREENS.md`** 참조.
- 메인화면: 상태바(현금·총자산·부채·스트레스·신뢰도·턴) + 메뉴(마켓·뉴스·포트폴리오·캘린더) + NEXT TURN
- 마켓(랭킹/업종/참고지표) · 종목상세(차트·뉴스·종토방·정보 4탭, 타입별 상이) · 포트폴리오(종합/주식/채권/코인/수익분석) · 매수/매도
- 이벤트 6종(사채전화·상환·기절·명절·여행·결혼식) · 정산 · 엔딩

---

## 8. 개발 로드맵 / 마일스톤

| Phase | 목표 | 상태 |
|---|---|---|
| P0 기반 | DB 스키마 + Docker + 서버 부트스트랩 | ✅ 스키마(23테이블) 검증 완료 |
| P1 데이터 적재 | 131자산 시세·재무·거시·뉴스·종토방 ETL | ⏳ stub→실데이터 |
| P2 게임 코어 | 세션·240턴·매수/매도·평가·자동저장 | ⏳ (프로토타입 컨트롤러 → 풀스코프 재작성) |
| P3 상태/상환 | 스트레스·신뢰도·월말상환·승패 | ⏳ |
| P4 이벤트 | 이벤트 엔진 + 8종 | ⏳ |
| P5 프론트 | React19+Vite 전 화면(UI_SCREENS 기준) | ⏳ |
| P6 리포트/안정화 | 월간·최종 리포트(LLM 피드백)·밸런싱·배포 | ⏳ |

---

## 9. 개발 환경 / 실행

```bash
docker-compose up -d                          # db(antsurvival) + api(3001), 스키마 자동 적용
docker exec antsurvival_api node seeds/import_news.js --stub
curl http://localhost:3001/health
cd stock-game-frontend && npm run dev          # React+Vite :5173
```
환경변수: `DATABASE_URL`, `PORT=3001`, `CORS_ORIGIN`, `GAME_START_RANGE=2013-01-01..2023-12-31`.

---

## 10. 검증 현황

- DB 스키마(최종 타입별 분리, **23테이블**): PostgreSQL 16 생성·시드·FK 체인 검증 완료(§5 DDL).
- 백엔드 프로토타입(JS): 구문검사 + 게임흐름 통합테스트 15/15 통과(4종목 기준).
- 다음: ① 컨트롤러를 §5 스키마/풀스코프로 재작성 → ② 실데이터 적재 → ③ 프론트 연결.

---

## 11. 산출물 / 문서 맵

| 문서/파일 | 내용 |
|---|---|
| **본 문서** | 최종 개발 파이프라인(단일 기준, 전체 DDL 포함) |
| `UI_SCREENS.md` | 디자인 기반 화면 명세 + UI↔API 매핑 |
| `server/migrations/001_init.sql` | DB 스키마(타입별 분리, 23테이블 — §5 DDL과 동일) |
| `server/` | Express JS MVC 스캐폴드 |
| `docker-compose.yml` | DB+API 컨테이너 |
| `repo_alignment_check.md` | 프로토타입↔풀스코프 정렬 이력 |

> 이전 `ARCHITECTURE_revised.md`·`TECH_STACK_revised.md`의 내용은 본 문서에 통합됨.

---

## 12. 개발 폴더 구조 (스캐폴드)

`server`(Express JS MVC) + `frontend`(React19+Vite) + Docker. ★=동작 코드, 나머지=TODO 스텁.

```
antsurvival/
├── docker-compose.yml              # DB(postgres16) + API(3001)
├── README.md
├── server/                         # Express(JS) MVC + PostgreSQL
│   ├── Dockerfile · package.json · .env.example
│   ├── migrations/001_init.sql     # ★ 최종 23테이블 스키마(§5 DDL)
│   ├── seeds/import_news.js         # 데이터 적재(--stub)
│   └── src/
│       ├── index.js · db.js         # ★ 진입점 · pg 연결
│       ├── config/constants.js      # 240턴·뉴스열람제한 등 상수
│       ├── routes/                  # ★ API 배선: game·assets·macro·news·community
│       ├── controllers/             # gameController·assetController·macroController·newsController·communityController
│       └── services/                # turnSelector·pricingService·tradeService·valuationService
│                                    # ·eventEngine·stressPolicy·trustPolicy·repaymentService·reportService·maskingService
└── frontend/                       # React 19 + Vite (JS)
    ├── package.json · vite.config.js(/api 프록시) · index.html
    └── src/
        ├── main.jsx · App.jsx        # 화면 전환
        ├── api/client.js             # ★ 백엔드 호출 클라이언트
        ├── pages/                    # IntroScreen · MainScreen
        ├── components/               # StatusBar·MarketModal·AssetDetailModal·PortfolioModal·NewsModal·TradeModal
        ├── state/gameStore.js
        └── styles/global.css
```

- **★ 동작**: 진입점·DB연결·라우트 배선·API 클라이언트·DB 스키마.
- **TODO 스텁**: 컨트롤러(501 응답)·서비스(시그니처)·프론트 컴포넌트. 각 파일에 `pipeline §5/§6 참고` 주석.
- 실행: `docker-compose up -d` → `node seeds/import_news.js --stub` → `cd frontend && npm run dev`.
