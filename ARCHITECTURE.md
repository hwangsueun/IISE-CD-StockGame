# 동학개미 서바이벌 (ANT SURVIVAL) 아키텍처

> 이 문서가 레포의 단일 기준 문서다. 기존 `TECH_STACK*`, `ARCHITECTURE_revised`, `UI_SCREENS`, `DEVELOPMENT_PIPELINE` 내용은 본 문서로 통합하고 삭제했다.

## 1. 제품 스코프

실제 금융데이터 기반 턴제 투자 시뮬레이션 게임이다. 플레이어는 1년치 시장을 240거래일 턴으로 진행하며 자산을 매매하고, 스트레스와 신뢰도를 관리하면서 부채를 상환한다.

| 항목 | 기준 |
|---|---|
| 게임 기간 | 240턴, 1턴=거래일 하루, 20턴=1개월 |
| 투자 자산 | 131개: 주식 117, 채권 4, 코인 10 |
| 초기 현금 | 기본 5,000만 원. 밸런싱 값은 서버 상수로 관리 |
| 부채 난이도 | 5,000만 / 1억 / 1억 5,000만 |
| 상태값 | 현금, 총자산, 부채, 스트레스(0-100), 신뢰도(0-100) |
| 뉴스 | 하루 최대 10건, 스트레스 구간별 열람 제한 |
| 성공 조건 | 240턴 내 부채 전액 상환 |
| 실패 조건 | 240턴 종료 후 미상환 또는 신뢰도 0 |
| 마스킹 | 실제 회사명은 게임 표시 전에 2단계 가명 처리 |

이전 4종목/5턴/100만 원 프로토타입은 더 이상 기준이 아니다. 개발과 리뷰는 위 풀스코프를 기준으로 한다.

## 2. 기술 스택

```
[Python ETL] -> [PostgreSQL 16 on Docker] -> [Express API, plain JS] -> [React 19 + Vite]
```

| 레이어 | 기준 |
|---|---|
| 프론트엔드 | React 19, Vite, JavaScript/JSX, CSS |
| 백엔드 | Express, Node.js plain JavaScript, REST, MVC(routes/controllers/services) |
| DB | PostgreSQL 16, Docker, `pg` 직접 연결 |
| 데이터 파이프라인 | Python, GPT-4o Batch API, FnGuide DataGuide, CoinGecko, GDELT, 디시인사이드 |
| 미사용 | Supabase 미사용. 백엔드는 자체 호스팅 PostgreSQL에 직접 접근 |

## 3. 시스템 구조

```
[오프라인 데이터 파이프라인]
  FnGuide / CoinGecko / 거시지표 / news_generator / 디시인사이드
        |
        | 정제, 타입별 변환, 뉴스 생성, 회사명 마스킹, 적재
        v
[PostgreSQL]
  자산, 시세, 거시, 뉴스, 종토방, 세션, 거래, 이벤트
        |
        | SQL via pg
        v
[Express API]
  routes -> controllers -> services
        |
        | REST / JSON
        v
[React + Vite]
  게임 화면, 모달, 차트, 거래, 포트폴리오, 뉴스, 이벤트
```

원칙:

- 런타임 게임 로직과 오프라인 ETL은 분리한다.
- 돈, 상태값, 턴, 거래 체결, 상환, 이벤트 결과는 서버 권위로 계산한다.
- 프론트는 서버 상태를 표시하고 사용자 입력을 전달한다.
- 데이터 미완성 시에도 stub 적재로 프론트/백엔드 개발이 가능해야 한다.

## 4. 레포 구조

최종 구현 폴더 구조는 아래를 기준으로 한다.

```
antsurvival/
├── ARCHITECTURE.md
├── docker-compose.yml
├── server/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   ├── migrations/
│   │   └── 001_init.sql
│   ├── seeds/
│   │   └── import_news.js
│   └── src/
│       ├── index.js
│       ├── db.js
│       ├── config/
│       │   └── constants.js
│       ├── routes/
│       │   ├── game.js
│       │   ├── assets.js
│       │   ├── macro.js
│       │   ├── news.js
│       │   ├── community.js
│       │   ├── portfolio.js
│       │   ├── event.js
│       │   ├── repayment.js
│       │   └── memo.js
│       ├── controllers/
│       └── services/
│           ├── turnSelector.js
│           ├── pricingService.js
│           ├── tradeService.js
│           ├── valuationService.js
│           ├── eventEngine.js
│           ├── stressPolicy.js
│           ├── trustPolicy.js
│           ├── repaymentService.js
│           ├── reportService.js
│           └── maskingService.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api/client.js
        ├── pages/
        ├── components/
        ├── state/gameStore.js
        └── styles/global.css
```

