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

**스캐폴드 구현 완료 (2026-07-07).** 아래 구조가 레포에 실제로 존재하며, 파일마다 담당 로직의 시그니처와 TODO가 채워져 있다.

```
IISE-CD-StockGame/
├── ARCHITECTURE.md
├── docker-compose.yml            # postgres:16 + api (migrations 자동 실행)
├── server/
│   ├── Dockerfile
│   ├── package.json              # express, pg, cors, dotenv, xlsx
│   ├── .env.example              # DATABASE_URL, GAME_START_RANGE, DATA_DIR
│   ├── migrations/
│   │   ├── 001_init.sql          # 기본 24테이블 DDL + 채권/거시지표 시드
│   │   └── 002_members_minigames.sql # 회원/부업/급등주 (+4테이블, 28테이블)
│   ├── seeds/
│   │   ├── import_all.js         # 오케스트레이터 (--stub 지원)
│   │   ├── stub.js               # 합성 개발 데이터 (29자산/300거래일/뉴스/종토방)
│   │   ├── import_stocks.js      # DataGuide xlsx -> assets/asset_prices/stock_price_detail
│   │   ├── import_macro.js       # macro_context_daily.csv (wide->long)
│   │   ├── import_bonds.js       # 국고채 수익률 -> 가격지수 변환 적재
│   │   ├── import_coins.js       # 코인 USD 시세 -> usdkrw 환산 적재
│   │   ├── import_news.js        # 뉴스 4종 JSONL (NEWS_DATA_CONTRACT 계약)
│   │   ├── import_community.js   # 디시 posts/comments_ready CSV
│   │   └── lib/                  # csv.js, jsonl.js, db.js(bulkInsert)
│   └── src/
│       ├── index.js              # express 부트스트랩, /health
│       ├── db.js                 # pg pool, withTransaction, DATE 문자열 파서
│       ├── config/constants.js   # 모든 밸런싱 상수 (턴/부채/월급/스트레스/이벤트)
│       ├── utils/                # errors, asyncHandler, clamp
│       ├── routes/               # game, assets, macro, news, community, portfolio,
│       │                         # event, repayment, memo, auth, sideJob, surge (12파일)
│       ├── controllers/          # 라우트별 검증/위임 (11파일)
│       └── services/
│           ├── gameService.js    # 세션 생성/상태/승패판정/결산
│           ├── turnSelector.js   # 시작일 선택, 240거래일 생성
│           ├── turnService.js    # 턴 데이터 조회 + next-turn 오케스트레이션
│           ├── pricingService.js # 현재가/기간시세/목록/타입별 상세
│           ├── tradeService.js   # 거래 검증/체결/평단/실현손익 (행잠금)
│           ├── valuationService.js # 총자산/보유평가/자산군 비중
│           ├── stressPolicy.js   # 뉴스 제한/기절/생활비 스트레스
│           ├── trustPolicy.js    # 독촉전화 확률/상환 효과
│           ├── repaymentService.js # 월말 상환 (20턴 주기)
│           ├── eventEngine.js    # EVENT_DEFS 레지스트리, 즉시/선택형 이벤트
│           ├── newsService.js    # 뉴스 노출 제한 + news_exposure 기록
│           ├── macroService.js   # 거시지표 조회
│           ├── communityService.js # 종토방 읽기
│           ├── memoService.js    # 캘린더 메모 CRUD
│           ├── reportService.js  # 주간/월간/최종 리포트 + 스냅샷
│           ├── authService.js    # 회원가입/로그인/토큰/프로필 (scrypt)
│           ├── sideJobService.js # 부업 미니게임 판정/보상/투자 잠금
│           ├── surgeStockService.js # 급등주 등장/매수/다음 턴 정산
│           └── maskingService.js # 가명 치환/조사 보정 유틸
└── frontend/
    ├── package.json              # react 19, zustand, vite
    ├── vite.config.js            # /api -> :3001 프록시
    ├── index.html
    └── src/
        ├── main.jsx / App.jsx    # 오프닝 -> 인트로 -> 메인 -> 결과 화면 전환
        ├── api/client.js         # 전 엔드포인트 1:1 래퍼 (+ Bearer 토큰)
        ├── state/gameStore.js    # zustand: 회원/세션/턴/모달/이벤트/급등주 상태
        ├── utils/                # format(원화/퍼센트), chartIndicators(MA/볼린저/RSI)
        ├── pages/                # OpeningPage, IntroPage, MainPage, ResultPage
        ├── components/           # StatusBar, NewsPanel, NewsModal, MarketModal,
        │                         # AssetDetailModal(차트+기술지표/뉴스/종토방/정보),
        │                         # TradeModal, PortfolioModal(보유+수익분석),
        │                         # CalendarModal, RepaymentModal, ReportModal,
        │                         # EventPopup(payload 입력), SideJobModal,
        │                         # SurgeStockPopup, AuthPanel, CommunityBoard,
        │                         # PriceChart(SVG), Modal
        │   └── minigames/        # CatchWaxon, AvoidProfessor, PassengerTetris
        └── styles/global.css     # 디자인 시안 적용 전 기능 확인용
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
docker compose up -d                       # DB(+migration) & API
docker exec antsurvival_api node seeds/import_all.js --stub   # 개발용 스텁 적재
curl http://localhost:3001/health
cd frontend && npm install && npm run dev  # http://localhost:5173 (/api 프록시)
```

API를 로컬 노드로 띄울 때: `cd server && npm install && npm run dev`, 스텁 적재는 `npm run seed:stub`.
실데이터 적재: `DATA_DIR=<data-pipeline 경로> npm run seed` (§6-0 인벤토리 파일 필요).

환경변수 (`server/.env.example` 참조):

```bash
DATABASE_URL=postgresql://admin:password@localhost:5432/antsurvival
PORT=3001
CORS_ORIGIN=http://localhost:5173
GAME_START_RANGE=2013-01-02..2023-12-31
DATA_DIR=/path/to/data-pipeline
```

## 6. 데이터 파이프라인

### 6-0. 최종 데이터 인벤토리 (2026-07-07 확인, 적재기 구현 완료)

게임 DB에 들어가는 최종 산출물과 실제 경로. `DATA_DIR` = `data-pipeline` 체크아웃 루트(또는 Drive 다운로드 폴더).

| 데이터 | 실제 파일 (DATA_DIR 기준) | 스키마 요점 | 적재기 |
|---|---|---|---|
| 뉴스 4종 (13,497건) | `news_generator/data/interim/game_publish_calendar/*.game.jsonl` (Drive `game_news_data/` 동일본) | **NEWS_DATA_CONTRACT.md 확정 계약.** `news_lines: string[]`, `game_publish_date` 기준 턴 배치 | `import_news.js` |
| 주식 시세/거래량 | `data/raw/stock/stock_price-volume_npq.xlsx` (DataGuide, 시트 13-17/18-22/23) | wide 포맷, 코드 `A000660`형, 종가(원)/거래량(주). npq 시트=수급(TODO) | `import_stocks.js` |
| 거시지표 (34종) | `market_indicator/data/processed/macro_context_daily.csv` | wide 일별. 컬럼명 = `macro_indicators.indicator_code` | `import_macro.js` |
| 국고채 수익률 | `bond_universe/data/kr_treasury_yields_long.csv` | `date,series(KTB_3Y/KTB_10Y),yield_pct` | `import_bonds.js` |
| 회사채 금리 | macro CSV 내 `corp_aa_minus_3y_rate`, `corp_bbb_minus_3y_rate` | 수익률 -> 가격지수 변환 후 거래가 산출 | `import_bonds.js` |
| 코인 메타/시세 | `crypto_universe/data/processed/coin_universe_selected.csv`, `coin_history_selected.csv` | USD 원천 보존, 거래가는 `usdkrw` 환산 KRW | `import_coins.js` |
| 종토방 | `npc_generator/data/processed/dci_posts_ready.csv`, `dci_comments_ready.csv` | `gall_id`별 게시글/댓글. 갤러리->종목 매핑표 필요(TODO) | `import_community.js` |
| 주식 재무/밸류에이션 | (DataGuide 반기 재무 — 파일 미확정) | `stock_financials`/`stock_valuation` 스키마 준비됨 | TODO |

미확정/잔여: ① 거시뉴스 전기간 재생성본 교체(스키마 불변, Drive 파일만 교체) ② 마스킹 사전(별칭->정식명->가명) ③ 갤러리-종목 매핑 ④ 반기 재무 원본 ⑤ npq 수급 시트 매핑.

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

최종 스키마는 **28개 테이블**이다 (초안 23 + `session_snapshots` + 회원 2종 + 부업/급등주 2종). 자산 타입별 가격 구조가 달라 공통 거래/평가 테이블과 타입별 상세 테이블을 분리한다.

**실행 가능한 전체 DDL은 migration 파일이 단일 기준이다:**
[`001_init.sql`](server/migrations/001_init.sql) (기본 24테이블) + [`002_members_minigames.sql`](server/migrations/002_members_minigames.sql) (`users`, `auth_tokens`, `side_job_plays`, `surge_stocks` + `game_sessions.user_id/side_job_turn`).
이 문서에는 테이블 그룹, 핵심 관계, 설계 원칙만 남긴다. DB 변경은 migration 파일을 먼저 수정하고, 이 문서는 변경 의도와 구조 요약만 갱신한다.

**초안 대비 확정 변경 (최종 데이터 정합, 2026-07-07):**