## 5. Docker / 실행 환경

```yaml
services:
  db:
    image: postgres:16
    container_name: antsurvival_db
    environment:
      POSTGRES_DB: antsurvival
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./server/migrations:/docker-entrypoint-initdb.d

  api:
    build: ./server
    container_name: antsurvival_api
    ports:
      - "3001:3001"
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://admin:password@db:5432/antsurvival
      PORT: 3001
      CORS_ORIGIN: http://localhost:5173

volumes:
  pgdata:
```

개발 실행:

```bash
docker-compose up -d
docker exec antsurvival_api node seeds/import_news.js --stub
curl http://localhost:3001/health
cd frontend && npm run dev
```

환경변수:

```bash
DATABASE_URL=postgresql://admin:password@localhost:5432/antsurvival
PORT=3001
CORS_ORIGIN=http://localhost:5173
GAME_START_RANGE=2013-01-01..2023-12-31
```

## 6. 데이터 파이프라인

| 데이터 | 소스 | 적재/변환 기준 |
|---|---|---|
| 주식 시세 | FnGuide DataGuide | 수정종가, 거래량, 수급(외국인/기관/개인), 유동주식, 시총 |
| 주식 재무/지표 | FnGuide DataGuide | 반기별 재무제표, 가치평가, 재무비율 |
| 채권 | DataGuide + 크롤링 | 국고채 수익률은 가격지수로 변환, 회사채는 총수익지수 |
| 코인 | CoinGecko API | USD 일별 종가, 시총, 거래량. 게임 표시/평가는 KRW 변환 |
| 거시지표 | 기준금리, 환율, CPI, 국채금리, WTI, 금, 경기선행지수 | `macro_daily`에 일자별 적재 |
| 뉴스 | news_generator | 거시, 개별주식, 시장/섹터, 실적, 분리기사 통합 |
| 종토방 | 디시인사이드 101개 갤러리 | 읽기 전용 NPC 게시글/댓글 |

적재 순서:

1. `assets`
2. `asset_prices`
3. 타입별 상세 시세: `stock_price_detail`, `bond_price_detail`, `coin_price_detail`
4. 타입별 정보: `stock_financials`, `stock_valuation`, `bond_info`, `coin_info`
5. `macro_indicators`, `macro_daily`
6. `news`, `news_tags`
7. `community_posts`, `community_comments`
8. 회사명 가명 마스킹 후 `is_masked = TRUE`

마스킹 기준:

1. 별칭을 정식명으로 정규화한다.
2. 정식명을 가상 회사명으로 치환한다.
3. 조사 보정은 서버/ETL 공용 유틸에서 처리한다.
4. 게임 화면과 API 응답에는 원 회사명이 노출되지 않아야 한다.

## 7. DB 스키마

최종 스키마는 23개 테이블이다. 자산 타입별 가격 구조가 달라 공통 거래/평가 테이블과 타입별 상세 테이블을 분리한다. 이 DDL을 `server/migrations/001_init.sql`의 기준으로 사용한다.

문서 운영 기준:

- 현재는 레포에 실제 migration 파일이 없고 설계 기준을 하나로 모으는 단계라 전체 DDL을 이 문서에 포함한다.
- 구현 스캐폴드가 생기면 실행 가능한 SQL은 `server/migrations/001_init.sql`로 옮긴다.
- 그 이후 `ARCHITECTURE.md`에는 테이블 그룹, 핵심 관계, 설계 원칙, migration 파일 링크만 남긴다.
- DB 변경은 migration 파일을 먼저 수정하고, 이 문서는 변경 의도와 구조 요약만 갱신한다.

### 7-1. DB 담당자 작업 기준

DB 구조를 짤 때는 아래 순서로 확정한다.

1. 공통 자산 마스터와 타입별 상세 데이터를 분리한다.
2. 거래/평가/포트폴리오 계산은 `asset_prices` 하나로 처리할 수 있게 한다.
3. 주식, 채권, 코인은 상세 시세와 정보 구조가 다르므로 별도 테이블에 둔다.
4. 뉴스, 종토방, 거시지표는 게임 중 생성하지 않는 읽기 중심 데이터로 둔다.
5. 세션, 보유, 거래, 상환, 이벤트, 메모, 뉴스 노출은 플레이어별 쓰기 데이터로 둔다.
6. 서버 API가 자주 조회하는 조건에는 처음부터 복합 인덱스를 둔다.
7. 회사명 원문은 내부 데이터로만 쓰고, 게임 응답은 `masked_name` 기준으로 내려준다.