1. **`news` 테이블을 NEWS_DATA_CONTRACT.md와 1:1로 재설계.** 초안의 `headline/body/sentiment/SERIAL id` 구조를 폐기하고 계약 필드를 그대로 컬럼화했다: `news_id VARCHAR PK`(계약의 news_id/article_id), `category`(market_sector·market_macro·stock_disclosure·annual_earnings·split_article), `news_lines JSONB`(완성형 기사 문장 배열), `publish_date`/`game_publish_date` 분리, 거시용 `event_type/direction/strength/market/sector/macro_asset_label`, 종목용 `stock_code/asset_id/event_family/claim_level/bundle_id`, 연간실적용 `business_year/date_basis/fs_div`, 분할기사용 `article_type/source_custom_id/source_rcept_no/material_reason`. 턴 배치·인덱스는 전부 `game_publish_date` 기준.
2. **`community_posts`에 원천 컬럼 추가**: `source_post_id`, `gall_id`, `view_count`, `dislike_count` (dci_posts_ready.csv 정합).
3. **`coin_price_detail`은 USD 원천 보존** (`price_usd`, `market_cap_usd`, `volume_usd`), 거래가는 `asset_prices`에 KRW 환산 적재.
4. **`coin_info`를 실데이터 컬럼으로** (`first_observed_date`, `last_observed_date`, `max_market_cap`, `survived_to_2023`).
5. **`macro_indicators`에 `display_order`, `is_game_visible` 추가** — macro CSV 34개 컬럼 중 게임 노출 10종 선별.
6. **`game_sessions`에 `monthly_living_cost` 추가** (기획서 월급/생활비), 금액 컬럼은 `BIGINT`.
7. **`event_log`에 `resolved` 추가** — 선택형 이벤트의 선택 대기/완료 구분.
8. **`session_snapshots` 신설** — daily/weekly/monthly/final 자산 스냅샷. 주간 평가·월간 리포트·엔딩 추이 차트의 원천.
9. 스트레스 100 기절의 행동제한은 `action_locked_until_turn`으로 구현 (해당 턴까지 거래 차단).

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
| 상태/기록 | `repayments`, `event_log`, `memos`, `news_exposure`, `session_snapshots` | 상환, 이벤트, 메모, 뉴스 노출, 자산 스냅샷 | API |
| 회원 | `users`, `auth_tokens` | 회원가입/로그인/이어하기 (게스트 허용, `game_sessions.user_id` nullable) | API |
| 부업/급등주 | `side_job_plays`, `surge_stocks` | 미니게임 결과(하루 1회 UNIQUE), 급등주 등장~정산 상태 | API |

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
| `stock_price_detail` | `(asset_id, trade_date)` | `asset_id` | 종가, 거래량, 수급, 유동주식, 시총 | 주식 상세 차트/정보용 (DataGuide 원천에 OHLC 없음 — 종가만) |
| `bond_price_detail` | `(asset_id, trade_date)` | `asset_id` | `yield_rate`, `price_index` | 채권은 수익률과 가격지수를 분리 |
| `coin_price_detail` | `(asset_id, trade_date)` | `asset_id` | `market_cap`, `volume_usd` | 코인은 USD 원천 데이터를 보존 |
| `stock_financials` | `(asset_id, fiscal_year, half)` | `asset_id` | 매출, 영업이익, 순이익, 부채, 현금, 재고 | 반기별 재무제표 |
| `stock_valuation` | `(asset_id, fiscal_year, half)` | `asset_id` | PER, PBR, PSR, ROE, ROA, EPS 등 | 반기별 밸류에이션 |
| `bond_info` | `asset_id` | `asset_id` | `bond_type`, `credit_rating`, `maturity` | 채권 정적 정보 |
| `coin_info` | `asset_id` | `asset_id` | `symbol`, `market_cap_tier`, 생존 여부 | 코인 정적 정보 |
| `macro_indicators` | `indicator_code` | - | `display_name`, `unit` | 거시지표 코드북 |
| `macro_daily` | `(indicator_code, trade_date)` | `indicator_code` | `value` | 날짜별 거시지표 |
| `news` | `news_id` (계약 ID) | `asset_id` nullable | `category`, `game_publish_date`, `news_lines`, `direction`, `strength`, `event_family` | 뉴스 4종 통합, 계약 1:1 |
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

### 7-6. DDL

전체 DDL(24테이블 + 인덱스 + 채권/거시지표 기본 시드)은 [`server/migrations/001_init.sql`](server/migrations/001_init.sql)에 있다. 빈 PostgreSQL 16에서 재실행 가능하며, `docker-compose up -d` 시 자동 실행된다.

조회 기준:

- 거래, 현재가, 총자산 평가는 `asset_prices`를 우선 사용한다.
- 종목 상세 화면에서만 `stock_price_detail`, `bond_price_detail`, `coin_price_detail`, 타입별 정보 테이블을 조인한다.
- 포트폴리오 비중은 `holdings`, `assets`, 현재 턴의 `asset_prices`를 조인한다.
- 코인은 소수 수량 거래를 허용할 수 있으므로 `holdings.quantity`와 `trades.quantity`는 `NUMERIC`으로 둔다. 주식/채권 정수 검증은 서비스 레이어에서 자산 타입별로 처리한다.