### 7-2. 테이블 그룹

| 그룹 | 테이블 | 성격 | 작성 주체 |
|---|---|---|---|
| 자산 마스터 | `assets` | 모든 투자 대상의 공통 식별자 | ETL/seed |
| 공통 시세 | `asset_prices` | 거래, 평가, 차트 기본 가격 | ETL |
| 타입별 상세 시세 | `stock_price_detail`, `bond_price_detail`, `coin_price_detail` | 자산 타입별 추가 가격/거래량/수급 | ETL |
| 타입별 정보 | `stock_financials`, `stock_valuation`, `bond_info`, `coin_info` | 상세 화면 정보 탭 | ETL/seed |
| 거시지표 | `macro_indicators`, `macro_daily` | 시장 참고지표 | ETL/seed |
| 뉴스 | `news`, `news_tags` | 날짜/자산/태그 기반 뉴스 | ETL |
| 종토방 | `community_posts`, `community_comments` | 읽기 전용 NPC 반응 | ETL |
| 게임 진행 | `game_sessions`, `game_turns`, `holdings`, `trades` | 세션 상태, 날짜, 보유, 거래 | API |
| 상태/기록 | `repayments`, `event_log`, `memos`, `news_exposure` | 상환, 이벤트, 메모, 뉴스 노출 이력 | API |

### 7-3. 핵심 관계

```mermaid
erDiagram
  assets ||--o{ asset_prices : "has prices"
  assets ||--o{ stock_price_detail : "stock detail"
  assets ||--o{ bond_price_detail : "bond detail"
  assets ||--o{ coin_price_detail : "coin detail"
  assets ||--o{ news : "optional target"
  assets ||--o{ community_posts : "board posts"
  assets ||--o{ holdings : "held by session"
  assets ||--o{ trades : "traded by session"
  macro_indicators ||--o{ macro_daily : "daily values"
  news ||--o{ news_tags : "classified by"
  news ||--o{ news_exposure : "shown to player"
  community_posts ||--o{ community_comments : "has comments"
  game_sessions ||--o{ game_turns : "has turns"
  game_sessions ||--o{ holdings : "has holdings"
  game_sessions ||--o{ trades : "has trades"
  game_sessions ||--o{ repayments : "has repayments"
  game_sessions ||--o{ event_log : "has events"
  game_sessions ||--o{ memos : "has memos"
  game_sessions ||--o{ news_exposure : "has exposed news"
```

관계 설계 기준:

- `asset_id`는 전 자산 공통 FK다. 주식 코드를 직접 FK로 쓰지 않는다.
- `news.asset_id`는 nullable이다. 거시/시장 뉴스는 특정 자산이 없을 수 있다.
- `game_turns`는 세션별 240개를 먼저 생성해서 날짜 진행을 고정한다.
- `holdings`는 현재 보유 상태, `trades`는 체결 이력이다. 둘을 섞지 않는다.
- `news_exposure`는 스트레스 제한 때문에 실제로 플레이어에게 노출된 뉴스만 기록한다.
- `event_log.detail`은 이벤트별 세부값이 계속 달라질 수 있으므로 `JSONB`로 둔다.

### 7-4. 테이블별 설계 체크리스트