## 8. 백엔드 API

모든 응답은 JSON이며, 경로 변수는 `:sessionId`, `:assetId`, `:postId` 명명으로 통일한다.
로그인은 선택(게스트 허용): `Authorization: Bearer <token>` 헤더가 있으면 세션이 계정에 연결된다.

### 8-0. 회원관리 (기능명세서 §회원)

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/auth/register` | 회원가입. `{ username, password, nickname? }` (입력 검증 + 중복 확인) |
| POST | `/api/auth/login` | 로그인 -> `{ token, user }` |
| POST | `/api/auth/logout` | 토큰 삭제 (게임 나가면 로그아웃) |
| GET | `/api/auth/me` | 프로필 + 이어하기용 저장 세션 목록 |

### 8-1. 게임 흐름

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/game/start` | 난이도 선택, 세션 생성, 240턴 날짜 생성 |
| GET | `/api/game/:sessionId` | 현재 현금, 총자산, 부채, 스트레스, 신뢰도, 턴 |
| GET | `/api/game/:sessionId/turn/:turnNumber` | 턴 데이터: 자산 시세, 뉴스, 상태, 상환 여부 |
| POST | `/api/game/:sessionId/trade` | 매수/매도. 서버가 체결 가능 여부, 평균단가, 실현손익 계산 |
| POST | `/api/game/:sessionId/next-turn` | 다음 턴 진행, 가격/뉴스/이벤트/상태 갱신, 자동저장 |
| POST | `/api/game/:sessionId/repay` | 20턴마다 월말 상환 처리. body `{ amount }` |
| GET | `/api/game/:sessionId/repay/history` | 상환 이력 |
| POST | `/api/game/:sessionId/event` | 선택형 이벤트 해결. body `{ eventLogId, choice, payload? }` (독촉전화 일부상환 = `payload.amount`) |
| GET | `/api/game/:sessionId/event/pending` | 선택 대기(미해결) 이벤트 목록 |
| GET | `/api/game/:sessionId/event/history` | 이벤트 이력 |
| GET | `/api/game/:sessionId/side-job/status` | 부업 가능 여부 + 게임 3종/보상표 |
| POST | `/api/game/:sessionId/side-job/play` | 미니게임 원점수 제출 `{ gameKey, rawScore }` -> 서버가 등급/보상 판정 |
| GET | `/api/game/:sessionId/side-job/history` | 부업 이력 |
| GET | `/api/game/:sessionId/surge/active` | 매수 가능한 급등주 조회 |
| POST | `/api/game/:sessionId/surge/buy` | 급등주 매수 `{ surgeStockId, amount }` (관망 = 미호출) |
| GET | `/api/game/:sessionId/log` | 거래/상환/이벤트 통합 타임라인 (기능명세서 §기록) |
| GET | `/api/game/:sessionId/result` | 최종 결산 |

### 8-2. 포트폴리오 / 리포트

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/game/:sessionId/portfolio` | 보유자산, 평가금액, 수익률, 자산군 비중 |
| GET | `/api/game/:sessionId/portfolio/pnl?period=&assetType=` | 기간별(일/주/월/연/전체)·자산군별·종목별 실현손익 (기능명세서 §자산) |
| GET | `/api/game/:sessionId/report/weekly/:weekIndex` | 주간 수익률 평가 (기획서 Weekly 평가서, LLM 연동 TODO) |
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
| GET | `/api/news/:date?sessionId=&category=` | 날짜별 뉴스. `sessionId` 전달 시 스트레스 열람 제한 + `news_exposure` 기록 |
| GET | `/api/news/:date/:assetId` | 날짜+자산별 뉴스 (해당일 이전 30건) |
| GET | `/api/macro/:date/history?code=&days=` | 지표 차트용 시계열 |
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
  "isMonthStart": false,
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
      "sector": "반도체",
      "price": 52400,
      "changeRate": 0.012
    }
  ],
  "news": [
    {
      "newsId": "market__2018-05-14__macro__0",
      "category": "market_macro",
      "date": "2018-05-14",
      "headline": "한국은행이 기준금리를 동결했다.",
      "lines": ["한국은행이 기준금리를 동결했다."],
      "eventType": "rate_move",
      "direction": "neutral",
      "strength": 4,
      "macroLabel": "기준금리",
      "assetId": null,
      "assetName": null
    }
  ],
  "newsLimit": 8,
  "actionLocked": false
}
```

뉴스 DTO는 NEWS_DATA_CONTRACT의 필드를 그대로 반영한다: `headline = news_lines[0]`, `lines = news_lines` 전문, 종목 뉴스는 `assetId`/`assetName`(마스킹명)으로 종목 화면에 라우팅한다.