| 테이블 | PK | 주요 FK | 핵심 컬럼 | 설계 메모 |
|---|---|---|---|---|
| `assets` | `asset_id` | - | `asset_type`, `code`, `name`, `masked_name`, `sector`, `currency` | 모든 자산의 기준 테이블 |
| `asset_prices` | `(asset_id, trade_date)` | `asset_id` | `close_price`, `change_rate`, `currency` | 거래/평가 공통 가격 |
| `stock_price_detail` | `(asset_id, trade_date)` | `asset_id` | 종가, 수급, 유동주식, 시총 | 주식 상세 차트/정보용 |
| `bond_price_detail` | `(asset_id, trade_date)` | `asset_id` | `yield_rate`, `price_index` | 채권은 수익률과 가격지수를 분리 |
| `coin_price_detail` | `(asset_id, trade_date)` | `asset_id` | `market_cap`, `volume_usd` | 코인은 USD 원천 데이터를 보존 |
| `stock_financials` | `(asset_id, fiscal_year, half)` | `asset_id` | 매출, 영업이익, 순이익, 부채, 현금, 재고 | 반기별 재무제표 |
| `stock_valuation` | `(asset_id, fiscal_year, half)` | `asset_id` | PER, PBR, PSR, ROE, ROA, EPS 등 | 반기별 밸류에이션 |
| `bond_info` | `asset_id` | `asset_id` | `bond_type`, `credit_rating`, `maturity` | 채권 정적 정보 |
| `coin_info` | `asset_id` | `asset_id` | `symbol`, `market_cap_tier`, 생존 여부 | 코인 정적 정보 |
| `macro_indicators` | `indicator_code` | - | `display_name`, `unit` | 거시지표 코드북 |
| `macro_daily` | `(indicator_code, trade_date)` | `indicator_code` | `value` | 날짜별 거시지표 |
| `news` | `id` | `asset_id` nullable | `news_date`, `news_type`, `headline`, `sentiment`, `event_family` | 모든 뉴스 통합 |
| `news_tags` | `(news_id, tag_type, tag)` | `news_id` | `tag_type`, `tag` | 자산/섹터/카테고리 태그 |
| `community_posts` | `id` | `asset_id` | `post_date`, `npc_nickname`, `title`, `body`, `sentiment` | 종토방 게시글 |
| `community_comments` | `id` | `post_id` | `npc_nickname`, `body`, `sentiment` | 종토방 댓글 |
| `game_sessions` | `id` | - | `status`, `difficulty`, `current_turn`, `cash`, `debt`, `stress`, `trust` | 플레이어 현재 상태 |
| `game_turns` | `(session_id, turn_number)` | `session_id` | `trade_date` | 세션별 고정 날짜표 |
| `holdings` | `(session_id, asset_id)` | `session_id`, `asset_id` | `quantity`, `avg_price` | 현재 보유 상태 |
| `trades` | `id` | `session_id`, `asset_id` | `turn_number`, `trade_type`, `quantity`, `price`, `amount`, `realized_pnl` | 체결 이력 |
| `repayments` | `id` | `session_id` | `month_index`, `due_amount`, `paid_amount`, `ratio` | 20턴마다 상환 기록 |
| `event_log` | `id` | `session_id` | `turn_number`, `event_type`, `detail`, delta 컬럼 | 이벤트 결과 감사 로그 |
| `memos` | `id` | `session_id` | `game_date`, `content` | 날짜별 100자 메모 |
| `news_exposure` | `(session_id, game_date, news_id)` | `session_id`, `news_id` | `game_date` | 실제 노출 뉴스 기록 |

### 7-5. 인덱스 우선순위

첫 migration에 반드시 포함할 인덱스:

- `assets(asset_type)`: 자산군 필터
- `asset_prices(trade_date)`: 날짜별 가격 조회
- `news(news_date)`: 날짜별 뉴스 조회
- `news(news_type, news_date)`: 타입별 뉴스 필터
- `news(asset_id, news_date)`: 종목 상세 뉴스
- `community_posts(asset_id, post_date)`: 종목토론방 날짜 조회
- `game_turns(trade_date)`: 특정 날짜 역조회
- `trades(session_id, turn_number)`: 세션별 거래 이력
- `event_log(session_id, turn_number)`: 턴별 이벤트 로그

### 7-6. 초안 DDL