## 9. 게임 로직

### 9-1. 턴 생성

- 게임 시작 시 `GAME_START_RANGE` 내 시작 거래일을 선택한다.
- 시작일부터 240거래일을 `game_turns`에 저장한다.
- 거래일 기준은 실제 가격 데이터가 존재하는 날짜다.
- 20, 40, ..., 240턴은 월말 상환 턴이다.

### 9-2. 턴 종료 순서

`turnService.advanceTurn`이 아래 전 과정을 단일 트랜잭션으로 실행한다(=자동저장).

1. 현재 턴 입력 검증 (종료 세션/240턴 초과 차단)
   - 직전 턴이 상환 턴(20의 배수)인데 상환 기록이 없으면 **자동 미납(ratio 0) 기록** — 기절 등으로 월말을 경과해도 미납 페널티(스트레스 +35 / 신뢰도 −25)가 반드시 반영된다 (`repaymentService.recordMissedIfUnpaid`, 응답의 `missedRepayment`)
2. 매수/매도 반영 (거래는 `tradeService`가 개별 트랜잭션으로 즉시 체결)
3. 다음 턴 가격 조회
4. **월초(21, 41, ...턴)면 월급 지급 + 생활비 차감** (기획서 §7. 생활비 수준별 스트레스 변화)
5. 보유자산 평가 + 자연 스트레스 변동
6. 이벤트 발생 여부 판단 (`eventEngine.rollTurnEvents`)
7. 신뢰도/스트레스/현금/행동제한 반영
8. 일간/주간 스냅샷 기록 (`session_snapshots`) 후 자동저장, 승패 판정

### 9-2-1. 월급 / 생활비 (기획서 §7 Monthly turn)

- 월초 턴에 월급 `MONTHLY_SALARY` 지급, 이번 달 생활비(`game_sessions.monthly_living_cost`) 차감.
- 생활비 < 최소기준: 굶주린 식사 -> 스트레스 상승 / > 최대기준: 호화로운 식사 -> 스트레스 하락 / 그 외 변화 없음.
- 금액·기준은 전부 `constants.js` (`LIVING_COST_*`)에서 밸런싱.

### 9-2-2. 주간 평가 (기획서 §7 Weekly 평가서)

- 5턴(1주) 주기로 weekly 스냅샷을 남기고 `GET /report/weekly/:weekIndex`가 지난주 수익률을 계산한다.
- LLM 평가문 생성은 `reportService.getWeeklyReport`의 TODO 지점에 연동한다 (거래이력+수익률 요약 -> 프롬프트).

### 9-3. 거래

- 서버가 현금, 보유수량, 현재 턴 가격으로 체결 가능 여부를 판단한다.
- 주식/채권은 정수 수량을 기본으로 검증한다.
- 코인은 소수 수량을 허용할 수 있도록 DB 수량 타입은 `NUMERIC`으로 둔다.
- 수수료는 0으로 시작하되, 추후 밸런싱 시 `constants.js`에서 변경한다.
- 평균단가와 실현손익은 서버에서 계산한다.

### 9-4. 스트레스 / 신뢰도 (미팅4·5 확정 수치 — `constants.js` 반영 완료)

**스트레스 (0-100)** — 심리 압박 수치화. 뉴스 내용은 바꾸지 않고 열람 가능 수만 줄인다. 신뢰도를 직접 깎지 않는다(판단 악화 -> 상환 실패 -> 신뢰도 하락의 간접 경로).

| 구간 | 스트레스 | 뉴스 열람 |
|---|---|---|
| 안정 | 0–29 | 10개 |
| 긴장 | 30–49 | 8개 |
| 불안 | 50–69 | 6개 |
| 고위험 | 70–89 | 4개 |
| 붕괴 직전 | 90–99 | 2개 |
| 기절 | 100 | 0개 (투자 불가) |

상승/하락 요인: 월말 상환 결과(아래 표), 독촉 전화(+8~+25), 일일 투자 손실(−5~−15%: +5 / −15% 초과: +12), 부업(+3~+17, 등급별), 생활비 수준, 경조사/명절/여행/투자 스터디, 급등주 결과(−20~+30).

**신뢰도 (0-100)** — 채권자가 보는 상환 신뢰 수준. 월말 상환 결과로만 변한다. 0이 되면 즉시 실패.

| 월말 상환 결과 | 스트레스 | 신뢰도 |
|---|---|---|
| 100% 초과 | −5 | +2 |
| 100% 납부 | 0 | 0 |
| 50~99% | +10 | −5 |
| 1~49% | +20 | −15 |
| 미납 | +35 | −25 |

독촉 전화 발생 확률(%) = **50 − 신뢰도×0.45** (하한 5 / 상한 50). 유형: 일반(51–100, +8) / 압박(31–50, +15) / 위협(11–30, +20) / 최후통첩(0–10, +25). 전화 팝업에서 즉시 일부 상환 입력 가능.