아래 SQL은 DB 담당자가 migration을 만들 때 사용할 초안이다. 구현 파일이 생기면 이 블록을 그대로 유지하지 말고 `server/migrations/001_init.sql`로 옮긴 뒤, 이 문서에는 요약만 남긴다.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 공통 자산
CREATE TABLE assets (
  asset_id    VARCHAR(20) PRIMARY KEY,
  asset_type  VARCHAR(10) NOT NULL CHECK (asset_type IN ('stock','bond','coin')),
  code        VARCHAR(20),
  name        VARCHAR(100) NOT NULL,
  masked_name VARCHAR(100),
  sector      VARCHAR(50),
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_assets_type ON assets(asset_type);

-- 거래/평가 공통 시세
CREATE TABLE asset_prices (
  asset_id    VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date  DATE NOT NULL,
  close_price NUMERIC NOT NULL,
  change_rate NUMERIC,
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  PRIMARY KEY (asset_id, trade_date)
);
CREATE INDEX idx_prices_date ON asset_prices(trade_date);

-- 타입별 상세 시세
CREATE TABLE stock_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  close_price NUMERIC,
  volume BIGINT,
  foreign_qty BIGINT,
  inst_qty BIGINT,
  indiv_qty BIGINT,
  shares_outstanding BIGINT,
  market_cap NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

CREATE TABLE bond_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  yield_rate NUMERIC,
  price_index NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

CREATE TABLE coin_price_detail (
  asset_id   VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_date DATE NOT NULL,
  market_cap NUMERIC,
  volume_usd NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);

-- 타입별 정보
CREATE TABLE stock_financials (
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
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
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
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
  asset_id VARCHAR(20) PRIMARY KEY REFERENCES assets(asset_id),
  bond_type VARCHAR(20),
  credit_rating VARCHAR(10),
  maturity VARCHAR(10)
);

CREATE TABLE coin_info (
  asset_id VARCHAR(20) PRIMARY KEY REFERENCES assets(asset_id),
  symbol VARCHAR(20),
  market_cap_tier VARCHAR(20),
  listing_year INT,
  delisting_year INT,
  survived_to_2023 BOOLEAN
);

-- 거시
CREATE TABLE macro_indicators (
  indicator_code VARCHAR(30) PRIMARY KEY,
  display_name VARCHAR(50),
  unit VARCHAR(20)
);

CREATE TABLE macro_daily (
  indicator_code VARCHAR(30) NOT NULL REFERENCES macro_indicators(indicator_code),
  trade_date DATE NOT NULL,
  value NUMERIC,
  PRIMARY KEY (indicator_code, trade_date)
);

-- 뉴스
CREATE TABLE news (
  id SERIAL PRIMARY KEY,
  news_date DATE NOT NULL,
  news_type VARCHAR(30) NOT NULL CHECK (
    news_type IN ('macro','stock','market','earnings','stock_split','stock_react')
  ),
  asset_id VARCHAR(20) REFERENCES assets(asset_id),
  headline VARCHAR(300) NOT NULL,
  body TEXT,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral')),
  event_family VARCHAR(50),
  is_masked BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_news_date ON news(news_date);
CREATE INDEX idx_news_type_date ON news(news_type, news_date);
CREATE INDEX idx_news_asset_date ON news(asset_id, news_date);

CREATE TABLE news_tags (
  news_id INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  tag_type VARCHAR(20) NOT NULL CHECK (tag_type IN ('asset','sector','category','importance')),
  tag VARCHAR(50) NOT NULL,
  PRIMARY KEY (news_id, tag_type, tag)
);

-- 종토방
CREATE TABLE community_posts (
  id SERIAL PRIMARY KEY,
  post_date DATE NOT NULL,
  asset_id VARCHAR(20) REFERENCES assets(asset_id),
  npc_nickname VARCHAR(50),
  title VARCHAR(300),
  body TEXT,
  recommend_count INT DEFAULT 0,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral'))
);
CREATE INDEX idx_posts_asset_date ON community_posts(asset_id, post_date);

CREATE TABLE community_comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  npc_nickname VARCHAR(50),
  body TEXT NOT NULL,
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive','negative','neutral'))
);

-- 플레이어 세션
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','success','failed')),
  difficulty VARCHAR(10) CHECK (difficulty IN ('easy','normal','hard')),
  start_date DATE,
  current_turn INT NOT NULL DEFAULT 1 CHECK (current_turn BETWEEN 1 AND 240),
  action_locked_until_turn INT NOT NULL DEFAULT 0,
  initial_cash INT NOT NULL DEFAULT 50000000,
  debt_initial INT NOT NULL,
  cash INT NOT NULL,
  debt INT NOT NULL,
  stress INT NOT NULL DEFAULT 0 CHECK (stress BETWEEN 0 AND 100),
  trust INT NOT NULL DEFAULT 100 CHECK (trust BETWEEN 0 AND 100),
  final_cash INT
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
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (session_id, asset_id)
);

CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 240),
  asset_id VARCHAR(20) NOT NULL REFERENCES assets(asset_id),
  trade_type VARCHAR(4) NOT NULL CHECK (trade_type IN ('buy','sell')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  realized_pnl NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_trades_session_turn ON trades(session_id, turn_number);

CREATE TABLE repayments (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  month_index INT NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  due_amount INT NOT NULL,
  paid_amount INT NOT NULL,
  ratio NUMERIC,
  trust_delta INT,
  stress_delta INT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (session_id, month_index)
);

CREATE TABLE event_log (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 240),
  event_type VARCHAR(30) NOT NULL,
  detail JSONB,
  cash_delta INT DEFAULT 0,
  stress_delta INT DEFAULT 0,
  trust_delta INT DEFAULT 0,
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
  news_id INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, game_date, news_id)
);