### 9-5. 이벤트 (미팅4·5 분류 체계 A~E)

이벤트는 서버 `eventEngine`의 `EVENT_DEFS` 레지스트리로 관리하고, 모든 결과는 `event_log`에 남긴다.

- **immediate(강제)**: 발생 즉시 효과 적용, `resolved=TRUE`. 프론트는 팝업 연출만.
- **choice(선택형)**: `resolved=FALSE` -> `EventPopup` 선택 -> `POST /event { eventLogId, choice, payload? }`. 미해결 시 턴 진행 잠금.

| 분류 | 이벤트 (`event_type`) | 트리거/내용 | 구현 상태 |
|---|---|---|---|
| A 플레이어 선택형 | `side_job` 부업 | 하루 1회, 미니게임 3종 진입, 입원 중 불가, 부업한 날 투자 불가 (§9-6) | **구현·검증** |
| B 랜덤 기회형 | `invest_study` 투자 스터디 | 수락/거절. 기본 스트레스 −6~−12 + 인사이트, 40% 방향성 힌트, 10% 희귀(−15+전조 힌트) | 구현 (힌트 실데이터 연동 TODO) |
| C 상태 연동형 | `loan_shark_call` 독촉 전화 | 확률 = 50−신뢰도×0.45, 유형 4단계, 팝업에서 일부 상환(payload.amount) | **구현** |
| C 상태 연동형 | `surge_stock` 급등주 | 구간별 확률(5/10/20/35/55%), 임시 작전주 등장 -> 매수/관망 -> 다음 턴 수익률 구간별 정산(−20~+30 스트레스) -> 자동 매도/제거 | **구현·검증** |
| D 외부 랜덤형 | `condolence` 경조사 | 결혼식/장례식/돌잔치/동창모임 4종. 거부 불가, 비용 확정 차감 + 스트레스 방향 랜덤 ±10 | 구현 |
| D 외부 랜덤형 | `holiday` 명절 | 설/추석 실제 달력(2013~2023, `HOLIDAY.DATES`) 기준 연휴 직후 첫 거래일에 1회 발동. 랜덤 결과: 사촌동생 용돈(지출) / 아늑한 우리집(스트레스 하락) | **구현·검증** |
| — | `travel` 여행 | 선택형: 현금 지출 + 스트레스 하락 | 구현 |
| E 강제 페널티형 | `faint` 기절·입원 | 스트레스 100 즉시. 3~5일 투자·부업 불가, 병원비 차감(부족분 부채 증가), 스트레스 0 리셋(신뢰도 유지), 입원 중 가격 변동 지속 | **구현** |
| (시스템) | `monthly_cashflow` / `repayment` / `surge_stock_result` | 월급·생활비 / 월말 상환 / 급등주 정산 기록 | **구현·검증** |

### 9-6. 부업 미니게임 (미팅5 §6 / 기능명세서 §부업)

- **규칙**: 하루 1회(`side_job_plays` UNIQUE), 입원 중 불가, **부업한 날은 투자 불가**(`game_sessions.side_job_turn`으로 tradeService가 차단).
- **판정**: 클라이언트는 원점수(`rawScore`)만 제출, 서버가 게임별 컷(`SIDE_JOB.SCORE_CUTS`)으로 등급 판정 -> 일당/스트레스 반영.
- **보상**: 기본급 × 배율 — 대성공 1.8/+3, 성공 1.5/+5, 보통 1.0/+10, 실패 0.6/+13, 대실패 0.2/+17.

| 게임 (`game_key`) | 내용 | 원점수 | 프론트 구현 |
|---|---|---|---|
| `catch_waxon` 왝슨을 잡아라 | 마우스로 날아다니는 왝슨 클릭 포획 (30초) | 포획 수 | `minigames/CatchWaxon.jsx` — 플레이 가능 |
| `avoid_professor` 교수님을 피해라 | 낙하 단어(대학원/과제...)를 ←→로 회피, 속도 점증 | 생존 시간(초) | `minigames/AvoidProfessor.jsx` — 플레이 가능 |
| `passenger_tetris` 노원03 테트리스 | 버스 승객 블록 쌓기, 줄 완성 시 하차 | 점수(줄 100 + 배치 4) | `minigames/PassengerTetris.jsx` — 플레이 가능 |

밸런싱(점수 컷/기본급)은 `constants.js`의 `SIDE_JOB`에서만 조정한다.

## 10. UI 화면

현재 디자인 기준 화면을 React 컴포넌트로 나눠 구현한다.

| 화면 | 역할 | 주요 API |
|---|---|---|
| 오프닝 | 스토리텔링 (배경/상황 제시, 스킵 가능) | - |
| 인트로/빚 설정 | 로그인/회원가입/이어하기(선택) + 난이도 선택, 세션 시작 | `/api/auth/*`, `POST /api/game/start` |
| 메인 화면 | 상태바, 날짜, 헤드라인, 메뉴, 다음 턴 | `GET /api/game/:sessionId`, `POST /next-turn` |
| 마켓 모달 | 랭킹, 업종, 지표, 자산군 필터 | `GET /api/assets`, `GET /api/macro/:date` |
| 종목 상세 | 차트, 뉴스, 종토방, 타입별 정보 | `GET /api/assets/:assetId`, `/prices`, `/news`, `/community` |
| 매수/매도 | 수량 입력, 예상금액, 확정 | `POST /api/game/:sessionId/trade` |
| 포트폴리오 | 보유자산, 평가손익, 비중, 수익분석 | `GET /api/game/:sessionId/portfolio` |
| 뉴스 | 필터, 상세, 관련 자산 연결 | `GET /api/news/:date` |
| 캘린더 | 과거 뉴스, 메모 CRUD | `/memo`, `news_exposure` |
| 이벤트 팝업 | 선택형/강제 이벤트 처리 (미해결 시 턴 진행 잠금, 독촉전화 상환액 입력) | `POST /api/game/:sessionId/event`, `/event/pending` |
| 부업 모달 | 미니게임 3종 선택/플레이/결과 (§9-6) | `/side-job/status`, `/side-job/play` |
| 급등주 팝업 | 등장(매수 금액 입력/관망) + 다음 턴 정산 연출 | `/surge/active`, `/surge/buy` |
| 상환 모달 | 상환 턴 상환액 입력, 결과 연출 | `POST /api/game/:sessionId/repay` |
| 주간/월간/최종 리포트 | 주간 평가, 20턴 정산, 엔딩 | `/report/weekly`, `/report/monthly`, `/report/final`, `/result` |

UI와 데이터 정합:

- 상태바는 `game_sessions`의 현금, 총자산 계산값, 부채, 스트레스, 신뢰도와 1:1로 맞춘다.
- 자산군 필터는 `assets.asset_type`을 사용한다.
- 종목 상세의 정보 탭은 자산 타입별 테이블을 사용한다.
- 차트는 `asset_prices`를 기본으로 쓰고, 상세 지표가 필요한 경우 타입별 상세 시세를 추가 조인한다.
- 뉴스 열람 제한은 서버 응답의 `newsLimit`과 `news_exposure` 기준으로 표시한다.

## 11. 서비스 책임

| 서비스 | 책임 |
|---|---|
| `gameService` | 세션 생성/상태 DTO/승패 판정/최종 결산 |
| `turnSelector` | 시작일 선택, 240거래일 생성 |
| `turnService` | 턴 데이터 조회, next-turn 오케스트레이션(월초 현금흐름·이벤트·스냅샷·자동저장) |
| `pricingService` | 현재가, 기간 시세, 종목 목록/상세(타입별 정보 탭) |
| `tradeService` | 거래 검증, 체결, 평균단가, 실현손익 (세션 행잠금) |
| `valuationService` | 총자산, 순자산, 수익률, 자산군 비중 |
| `stressPolicy` | 스트레스 증감, 뉴스 제한, 기절 조건, 생활비 스트레스 |
| `trustPolicy` | 신뢰도 증감, 독촉전화 확률, 상환 효과 |
| `repaymentService` | 월말 상환금 계산, 상환 결과 반영, 전액상환 클리어 |
| `eventEngine` | `EVENT_DEFS` 관리, 발생 판단, 선택형 해결, `event_log` 기록 |
| `newsService` | 계약 DTO 변환, 스트레스 열람 제한, `news_exposure` 기록 |
| `macroService` | 거시지표 당일값/전일대비/시계열 |
| `communityService` | 종토방 게시글/댓글 (과거분만 노출) |
| `memoService` | 캘린더 메모 CRUD |
| `reportService` | 주간/월간/최종 리포트, `session_snapshots` 기록, LLM 연동 지점 |
| `authService` | 회원가입/로그인/토큰/프로필/이어하기 (scrypt, 게스트 허용) |
| `sideJobService` | 부업 미니게임 등급 판정(서버 권위), 보상/스트레스, 당일 투자 잠금 |
| `surgeStockService` | 급등주 등장 확률/매수/다음 턴 수익률 정산/자동 제거 |
| `maskingService` | 회사명 가명 처리, 조사 보정 (사전 확정 TODO) |

## 12. 개발 마일스톤