-- 기본 시드. 주식 117개와 코인 10개는 ETL에서 적재한다.
INSERT INTO assets (asset_id, asset_type, code, name, masked_name, currency) VALUES
  ('BOND_KTB3Y','bond','KTB3Y','국고채 3년','국채 단기','KRW'),
  ('BOND_KTB10Y','bond','KTB10Y','국고채 10년','국채 장기','KRW'),
  ('BOND_CORPAAA','bond','CORPAAA','회사채 AAA','우량 회사채','KRW'),
  ('BOND_CORPBBB','bond','CORPBBB','회사채 BBB','투기 회사채','KRW');

INSERT INTO bond_info VALUES
  ('BOND_KTB3Y','국고채',NULL,'3Y'),
  ('BOND_KTB10Y','국고채',NULL,'10Y'),
  ('BOND_CORPAAA','회사채','AAA',NULL),
  ('BOND_CORPBBB','회사채','BBB',NULL);

INSERT INTO macro_indicators VALUES
  ('base_rate','기준금리','%'),
  ('usdkrw','USD/KRW 환율','원'),
  ('cpi','소비자물가지수','지수'),
  ('ktb_yield','국채금리','%'),
  ('wti','WTI 유가','USD'),
  ('gold','금 가격','USD'),
  ('leading_index','경기선행지수','지수');
```

조회 기준:

- 거래, 현재가, 총자산 평가는 `asset_prices`를 우선 사용한다.
- 종목 상세 화면에서만 `stock_price_detail`, `bond_price_detail`, `coin_price_detail`, 타입별 정보 테이블을 조인한다.
- 포트폴리오 비중은 `holdings`, `assets`, 현재 턴의 `asset_prices`를 조인한다.
- 코인은 소수 수량 거래를 허용할 수 있으므로 `holdings.quantity`와 `trades.quantity`는 `NUMERIC`으로 둔다. 주식/채권 정수 검증은 서비스 레이어에서 자산 타입별로 처리한다.

## 8. 백엔드 API

모든 응답은 JSON이며, 경로 변수는 `:sessionId`, `:assetId`, `:postId` 명명으로 통일한다.

### 8-1. 게임 흐름

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/game/start` | 난이도 선택, 세션 생성, 240턴 날짜 생성 |
| GET | `/api/game/:sessionId` | 현재 현금, 총자산, 부채, 스트레스, 신뢰도, 턴 |
| GET | `/api/game/:sessionId/turn/:turnNumber` | 턴 데이터: 자산 시세, 뉴스, 상태, 상환 여부 |
| POST | `/api/game/:sessionId/trade` | 매수/매도. 서버가 체결 가능 여부, 평균단가, 실현손익 계산 |
| POST | `/api/game/:sessionId/next-turn` | 다음 턴 진행, 가격/뉴스/이벤트/상태 갱신, 자동저장 |
| POST | `/api/game/:sessionId/repay` | 20턴마다 월말 상환 처리 |
| POST | `/api/game/:sessionId/event` | 이벤트 선택 결과 처리 |
| GET | `/api/game/:sessionId/result` | 최종 결산 |

### 8-2. 포트폴리오 / 리포트

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/game/:sessionId/portfolio` | 보유자산, 평가금액, 수익률, 자산군 비중 |
| GET | `/api/game/:sessionId/report/monthly/:monthIndex` | 월간 리포트 |
| GET | `/api/game/:sessionId/report/final` | 최종 리포트 |

### 8-3. 자산 / 시장 데이터

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/assets?type=&sort=&date=` | 종목 목록, 자산군 필터, 거래량/상승률/거래대금 정렬 |
| GET | `/api/assets/:assetId` | 종목 상세, 타입별 정보 |
| GET | `/api/assets/:assetId/prices?from=&to=` | 차트용 기간 시세 |
| GET | `/api/macro/:date` | 기준금리, 환율, CPI, 국채, WTI, 금, 경기선행지수 |