| Phase | 목표 | 기준 | 상태 (2026-07-07) |
|---|---|---|---|
| P0 | DB 스키마, Docker, 서버 부트스트랩 | 24테이블 migration, health check | **완료·검증됨** |
| P1 | 데이터 적재 | 131자산, 시세, 재무, 거시, 뉴스, 종토방 stub/실데이터 | 스텁 완료 / 실데이터 적재기 구현 (매핑 TODO 4건, §6-0) |
| P2 | 게임 코어 | 세션, 240턴, 현재가, 매수/매도, 평가, 자동저장 | **완료·검증됨** |
| P3 | 상태/상환 | 스트레스, 신뢰도, 월말상환, 승패, 월급/생활비 | 구현 완료 (밸런싱 곡선 TODO) |
| P4 | 이벤트 | 이벤트 엔진(A~E), `event_log`, 행동제한, 급등주, 독촉전화 4단계 | **구현·검증** (명절 달력·스터디 힌트 실데이터 TODO) |
| P4.5 | 부업 미니게임 | 왝슨/교수님/테트리스 3종 + 서버 판정 + 투자 잠금 | **구현·검증** (점수 컷 밸런싱 TODO) |
| P4.6 | 회원관리 | 회원가입/로그인/프로필/이어하기 (게스트 허용) | **구현·검증** |
| P5 | 프론트 | 오프닝/인트로/메인/마켓/상세(기술지표)/포트폴리오(수익분석)/뉴스/캘린더/거래/이벤트/부업/급등주/리포트 | 전 화면 구현·API 연동 (디자인 시안 미적용) |
| P6 | 리포트/밸런싱 | 주간/월간/최종 리포트, LLM 분석, 난이도 조정 | 리포트 계산 구현 (LLM 연동·밸런싱 TODO) |

남은 작업(코드 채워넣기 지점)은 저장소 전체에서 `TODO(gamelogic)` / `TODO(data)` / `TODO(frontend)` 주석으로 검색된다.

## 13. 검증 기준

2026-07-07 스캐폴드 기준 전 항목 통과 확인:

- [x] `docker-compose up -d` 후 DB와 API가 기동해야 한다.
- [x] `server/migrations/001_init.sql`은 빈 PostgreSQL 16에서 재실행 가능해야 한다. (24테이블 생성 확인)
- [x] `node seeds/import_all.js --stub`로 최소 개발 데이터가 적재되어야 한다. (29자산/300거래일/뉴스 1,600여 건)
- [x] `/health`가 200을 반환해야 한다.
- [x] 게임 시작 후 240개 `game_turns`가 생성되어야 한다.
- [x] 기본 게임 플로우 테스트: 시작 -> 턴 조회 -> 매수 -> 19턴 진행 -> 매도(실현손익) -> 상환(신뢰도 반영) -> 뉴스 제한 -> 메모 -> 월간/주간 리포트 순서로 통과.
- [x] API 응답에는 마스킹 전 회사명이 노출되지 않아야 한다. (`masked_name`만 응답)
- [x] 회원가입 -> 로그인 -> 세션 계정 연결 -> 프로필/이어하기 목록 조회 통과.
- [x] 부업: 미니게임 플레이 -> 원점수 제출 -> 서버 등급 판정 -> 보상/스트레스 반영 -> 당일 투자 차단 -> 하루 1회 제한 통과 (브라우저 E2E 포함).
- [x] 급등주: 등장 -> 매수 -> 다음 턴 자동 정산(수익률/스트레스) -> 제거 통과.

## 13-1. 기획 문서 참조 (Drive)

| 문서 | 내용 |
|---|---|
| 260331 미팅(3) 기획서 | 게임 개요/자산구성/데일리·먼슬리 턴 (레포 로컬: `data-pipeline/기획서/`) |
| 260414 미팅(4) 기획서 | 스트레스 로직 확정 수치, 이벤트 분류 A~E, 뉴스 처리 6단계 |
| 260504 미팅(5) 기획서 | 신뢰도 로직, 독촉전화 4단계, 급등주 플로우, **미니게임 3종**, 재무비율/기술지표 |
| ANT SURVIVAL 중간보고서 | 최종 스코프(240턴/131자산/부업 메뉴/휴장일·부업일 투자 불가) |
| 기능명세서 시트 | 전체 기능 분해 (회원/시작/메인/시스템/투자/정보/자산/부업/이벤트/리포트/기록/종료) — 시트 ID `1TAJb1DCmziqrI1oDUH4OGS9hsKqc6k-Dts1W2xiqXlE` |
| 태스크플로우 (draw.io) | 전체 플로우차트 — Drive 파일 `1dJZf_wEUi3nj_meMN-PTIla27uE4mEYD` |

## 14. 단일 문서 운영 규칙

- 아키텍처, 기술스택, DB, API, UI 기준 변경은 이 파일에만 반영한다.
- 별도 설계 Markdown을 추가하지 않는다. 필요하면 이 파일에 섹션을 추가한다.
- 예외: [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)는 설계 문서가 아니라 **실행·운영·진행 순서 가이드**다 (서버 기동/시드/배포 절차, 로드맵, TODO 현황). 설계 내용이 그 문서에 들어가면 안 된다.
- 구현 파일의 주석은 이 문서 섹션 번호를 참조할 수 있다.
- 프로토타입 기준(4종목, 5턴, 100만 원)은 테스트 fixture 외에는 사용하지 않는다.