### 8-4. 뉴스 / 종토방 / 메모

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/news/:date` | 날짜별 뉴스. 스트레스 제한과 노출 기록 반영 |
| GET | `/api/news/:date/:assetId` | 날짜+자산별 뉴스 |
| GET | `/api/community/:assetId?date=` | 종토방 게시글 목록 |
| GET | `/api/community/post/:postId/comments` | 게시글 댓글 |
| GET | `/api/game/:sessionId/memo?date=` | 메모 조회 |
| POST | `/api/game/:sessionId/memo` | 당일 메모 작성 |
| PUT | `/api/game/:sessionId/memo/:memoId` | 당일 메모 수정 |
| DELETE | `/api/game/:sessionId/memo/:memoId` | 당일 메모 삭제 |

### 8-5. `GET /api/game/:sessionId/turn/:turnNumber` 응답 예시

```json
{
  "turnNumber": 45,
  "date": "2018-05-14",
  "monthIndex": 3,
  "isRepaymentTurn": false,
  "state": {
    "cash": 38500000,
    "totalAsset": 51200000,
    "debt": 50000000,
    "stress": 42,
    "trust": 88
  },
  "assets": [
    {
      "assetId": "STOCK_005930",
      "assetType": "stock",
      "name": "A전자",
      "price": 52400,
      "changeRate": 0.012
    }
  ],
  "news": [
    {
      "id": 1,
      "type": "macro",
      "headline": "한국은행 기준금리 동결",
      "sentiment": "neutral"
    }
  ],
  "newsLimit": 8,
  "actionLocked": false
}
```

## 9. 게임 로직

### 9-1. 턴 생성

- 게임 시작 시 `GAME_START_RANGE` 내 시작 거래일을 선택한다.
- 시작일부터 240거래일을 `game_turns`에 저장한다.
- 거래일 기준은 실제 가격 데이터가 존재하는 날짜다.
- 20, 40, ..., 240턴은 월말 상환 턴이다.

### 9-2. 턴 종료 순서

1. 현재 턴 입력 검증
2. 매수/매도 반영
3. 다음 턴 가격 조회
4. 보유자산 평가
5. 스트레스 기반 뉴스 노출량 계산
6. 이벤트 발생 여부 판단
7. 신뢰도/스트레스/현금/행동제한 반영
8. 자동저장

### 9-3. 거래

- 서버가 현금, 보유수량, 현재 턴 가격으로 체결 가능 여부를 판단한다.
- 주식/채권은 정수 수량을 기본으로 검증한다.
- 코인은 소수 수량을 허용할 수 있도록 DB 수량 타입은 `NUMERIC`으로 둔다.
- 수수료는 0으로 시작하되, 추후 밸런싱 시 `constants.js`에서 변경한다.
- 평균단가와 실현손익은 서버에서 계산한다.

### 9-4. 스트레스 / 신뢰도

- 스트레스는 뉴스 열람 제한, 기절/입원 이벤트, 일부 이벤트 선택 결과에 영향을 준다.
- 신뢰도는 독촉전화 확률, 상환 이벤트, 실패 조건에 영향을 준다.
- 스트레스와 신뢰도는 항상 0-100 사이로 clamp한다.

### 9-5. 이벤트

이벤트 타입은 서버 `eventEngine`에서 관리하고, 모든 결과는 `event_log`에 남긴다.

| 이벤트 | 트리거 | 주요 영향 |
|---|---|---|
| 사채업자 전화 | 신뢰도 낮을수록 확률 증가 | 스트레스 증가 |
| 사채업자 방문/상환 | 20턴마다 | 상환비율에 따라 신뢰도/스트레스 변화 |
| 기절/입원 | 스트레스 100 | 병원비, 3거래일 행동제한, 스트레스 리셋 |
| 명절 | 공휴일/월별 이벤트 | 현금/스트레스 변화 |
| 여행 | 랜덤 선택 이벤트 | 현금 감소, 스트레스 감소 |
| 결혼식 | 랜덤 선택 이벤트 | 현금/스트레스 변화 |
| 부업 | 선택형 현금 확보 | 시간/스트레스 비용 |
| 특수 시장 이벤트 | 뉴스/거시 조건 기반 | 자산군별 리스크 힌트 |

## 10. UI 화면

현재 디자인 기준 화면을 React 컴포넌트로 나눠 구현한다.

| 화면 | 역할 | 주요 API |
|---|---|---|
| 인트로/빚 설정 | 난이도 선택, 세션 시작 | `POST /api/game/start` |
| 메인 화면 | 상태바, 날짜, 헤드라인, 메뉴, 다음 턴 | `GET /api/game/:sessionId`, `POST /next-turn` |
| 마켓 모달 | 랭킹, 업종, 지표, 자산군 필터 | `GET /api/assets`, `GET /api/macro/:date` |
| 종목 상세 | 차트, 뉴스, 종토방, 타입별 정보 | `GET /api/assets/:assetId`, `/prices`, `/news`, `/community` |
| 매수/매도 | 수량 입력, 예상금액, 확정 | `POST /api/game/:sessionId/trade` |
| 포트폴리오 | 보유자산, 평가손익, 비중, 수익분석 | `GET /api/game/:sessionId/portfolio` |
| 뉴스 | 필터, 상세, 관련 자산 연결 | `GET /api/news/:date` |
| 캘린더 | 과거 뉴스, 메모 CRUD | `/memo`, `news_exposure` |
| 이벤트 팝업 | 선택형/강제 이벤트 처리 | `POST /api/game/:sessionId/event` |
| 월간/최종 리포트 | 20턴 정산, 엔딩 | `/report/monthly`, `/report/final`, `/result` |

UI와 데이터 정합:

- 상태바는 `game_sessions`의 현금, 총자산 계산값, 부채, 스트레스, 신뢰도와 1:1로 맞춘다.
- 자산군 필터는 `assets.asset_type`을 사용한다.
- 종목 상세의 정보 탭은 자산 타입별 테이블을 사용한다.
- 차트는 `asset_prices`를 기본으로 쓰고, 상세 지표가 필요한 경우 타입별 상세 시세를 추가 조인한다.
- 뉴스 열람 제한은 서버 응답의 `newsLimit`과 `news_exposure` 기준으로 표시한다.

## 11. 서비스 책임

| 서비스 | 책임 |
|---|---|
| `turnSelector` | 시작일 선택, 240거래일 생성 |
| `pricingService` | 현재가, 기간 시세, 환율 변환 |
| `tradeService` | 거래 검증, 체결, 평균단가, 실현손익 |
| `valuationService` | 총자산, 순자산, 수익률, 자산군 비중 |
| `stressPolicy` | 스트레스 증감, 뉴스 제한, 기절 조건 |
| `trustPolicy` | 신뢰도 증감, 독촉전화 확률 |
| `repaymentService` | 월말 상환금 계산, 상환 결과 반영 |
| `eventEngine` | 이벤트 발생 판단, 중복 방지, 결과 계산 |
| `reportService` | 월간/최종 리포트 계산 |
| `maskingService` | 회사명 가명 처리, 조사 보정 |

## 12. 개발 마일스톤

| Phase | 목표 | 기준 |
|---|---|---|
| P0 | DB 스키마, Docker, 서버 부트스트랩 | 23테이블 migration, health check |
| P1 | 데이터 적재 | 131자산, 시세, 재무, 거시, 뉴스, 종토방 stub/실데이터 |
| P2 | 게임 코어 | 세션, 240턴, 현재가, 매수/매도, 평가, 자동저장 |
| P3 | 상태/상환 | 스트레스, 신뢰도, 월말상환, 승패 |
| P4 | 이벤트 | 이벤트 엔진, `event_log`, 행동제한 |
| P5 | 프론트 | 메인/마켓/상세/포트폴리오/뉴스/캘린더/거래/이벤트 |
| P6 | 리포트/밸런싱 | 월간/최종 리포트, 난이도 조정, 안정화 |

## 13. 검증 기준

- `docker-compose up -d` 후 DB와 API가 기동해야 한다.
- `server/migrations/001_init.sql`은 빈 PostgreSQL 16에서 재실행 가능해야 한다.
- `node seeds/import_news.js --stub`로 최소 개발 데이터가 적재되어야 한다.
- `/health`가 200을 반환해야 한다.
- 게임 시작 후 240개 `game_turns`가 생성되어야 한다.
- 기본 게임 플로우 테스트는 시작 -> 턴 조회 -> 거래 -> 다음 턴 -> 상환 -> 결과 순서를 포함해야 한다.
- API 응답에는 마스킹 전 회사명이 노출되지 않아야 한다.

## 14. 단일 문서 운영 규칙

- 아키텍처, 기술스택, DB, API, UI 기준 변경은 이 파일에만 반영한다.
- 별도 설계 Markdown을 추가하지 않는다. 필요하면 이 파일에 섹션을 추가한다.
- 구현 파일의 주석은 이 문서 섹션 번호를 참조할 수 있다.
- 프로토타입 기준(4종목, 5턴, 100만 원)은 테스트 fixture 외에는 사용하지 않는다.
