# 동학개미 서바이벌 (ANT SURVIVAL) 아키텍처

> 이 문서가 레포의 단일 기준 문서다. 기존 `TECH_STACK*`, `ARCHITECTURE_revised`, `UI_SCREENS`, `DEVELOPMENT_PIPELINE` 내용은 본 문서로 통합하고 삭제했다.

## 1. 제품 스코프

실제 금융데이터 기반 턴제 투자 시뮬레이션 게임이다. 플레이어는 240평일 턴을 진행하며 자산을 매매하고, 스트레스와 신뢰도를 관리하면서 부채를 상환한다. 주말은 건너뛰고 평일 휴장일은 비거래 행동용 턴으로 유지한다.

| 항목 | 기준 |
|---|---|
| 게임 기간 | 240턴, 1턴=평일 하루, 20턴=1개월 (평일 휴장일에는 거래만 불가) |
| 게임 시작 구간 | 2014-01-02 ~ 2023-12-31 중 랜덤 (2013년치는 룩백 버퍼, §9-1) |
| 투자 자산 | 세션당 131개: 주식 117, 채권 4, 코인 10 (코인은 세션마다 랜덤 층화추출, §9-7) |
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
│   │   ├── 002_members_minigames.sql # 회원/부업/급등주 (+4테이블, 28테이블)
│   │   ├── 003_final_data_alignment.sql  # 종토방 스레드/상장기간/원문보존/is_forced
│   │   ├── 004_widen_asset_code.sql      # assets.code -> VARCHAR(64)
│   │   └── 005_session_coin_universe.sql # 세션별 코인 10종 (+1테이블, 29테이블)
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
│           ├── turnSelector.js   # 시작 개장일 선택, 240평일 턴 생성
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
GAME_START_RANGE=2014-01-02..2023-12-31
DATA_DIR=/path/to/data-pipeline
```

`GAME_START_RANGE`는 **게임 시작일이 뽑히는 구간**이지 데이터 범위가 아니다. 적재 데이터는
2013-01-02부터 있고, 2013년치는 어느 시점에서 플레이해도 1년 전 뉴스·시세를 조회할 수 있게
하려고 남겨둔 **룩백 버퍼**다. 미지정 시 `constants.js`의 `START_RANGE`(2014-01-02..2023-12-31)를
쓴다 — `DATA_RANGE`(2013-01-02..)와 혼동하지 말 것.

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
| 종토방 | `npc_generator/data/processed/dci_board_rewritten/board_threads_validated_final_screened.jsonl` | **스레드 2,501건.** 혐오발언 스크리닝+봇 제거+닉네임 재부여 완료본. `target_kind`/`target_id`로 자산 직접 매핑 | `import_community.js` |
| 마스킹 사전 | `data/processed/rename_map/{stock,coin,alias}_rename_map.csv` | 실명→가명 정본. 그룹 어간(`group_stem_*`) 포함 (§6-1) | `apply_masking.js` |
| 주식 재무/밸류에이션 | (DataGuide 반기 재무 — 파일 미확정) | `stock_financials`/`stock_valuation` 스키마 준비됨 | TODO |

미확정/잔여: ① 반기 재무 원본 ② npq 수급 시트 매핑 ③ `rename_map`의 `group_stem_masked` 7건이 어간이 아니라 종목 가명 전체로 들어가 있음(한화→`운강에어로스페이스`, 한진→`초원홀딩스`, 신한→`명한지주`, 미래에셋, HL, 티와이, KT라틴) — "한화솔루션"이 "운강에어로스페이스솔루션"이 된다. 데이터 담당 수정 대상.

해소됨: 거시뉴스 재생성본 교체 / 마스킹 사전 확정 / 갤러리-종목 매핑(`target_id`로 대체, 2,501건 전부 매칭).

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

### 6-1. 마스킹

정본 사전은 `data-pipeline`의 `data/processed/rename_map/` 3종이다 — `stock_rename_map.csv`(117),
`coin_rename_map.csv`(1,267), `alias_rename_map.csv`. 게임 레포는 이 사전을 읽기만 한다.

**실효 지점은 ETL이다.** 데이터 파이프라인도 원천 JSONL에 마스킹을 적용하지만, ETL이 백스톱을
겸하고 사전 갱신 시 재적재만으로 반영되며 원문도 `raw_*` 컬럼에 남는다. 그래서 `maskText`는
**멱등**이다 — 원천이 마스킹됐든 안 됐든 결과가 같다.

`maskText` 처리 순서 (`src/services/maskingService.js`):

1. **토큰 해석** — 종토방 산출물의 `{{STOCK_<코드>}}` / `{{COIN_<id>}}`를 가명으로 치환한다(코인은 한글 문맥이라 `ko_name`). 삽입 구간은 보호 스팬으로 잠가 2단계에서 재치환되지 않게 한다.
2. **이미 가명인 구간 보호** — 원천이 이미 마스킹된 경우 가명 안의 부분문자열이 짧은 별칭에 재매칭되는 것을 막는다(실측: "대진가스공사"의 "가스공사"가 걸려 "대진대진가스"가 되던 이중 치환).
3. **실명·별칭·그룹 어간 치환** — 최장일치 우선 비중첩 선택. 개별 종목명 → 별칭 → 그룹 어간 순.
4. **조사 보정** — 치환으로 받침이 바뀌면 뒤따르는 조사(을/를, 이/가, 은/는, 과/와)를 고친다.

**그룹 어간 치환이 핵심이다.** rename_map이 어간 방식(삼성→유원, LG→해린, SK→태서)이라
그룹 단독명을 치환에서 빼두면 같은 문서에 실명 그룹명과 계열사 가명이 나란히 남아 대응 관계가
드러난다. 최장일치 우선으로 "삼성전자"→"유원전자"를 먼저 걸고 잔여 "삼성"→"유원"을 적용하면,
유니버스 밖 계열사(삼성전자·현대차 등)와 제품명(카카오톡→코니톡)까지 사전 등록 없이 덮인다.
적용 전후 역추적 가능 문서는 250건 → 4건이다(잔여 3건은 "SKY 졸업"·"전효성" 같은 무관 단어를
예외 규칙이 회피한 것).

라틴 약어(SK/LG/GS/DL)는 대소문자 구분 + 단어 경계로 오탐을 막고, `SKY`/`KTB`/`HLB`/`USGS` 등은
예외 목록으로 처리한다. 반대로 `LGD`/`LGES`/`GSC`는 실제 계열사 약어라 치환 대상이다.
"현대화"·"현대적"처럼 회사가 아닌 낱말은 전 코퍼스 196종을 검토해 7개만 블랙리스트로 뒀다
(화이트리스트가 아닌 이유: 사전에 없는 계열사까지 자동으로 덮는 것이 이 기능의 목적이다).

원칙: **게임 화면과 API 응답에는 원 회사명이 노출되지 않아야 한다.** `assets.name`은 내부용
원문이고 응답에는 `masked_name`만 나간다.

## 7. DB 스키마

최종 스키마는 **29개 테이블**이다 (초안 23 + `session_snapshots` + 회원 2종 + 부업/급등주 2종 + `session_coin_universe`). 자산 타입별 가격 구조가 달라 공통 거래/평가 테이블과 타입별 상세 테이블을 분리한다.

**실행 가능한 전체 DDL은 migration 파일이 단일 기준이다:**

| 파일 | 내용 |
|---|---|
| [`001_init.sql`](server/migrations/001_init.sql) | 기본 24테이블 DDL + 채권/거시지표 시드 |
| [`002_members_minigames.sql`](server/migrations/002_members_minigames.sql) | `users`, `auth_tokens`, `side_job_plays`, `surge_stocks` + `game_sessions.user_id/side_job_turn` |
| [`003_final_data_alignment.sql`](server/migrations/003_final_data_alignment.sql) | 종토방 스레드 구조, `assets.listed_from/listed_to`, 마스킹 원문 보존, `trades.is_forced` |
| [`004_widen_asset_code.sql`](server/migrations/004_widen_asset_code.sql) | `assets.code` VARCHAR(30) → (64). coingecko id가 최대 44자 |
| [`005_session_coin_universe.sql`](server/migrations/005_session_coin_universe.sql) | `session_coin_universe` — 세션별 코인 층화추출 결과 |
| [`006_surge_stock_integrity.sql`](server/migrations/006_surge_stock_integrity.sql) | 급등주 정수 수량·체결/정산 시각·무결성 제약·세션별 미정산 1건 제한 |
| [`007_quant_opponent.sql`](server/migrations/007_quant_opponent.sql) | 세션별 퀀트 모델 hash 고정 |
| [`008_quant_ohlcv.sql`](server/migrations/008_quant_ohlcv.sql) | 실제 주식 OHLC·거래대금·VWAP 추가 |
| [`009_pending_market_orders.sql`](server/migrations/009_pending_market_orders.sql) | 유저·퀀트 예약 주문 및 체결 이력 연결 |
| [`010_adjusted_stock_prices.sql`](server/migrations/010_adjusted_stock_prices.sql) | 수정가격 배율·학습용 거래량·활성 시장 데이터 버전 |

이 문서에는 테이블 그룹, 핵심 관계, 설계 원칙만 남긴다. DB 변경은 migration 파일을 먼저 수정하고, 이 문서는 변경 의도와 구조 요약만 갱신한다.

**003~006 확정 변경 (실데이터 적재 검증 반영):**

1. **종토방을 스레드 구조로 재설계.** 원천이 평면 CSV(`dci_posts_ready.csv`)에서 스레드 JSONL(`board_threads_validated_final_screened.jsonl`, 2,501스레드)로 바뀌었다. `thread_uid`(자연키·멱등 재적재), `target_kind`(stock|coin), `target_id`, `candidate_type`, `author_key`, 댓글 `seq`/`commented_at` 추가. `target_id`로 `asset_id`를 직접 매핑하므로 **갤러리-종목 매핑 TODO는 소멸했다**(2,501건 전부 매칭). 재작성 산출물에 없는 `view_count`/`recommend_count`/`dislike_count`는 DEFAULT 0을 제거해 미측정(NULL)과 실제 0을 구분한다.
2. **`assets.listed_from`/`listed_to` 승격.** 상장기간을 자산 공통 컬럼으로 올려 거래 차단·강제청산·목록 노출이 전부 같은 기준을 본다. 타입별 분기(`coin_info` 조인) 불필요. `seeds/finalize_listing_range.js`가 `asset_prices` 실측 min/max로 채운다.
3. **마스킹 원문 보존.** `news.raw_news_lines`, `community_posts.raw_title/raw_body`, `community_comments.raw_body`. 사전이 갱신되면 재적재만으로 반영된다.
4. **`trades.is_forced`** — 시스템 강제청산과 플레이어 주문을 구분한다(실현손익 집계에는 함께 포함).
5. **`session_coin_universe`** — 코인은 참조 유니버스 1,267개 중 세션마다 10개를 층화추출한다(§9-7). 전역 플래그(`is_active`)로는 표현할 수 없어 세션 단위로 영속화한다.
6. **급등주 체결 무결성** — `quantity`, `purchased_at`, `resolved_at`을 저장하고 양수 가격·0 이상 수량/투자액 제약과 세션별 미정산 1건 UNIQUE 인덱스를 적용한다.

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
| 세션 자산범위 | `session_coin_universe` | 세션별 거래 가능 코인 10종 (층화추출 결과, §9-7) | API |

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
| `asset_prices` | `(asset_id, trade_date)` | `asset_id` | `close_price`, `change_rate`, `currency` | 장 마감 정보·평가 가격 |
| `stock_price_detail` | `(asset_id, trade_date)` | `asset_id` | OHLC, VWAP, 거래량/대금, 수급, 유동주식, 시총 | 주식 상세 정보와 실제 시가 체결 (008에서 quant_data 추가) |
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

전체 DDL은 `server/migrations/` 6개 파일이다(§7 표). 001이 기본 24테이블 + 인덱스 + 채권/거시지표 시드,
002~006이 증분 변경이다. 빈 PostgreSQL에서 파일명 순서대로 재실행 가능하며, 새 DB 볼륨을 처음
기동할 때만 자동 실행된다. 기존 볼륨은 새 migration을 수동 적용해야 한다(§13-1에서 001~006 순차 검증).

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
| POST | `/api/game/:sessionId/trade` | 다음 개장일 시가 주문 예약. `orderKey`로 중복 요청 방지 |
| GET | `/api/game/:sessionId/orders` | 최근 유저 주문 상태·요청/체결 수량·체결가 |
| DELETE | `/api/game/:sessionId/orders/:orderId` | 체결 전 유저 주문 취소 |
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
| POST | `/api/game/:sessionId/surge/buy` | 급등주 매수 `{ surgeStockId, quantity }` (이벤트 가격 × 정수 수량, 관망 = 미호출) |
| GET | `/api/game/:sessionId/log` | 거래/상환/이벤트 통합 타임라인 (기능명세서 §기록) |
| GET | `/api/game/:sessionId/result` | 최종 결산 |

### 8-2. 포트폴리오 / 리포트

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/game/:sessionId/portfolio` | 보유자산, 평가금액, 수익률, 자산군 비중 |
| GET | `/api/game/:sessionId/portfolio/history` | 턴별 총자산·순자산과 초기자본 대비 수익률 추이 |
| GET | `/api/game/:sessionId/portfolio/dashboard?unit=&assetType=` | 전체/주식/채권/코인별 구성과 일(1턴)/주(5턴)/월(20턴)/전체 단위 순수 손익금액·수익률 |
| GET | `/api/game/:sessionId/portfolio/pnl?period=&assetType=` | 기간별(일/주/월/연/전체)·자산군별·종목별 실현손익 (기능명세서 §자산) |
| GET | `/api/game/:sessionId/report/weekly/:weekIndex` | 주간 수익률 평가 (기획서 Weekly 평가서, LLM 연동 TODO) |
| GET | `/api/game/:sessionId/report/monthly/:monthIndex` | 월간 리포트 |
| GET | `/api/game/:sessionId/report/final` | 최종 리포트 |

### 8-3. 자산 / 시장 데이터

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/assets?type=&sort=&date=&sessionId=` | 종목 목록, 자산군 필터, 거래량/상승률/거래대금 정렬. **`sessionId` 필수(코인)** — 코인은 세션마다 다른 10종이라 세션을 모르면 빈 배열을 반환한다. 주식/채권은 전역이라 무관 |
| GET | `/api/assets/:assetId` | 종목 상세, 타입별 정보 |
| GET | `/api/assets/:assetId/prices?from=&to=&unit=` | 차트용 전체 기간 시세. `unit=day|week|month` |
| GET | `/api/macro/:date` | 기준금리, 환율, CPI, 국채, WTI, 금, 경기선행지수 |

### 8-4. 뉴스 / 종토방 / 메모

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/news/:date?sessionId=&category=&referenceDate=` | 날짜별 뉴스. `sessionId` 전달 시 스트레스 열람 제한 + `news_exposure` 기록. `category`는 호환용 선택 파라미터이며 게임 UI는 넘기지 않는다. `referenceDate`는 과거 뉴스를 다시 볼 때도 현재 게임 턴을 상대연도 기준으로 유지한다. |
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
  "marketOpen": true,
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

뉴스 DTO는 NEWS_DATA_CONTRACT의 필드를 그대로 반영한다: `headline = news_lines[0]`, `lines = news_lines` 전문, 종목 뉴스는 `assetId`/`assetName`(마스킹명)으로 종목 화면에 라우팅한다. 화면에 노출되는 뉴스 문구의 명시적 절대연도는 조회 시점의 게임 날짜를 현재로 삼아 상대 표현(`n년 전`·`올해`·`향후 연도`)으로 치환한다. 구조 식별에 필요한 ISO 날짜와 뉴스 ID, DB 원문은 바꾸지 않고 프론트에서 현재 턴 날짜를 기준으로 과거 연도는 `n년 전 MM/DD`, 같은 게임 연도는 `MM/DD`로 표시한다.

## 9. 게임 로직

### 9-1. 턴 생성

- 게임 시작 시 `GAME_START_RANGE`(기본 2014-01-02..2023-12-31) 내 실제 주식 개장일을 첫날로 랜덤 선택한다.
- 시작일부터 주말을 제외한 240평일을 `game_turns`에 저장한다.
- 평일 휴장일도 턴으로 유지하고 `marketOpen=false`로 내려준다. 이 날은 모든 자산 거래와 급등주 매수·정산만 막고 부업·뉴스·메모·상환 등은 허용한다.
- 달력은 세션 생성 시 확정되며 기존 `game_turns`를 자동 재작성하지 않는다. 규칙 변경 전 저장 세션의 이관·무효화는 운영 정책으로 별도 결정한다.
- 20, 40, ..., 240턴은 월말 상환 턴이다.
- **2013년은 시작 구간이 아니다.** 어느 시점에서 플레이해도 1년 전 뉴스·시세를 조회할 수 있게
  하려고 남긴 룩백 버퍼다. 코인도 2013년에는 유니버스에 2종뿐이라 게임이 성립하지 않는다.
- 시작 구간 안에 첫날과 마지막 날이 개장일인 240평일 구간이 없으면 조용히 넘어가지 않고 에러를 던진다.

### 9-2. 턴 종료 순서

`turnService.advanceTurn`이 아래 전 과정을 단일 트랜잭션으로 실행한다(=자동저장).

1. 현재 턴 입력 검증 (종료 세션/240턴 초과 차단)
   - 직전 턴이 상환 턴(20의 배수)인데 상환 기록이 없으면 **자동 미납(ratio 0) 기록** — 기절 등으로 월말을 경과해도 미납 페널티(스트레스 +35 / 신뢰도 −25)가 반드시 반영된다 (`repaymentService.recordMissedIfUnpaid`, 응답의 `missedRepayment`)
2. 장 마감 t에 예약한 유저·퀀트 주문 확정 (`market_orders`). 퀀트 버튼을 누르지 않아도 자동 생성한다.
3. 다음 턴으로 이동 → 상장폐지 청산 → 개장일이면 예약 주문을 **시가**로 체결(매도 먼저). 휴장이면 주문을 유지한다. 종가는 이후 평가에만 사용한다.
4. **월초(21, 41, ...턴)면 월급 지급 + 생활비 차감** (기획서 §7. 생활비 수준별 스트레스 변화)
5. 보유자산 평가 + 자연 스트레스 변동
6. 이벤트 발생 여부 판단 (`eventEngine.rollTurnEvents`)
7. 신뢰도/스트레스/현금/행동제한 반영
8. 일간/주간 스냅샷 기록 (`session_snapshots`) 후 자동저장, 승패 판정
   - 240턴 **도착 시점에는 게임이 끝나지 않는다** — 마지막 거래일(12개월차 상환 턴)을 플레이할 수 있다. 240턴 상태에서 next-turn을 누르면 그때 최종 판정(미상환이면 자동 미납 기록 후 실패, 부채 0이면 성공)

### 9-2-1. 월급 / 생활비 (기획서 §7 Monthly turn)

- 월초 턴에 월급 `MONTHLY_SALARY` 지급, 이번 달 생활비(`game_sessions.monthly_living_cost`) 차감.
- 생활비 < 최소기준: 굶주린 식사 -> 스트레스 상승 / > 최대기준: 호화로운 식사 -> 스트레스 하락 / 그 외 변화 없음.
- 금액·기준은 전부 `constants.js` (`LIVING_COST_*`)에서 밸런싱.

### 9-2-2. 주간 평가 (기획서 §7 Weekly 평가서)

- 5턴(1주) 주기로 weekly 스냅샷을 남기고 `GET /report/weekly/:weekIndex`가 지난주 수익률을 계산한다.
- LLM 평가문 생성은 `reportService.getWeeklyReport`의 TODO 지점에 연동한다 (거래이력+수익률 요약 -> 프롬프트).

### 9-3. 거래

- 유저와 퀀트 모두 t일 장 마감 정보로 예약하고 다음 개장일 Open으로 체결한다. 매수·매도 예약은 현금·보유를 즉시 바꾸지 않는다. 동일 종목 대기 주문은 취소 후 다시 예약한다.
- 현재 지원 자산은 **주식(양의 정수 수량)**이다. 실제 시가가 없는 채권·코인은 자료 확보 전까지 매수·매도 주문을 차단한다. **가상 급등주는 별도 이벤트 규칙을 유지**한다.
- 주문할 때 최대 수량과 종가 기준 매수 예산을 고정한다. 매도 예약의 예상 대금은 매수 예약 예산에 포함할 수 있다. 실제 체결은 매도 → 종목 ID 순 매수이며, 예산·실제 현금이 부족하면 가능한 수량만 체결하고 잔량은 취소한다. 시가가 없는 개별 종목 주문은 거절하며 종가로 대체하지 않는다.
- `market_orders`(009)에 결정/체결 턴·날짜·요청/체결 수량·예산·상태를 저장한다. `orderKey` 재전송은 동일 결과를 반환하고 `trades.order_id`는 중복 체결을 막는다. 취소는 체결 전만 가능하며 게임 종료 시 대기 주문을 모두 취소한다. 마지막 턴에는 새 주문을 받지 않는다.
- 수량은 트랜잭션 진입 전에 검증한다(유한한 양수·`buy|sell`). DB `CHECK` 제약에 의존하면 400이어야 할 것이 500으로 나간다.
- **상장기간 검증**: `assets.listed_from` 이전 / `listed_to` 이후는 거래를 차단하고, 휴장·결측과 구분되는 메시지를 낸다.
- 채권의 기존 보유분은 `asset_prices.close_price` 가격지수로 평가한다. 신규 체결은 시가 자료 확보 전까지 중단한다.
- **체결금액 반올림**은 `src/utils/money.js` 한 곳에서만 한다. 매수 `ceil` / 매도 `floor` — 두 방향 모두 시스템이 실제 가치보다 많은 현금을 만들지 않는 쪽이다(반대로 하면 극소액 반복매매로 차익이 생긴다). 강제청산도 매도이므로 `floor`. 반올림된 금액을 `trades.amount`·현금 증감·`realized_pnl`에 동일하게 재사용해 세 값이 항상 정합한다.
- 수수료는 0으로 시작하되, 추후 밸런싱 시 `constants.js`에서 변경한다.
- 평균단가와 실현손익은 서버에서 계산한다.
- 코인 유니버스 규칙(§9-7)은 조회에 유지되며, 현재 주문 차단 규칙이 기존 매매 허용 규칙보다 우선한다.

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

독촉 전화 발생 확률(%) = **20 − 신뢰도×0.15** (하한 5 / 상한 20). 유형: 일반(51–100, +8) / 압박(31–50, +15) / 위협(11–30, +20) / 최후통첩(0–10, +25). 전화 팝업에서 즉시 일부 상환 입력 가능.

### 9-5. 이벤트 (미팅4·5 분류 체계 A~E)

이벤트는 서버 `eventEngine`의 `EVENT_DEFS` 레지스트리로 관리하고, 모든 결과는 `event_log`에 남긴다.

- **immediate(강제)**: 발생 즉시 효과 적용, `resolved=TRUE`. 프론트는 팝업 연출만.
- **choice(선택형)**: `resolved=FALSE` -> `EventPopup` 선택 -> `POST /event { eventLogId, choice, payload? }`. 미해결 시 턴 진행 잠금.

| 분류 | 이벤트 (`event_type`) | 트리거/내용 | 구현 상태 |
|---|---|---|---|
| A 플레이어 선택형 | `side_job` 부업 | 하루 1회, 미니게임 3종 진입, 입원 중 불가, 부업한 날 투자 불가 (§9-6) | **구현·검증** |
| B 랜덤 기회형 | `invest_study` 투자 스터디 | 수락/거절. 기본 스트레스 −6~−12 + 인사이트, 40% 방향성 힌트, 10% 희귀(−15+전조 힌트) | 구현 (힌트 실데이터 연동 TODO) |
| C 상태 연동형 | `loan_shark_call` 독촉 전화 | 확률 = 20−신뢰도×0.15 (5~20%), 유형 4단계, 팝업에서 일부 상환(payload.amount) | **구현** |
| C 상태 연동형 | `surge_stock` 급등주 | 구간별 확률(2/4/7/10/15%), 개장일 임시 작전주 등장 -> 매수/관망 -> 다음 개장 턴 수익률 구간별 정산(−20~+30 스트레스) -> 자동 매도/제거 | **구현·검증** |
| D 외부 랜덤형 | `condolence` 경조사 | 결혼식/장례식/돌잔치/동창모임 4종. 거부 불가, 비용 확정 차감 + 스트레스 방향 랜덤 ±10 | 구현 |
| D 외부 랜덤형 | `holiday` 명절 | 설/추석 실제 달력(2013~2023, `HOLIDAY.DATES`) 기준 평일 명절은 당일, 주말 명절은 다음 평일에 1회 발동. 랜덤 결과: 사촌동생 용돈(지출) / 아늑한 우리집(스트레스 하락) | **구현·검증** |
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

### 9-7. 코인 세션 유니버스 (층화추출)

`assets`에는 코인이 **1,267개** 들어간다. 이건 종토방/뉴스 본문이 어떤 코인이든 언급할 수 있어야
하는 **참조 유니버스**다. 게임이 거래 대상으로 노출하는 코인은 **세션마다 새로 뽑는 10개**다 —
플레이어가 새 게임을 시작할 때마다 다른 코인이 뜬다. 주식 117 / 채권 4는 전역 고정이다.

전역 플래그(`assets.is_active`)로는 세션별 차이를 표현할 수 없어 `session_coin_universe`(005)에
영속화한다. 시드만 저장하고 매번 재계산하면 유니버스 데이터가 갱신됐을 때 같은 시드로도 다른
결과가 나와 **이어하기가 깨지므로** 결과 자체를 저장한다.

**추출 규칙** (`src/services/coinUniverseService.js`)

| 항목 | 기준 |
|---|---|
| 후보 | 세션 240평일 전 기간에 걸쳐 상장 상태 유지 (`listed_from <= 첫날 AND listed_to >= 마지막날`) |
| 가격 하한 | 기간 내 첫 종가가 `COIN_MIN_PRICE_KRW`(100원) 이상 |
| 쿼터 | mega 2 / large 2 / mid 3 / small 3 = 10 (`coin_info.market_cap_tier`) |
| 티어 미달 | 남는 자리를 잔여 후보 풀에서 티어 무관 보충 |

가격 하한이 필요한 이유: 현금이 정수 원 단위라 1원 미만은 매수/매도 금액이 0원으로 뭉개져
거래가 성립하지 않고(실측: 8.5e-7원 코인 100개 매수 1원 / 매도 0원), 1~99원대는 가격 해상도가
없다(1원 → 2원 = +100%).

**완화 사다리** — 후보가 10개에 못 미치면 조건을 단계적으로 푼다.

1. 전 기간 생존 + 가격 하한 (기본)
2. **기간 중 존재**로 완화 (도중 상장/도중 폐지 허용) + 가격 하한 유지
3. 가격 하한까지 해제

기간 조건을 먼저 푸는 이유는 실측 때문이다 — 2013~2014년은 저가 코인 문제가 아니라 코인 자체가
없어서 하한을 풀어도 후보가 늘지 않는다(2014년: 전 기간 생존 8종 → 기간 중 존재 26종).
2단계로 들어온 코인은 런타임이 이미 처리한다: 상장 전에는 `tradeService`가 매수를 막고,
폐지 시점에는 §9-8 강제청산이 보유분을 정리한다. 마지막 단계까지 가도 부족하면 있는 만큼
진행한다(에러 아님). 완화가 걸리면 `[coinUniverse] 완화단계=... 후보=... 선택=...` 로그가 남는다.

### 9-8. 상장폐지 강제청산

코인 10종 중 일부는 게임 기간 도중 시세가 끊긴다(`assets.listed_to`). 마지막 가격으로 고정
평가하면 팔 수 없는 좀비 자산이 포트폴리오에 영원히 남으므로 **자동 청산**한다.

- `turnService.advanceTurn`의 **다음 턴 가격 조회 직후, 보유자산 평가 이전**에 실행한다.
  순서가 어긋나면 청산된 자산이 그 턴 평가·스냅샷에 잡힌다.
- 마지막 시세로 전량 매도하고 `trades`에 `trade_type='sell'`, `is_forced=TRUE`로 기록한다.
  실현손익이 계산되므로 리포트 집계에 자연히 포함된다.
- `event_log`에 `asset_delisted`를 남기고, `advanceTurn` 응답의 `forcedLiquidations`로 프론트가 알림을 띄운다.
- 전 과정이 `advanceTurn`의 **단일 트랜잭션** 안에서 처리된다.
- 판정 기준은 `assets.listed_to` 하나뿐이라 자산 타입 분기가 없다 — 현재는 코인만 값이 채워진다.

## 10. UI 화면

현재 디자인 기준 화면을 React 컴포넌트로 나눠 구현한다.

| 화면 | 역할 | 주요 API |
|---|---|---|
| 오프닝 | 스토리텔링 (배경/상황 제시, 스킵 가능) | - |
| 인트로/빚 설정 | 로그인/회원가입/이어하기(선택) + 난이도 선택, 세션 시작 | `/api/auth/*`, `POST /api/game/start` |
| 메인 화면 | 상태바, 날짜, 헤드라인, 메뉴, 다음 턴 | `GET /api/game/:sessionId`, `POST /next-turn` |
| 마켓 모달 | 랭킹, 업종, 지표, 자산군 필터 | `GET /api/assets`, `GET /api/macro/:date` |
| 종목 상세 | 휠 확대·축소 차트, 기술지표 상세설정, 뉴스, 종토방, 타입별 정보 | `GET /api/assets/:assetId`, `/prices`, `/news`, `/community` |
| 매수/매도 | 수량 입력, 예상금액, 확정 | `POST /api/game/:sessionId/trade` |
| 포트폴리오 | 보유자산, 평가손익, 비중, 수익분석 | `GET /api/game/:sessionId/portfolio` |
| 뉴스 | 당일 뉴스 단일 목록, 상대 날짜, 상세·관련 자산 연결 | `GET /api/news/:date` |
| 캘린더 | 과거 뉴스, 메모 CRUD | `/memo`, `news_exposure` |
| 이벤트 팝업 | 선택형/강제 이벤트 처리 (미해결 시 턴 진행 잠금, 독촉전화 상환액 입력) | `POST /api/game/:sessionId/event`, `/event/pending` |
| 부업 모달 | 미니게임 3종 선택/플레이/결과 (§9-6) | `/side-job/status`, `/side-job/play` |
| 급등주 팝업 | 등장(정수 수량 입력/관망) + 다음 개장 턴 정산 연출 | `/surge/active`, `/surge/buy` |
| 상환 모달 | 상환 턴 상환액 입력, 결과 연출 | `POST /api/game/:sessionId/repay` |
| 주간/월간/최종 리포트 | 주간 평가, 20턴 정산, 엔딩 | `/report/weekly`, `/report/monthly`, `/report/final`, `/result` |

UI와 데이터 정합:

- 상태바는 `game_sessions`의 현금, 총자산 계산값, 부채, 스트레스, 신뢰도와 1:1로 맞춘다.
- 자산군 필터는 `assets.asset_type`을 사용한다.
- 종목 상세의 정보 탭은 자산 타입별 테이블을 사용한다.
- 차트는 `asset_prices`를 기본으로 쓰고, 상세 지표가 필요한 경우 타입별 상세 시세를 추가 조인한다.
- 종목 차트는 상장일부터 현재 턴까지 이력을 봉 단위별로 한 번 불러오고, 차트 위 마우스 휠(키보드 방향키 보조)로 최신 봉에 고정된 표시 구간을 확대·축소한다. 고정 1·3·6개월 버튼은 두지 않는다.
- MA는 5·20봉을 기본으로 하며 상세 설정에서 2~240봉 기간을 추가할 수 있다. MA·볼린저(20)·RSI(14)는 전체 이력에서 계산한 뒤 현재 화면 구간만 잘라 그려 줌 경계의 지표 왜곡을 막는다.
- 뉴스 열람 제한은 서버 응답의 `newsLimit`과 `news_exposure` 기준으로 표시한다.
- 게임 화면에는 실제 연도를 직접 노출하지 않는다. 날짜·회계연도·만기 등은 실제 시스템 시간이 아니라 현재 게임 턴 날짜와의 차이를 이용한 상대 표현으로 표시하고, 서버의 ISO 날짜와 DB 원본은 계산·조회용으로 유지한다.

## 11. 서비스 책임

| 서비스 | 책임 |
|---|---|
| `gameService` | 세션 생성/상태 DTO/승패 판정/최종 결산 |
| `turnSelector` | 시작 개장일 선택, 주말 제외 240평일 생성, 휴장 여부 판정 |
| `turnService` | 턴 데이터 조회, next-turn 오케스트레이션(월초 현금흐름·이벤트·스냅샷·자동저장) |
| `coinUniverseService` | 세션 코인 층화추출(§9-7), `session_coin_universe` 영속화, 세션 코인 조회 |
| `pricingService` | 현재가, 기간 시세, 종목 목록/상세(타입별 정보 탭). 코인 목록은 세션 유니버스로 제한 |
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
| `surgeStockService` | 급등주 등장 확률/정수 수량 매수/다음 개장 턴 수익률 정산/자동 제거 |
| `maskingService` | 회사명 가명 처리 — 토큰 해석/실명 치환/그룹 어간/별칭 + 조사 보정 (§6 마스킹) |

## 12. 개발 마일스톤

| Phase | 목표 | 기준 | 상태 (2026-07-07) |
|---|---|---|---|
| P0 | DB 스키마, Docker, 서버 부트스트랩 | 24테이블 migration, health check | **완료·검증됨** |
| P1 | 데이터 적재 | 131자산, 시세, 재무, 거시, 뉴스, 종토방 stub/실데이터 | **실데이터 적재·검증 완료** (§13-2). 잔여: 반기 재무, npq 수급 |
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
- [x] 급등주: 등장 -> 정수 수량 매수 -> 다음 개장 턴 자동 정산(수익률/스트레스) -> 제거 통과.

## 13-1. 실데이터 적재·거래 검증 (2026-07-20)

빈 PostgreSQL에 001~006을 재실행하고 실데이터를 적재한 뒤 거래 전 과정을 검증했다.

| 테이블 | 건수 |
|---|---|
| `assets` | 1,388 (주식 117 · 채권 4 · 코인 1,267) |
| `asset_prices` | 1,469,302 |
| `macro_daily` | 136,578 |
| `news` | 13,497 |
| `community_posts` / `community_comments` | 2,501 / 36,981 |

- [x] 001~006이 빈 DB에서 순차 재실행되고 29테이블이 생성된다.
- [x] 종토방 2,501건이 전부 `asset_id`에 매칭된다(미매칭 0, stock 1,905 + coin 596).
- [x] 뉴스·종토방 원문이 100% `raw_*` 컬럼에 보존된다.
- [x] 주식/채권/코인 매수 → 턴 진행 → 매도 → 포트폴리오 갱신이 통과한다.
- [x] **현금 정합**: 거래 금액 합계와 세션 현금 변화의 차이가 0원이다(반올림 드리프트 없음).
- [x] 상장폐지 코인이 다음 턴에 자동 청산되고 `is_forced=TRUE` + `event_log.asset_delisted`가 남는다.
- [x] 세션마다 코인 10종이 다르게 뽑히고, 재조회 시 동일 세트가 복원된다(이어하기).
- [x] 세션 유니버스 밖 코인은 매수가 차단되고 보유 중이면 매도는 허용된다.
- [x] 게임 시작일이 `GAME_START_RANGE` 안에서만 선택된다(40회 전부 2014년 이후).
- [x] API 응답에 원문 회사명이 노출되지 않는다.

**스텁으로는 드러나지 않던 버그 6건을 이 과정에서 잡았다** — 스텁(29자산/300거래일)은 규모와
타입 경로가 실데이터와 달라 아래를 전부 통과시켰다.

| 버그 | 원인 |
|---|---|
| `bulkInsert` 프로토콜 오류 | 파라미터 75,217개 → PostgreSQL 바인드 한계(int16, 65,535) 오버플로우. 청킹 추가 |
| `import_bonds` / `import_coins` 크래시 | `src/db.js`가 DATE를 문자열로 파싱하는데 `.toISOString()` 호출. `toIsoDate` 헬퍼로 통일 |
| `assets.code` 길이 초과 | coingecko id 최대 44자 > VARCHAR(30). migration 004로 확장 |
| `toAssetId` 절단 충돌 미검출 | 30자 절단 시 서로 다른 코인이 같은 id로 접힐 수 있음. 가드 추가 |
| 층화추출 파라미터 불일치 | 가격 하한 해제 단계에서 `$3`을 SQL에서 빼고도 파라미터는 전달 |
| **`GAME_START_RANGE` 무시** | 문자열 `trade_date`를 `Date` 객체와 비교 → 항상 false → 하한이 0으로 붕괴. 상한은 아예 미사용이었음 |

## 13-2. 기획 문서 참조 (Drive)

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
- 예외: [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)(실행·운영·로드맵)와 [TEAM_HANDBOOK.md](TEAM_HANDBOOK.md)(초보 팀원용 따라하기)는 설계 문서가 아니다. 설계 내용이 그 문서들에 들어가면 안 된다.
- 구현 파일의 주석은 이 문서 섹션 번호를 참조할 수 있다.
- 프로토타입 기준(4종목, 5턴, 100만 원)은 테스트 fixture 외에는 사용하지 않는다.

## 15. 퀀트 경쟁 모델 (2026-09-28)

- 메인 화면 `퀀트 모델` 버튼 → `GET /api/game/:sessionId/quant`. 보유 수량·비중·평가액·수익률, 선택 순위·목표 비중, 턴별 운용 기록을 제공한다. DB의 가명만 노출한다.
- **기본 설계: 매 턴 평가 + 부분 교체** (`daily_open`, schema 3). 최초 개장일 장 마감에 상위 10종목 동일금액 주문을 예약하고 다음 시가에 채운다. 이후 보유 종목과 신규 후보를 함께 평가해 하위 종목을 하루 최대 1개 교체한다. 순위가 유지되는 보유 종목의 수량은 그대로 둔다. 동점이면 기존 보유를 우선하고 이후 종목 ID로 정렬한다. 최초 구성·빈자리 보충·상장폐지 청산은 통상 교체 수와 구분한다. 신규 매수에 사용할 현금만 매수 후보 수로 나눠 배분하므로 매일 10% 비중으로 재조정하지 않는다.
- 공식 `TopkDropoutStrategy`의 상위 후보/하위 보유 교체 구조를 게임 체결기로 구현한다. CSI300 예제의 50종목/5종목 대신 게임의 10종목/1종목을 사전 고정했다. 공식 전략의 중국시장 거래 규칙·95% 투자 비중까지 그대로 복제한 것은 아니다.
- 휴장일은 다음 개장일까지 기다린다. 정수 수량 매수 후 잔액은 현금으로 유지한다. 첫 조회가 늦어도 세션 시작부터 현재 턴까지만 재생한다. 버튼은 사용자 주문을 생성하지 않는다. 예측 정보가 없는 날에는 현금과 보유 종목을 유지한다.
- **실행 상태(2026-10-06):** `quant_data_2.xlsx`의 수정 OHLC로 만든 `quant-v2-adjusted-2e6c8d6558fc-r2`와 재학습 모델 `model-v4-adjusted-open`을 연결했다(§15-5). 기존 3게임의 현금·턴·플레이어 기록은 유지하고 퀀트 고정 모델과 주문만 재생성했다. 이전 raw 데이터·모델과 전체 DB 백업은 보존한다. 일반 조회는 세션 모델 hash 불일치를 거부하며, 이번 연결은 새 미사용 기간의 성능 검증을 의미하지 않는다.
- 초기 자금은 세션 `initial_cash`. 퀀트는 투자 계정만 운용하며 월급·생활비·부채·스트레스 이벤트를 모사하지 않는다. 화면에 이 차이를 명시한다.
- 선택은 **당일 장 마감까지 확정된 정보**, 체결은 **다음 개장일 시가**, 평가는 이후 종가다. 플레이어와 퀀트가 `executionService.fillOpenOrder`의 예산·수량·수수료·매수 올림·매도 내림 규칙을 공유한다. 현행 수수료·세금·슬리피지는 모두 0이다.
- 상장 구간·당일 시세·현금·정수 수량을 검사한다. 평가에는 현재 이하의 마지막 가격만 쓰며 폐지 시 마지막 관측가로 청산한다. 입력 종가와 DB 시세가 다르면 실패한다. `quant_session_models`(007)에 최초 조회 시 signals SHA-256을 고정한다. 기존 세션에 다른 모델을 조용히 적용하지 않는다.

### 15-1. 데이터와 학습

- 원천 `IISE-CD/quant_data.xlsx`: 117종목, 2013-01-02~2023-12-28. `VWAP = 거래대금(원)/거래량(주)`. 거래량·대금 0이면 VWAP 결측, 정지 상태의 0 OHLC는 feature 결측으로 보존한다.
- `quant/prepare.py` → `data-pipeline/data/done/quant/quant-v1-<source hash>/`. long CSV, Qlib provider, 원본·산출물 hash manifest와 불연속 진단을 저장한다. 기존 파일의 시트 경계 중복은 값이 같은 경우에만 병합한다. 종가·거래량 불일치 시 완료 manifest를 발행하지 않는다.
- 첫 가공 결과: 286,244행 / 2,706일 / 117종목. 기존 게임 원본과 종가·거래량 불일치 0건. 거래 불가 bar 1,370행, 절대 일간 변화 35% 초과 41행. 불연속 진단은 성과를 보고 표본을 제외하는 필터가 아니다.
- 008은 `stock_price_detail`에 `open_price/high_price/low_price/amount/vwap`을 추가한다. `seeds/import_quant.js`는 hash와 DB 종가·거래량 대조 후 한 트랜잭션에서 새 필드만 적재한다. 기존 종가·거래량·수급은 보존한다.
- 공식 `pyqlib==0.9.7`의 `Alpha158` handler로 feature 158개를 생성한다. 재무 feature 없음. inf→NaN, LightGBM 기본 결측 처리, 과거 관측 bar 최소 60개를 적용하며 전체 기간 scaler fitting은 하지 않는다.
- 기본 label: **다음 개장일 시가 → 그다음 개장일 시가의 수익률 − 같은 기간 KOSPI 시가 수익률**. 실제 KOSPI Open 자료와 다운로드 원본·해시를 `data/quant/research-inputs/`에 보관한다. 주식 또는 KOSPI 진입·종료 시가가 없으면 해당 label을 제외하며 미래 시가를 보간하지 않는다. 휴장 턴은 label의 1거래일로 세지 않는다. 공식 feature 158개는 유지한다.
- `quant/profiles.py`에서 label 기간, 평가 주기, 교체 수, 재학습 주기를 분리한다. 매 턴 평가해도 모델 가중치를 매 턴 재학습하지는 않으며 역사적 재학습 기준은 6개월로 유지한다. `legacy_120`은 120평일 후 첫 개장일까지의 기존 label·전체 교체 방식을 재현하기 위한 별도 프로필이다.
- `quant/train.py`: LightGBM 4.6.0 MSE, 고정 K=10·seed=42·최대 120 rounds. 매 1월/7월 모델은 label 종료일이 cutoff 이전인 표본만 쓴다. 최근 40 feature 날짜가 validation이며 training label 종료일은 validation 첫 날짜보다 앞서야 한다. 초기 표본 부족 시 검증 없이 사전 고정 rounds를 사용하고 기록한다. 조기 종료 후 이미 만기가 지난 train+validation으로 재학습한다.
- 2022~2023 고정 테스트는 `lgb-20220101`을 끝까지 유지한다. 게임 배포용 순차 재학습 모델 평가와 분리한다. **이 기간의 v1 결과를 이미 확인했으므로 v2에 재사용하면 후속 진단이며 새로운 미사용 테스트가 아니다.** 주식분할·배당 자료, 과거 시장 전체의 구성 이력은 제공되지 않았다. raw 게임 가격과 제공된 게임 종목 집합을 쓰므로 현재 v1 산출물은 게임 연구용 초기 모델이다. 수정종가만 교체해 raw OHLC/VWAP와 섞지 않고 동일 수정 기준으로 맞춰야 한다.
- 공식 참고: [Alpha158](https://github.com/microsoft/qlib/blob/v0.9.7/qlib/contrib/data/handler.py), [LightGBM workflow](https://github.com/microsoft/qlib/blob/v0.9.7/examples/benchmarks/LightGBM/workflow_config_lightgbm_Alpha158.yaml). CSI300용 `qrun` 설정을 실행한 것은 아니며 공식 handler에 게임 label·체결기를 연결했다.

### 15-2. 보존된 v1 첫 검증 결과 (120턴 모델)

- 시간 purge, 미래 시세 불변성, 반복 조회 불변성, 1·121턴 교체, 휴장 연기, 폐지 청산, 시세 불일치 거부를 검증한다.
- 고정 테스트(만기가 관측된 377개 예측일)의 평균 Rank IC **-0.07699**. 120턴 label이 겹치므로 일별 관측치를 독립 표본으로 취급하지 않는다. 예측 우위나 경쟁력을 확인한 결과가 아니다.
- 동일한 JS 게임 체결기로 2022-01-04~2023-12-28을 재생했다. 초기 5천만 원, 120턴 교체, 비용은 현행 게임값 0이다.

| 전략 | 누적 수익률 | CAGR | MDD | Sharpe (260평일) |
|---|---:|---:|---:|---:|
| 고정 Alpha158 + LightGBM, K=10 | -31.28% | -17.26% | -42.97% | -0.565 |
| 60거래일 momentum, K=10 | -30.24% | -16.63% | -44.88% | -0.592 |
| 당시 관측 가능 게임 주식 동일가중 | -12.05% | -6.28% | -24.59% | -0.338 |

`Alpha+Momentum` 전략 코드는 이 체크아웃에서 찾지 못했다. 위 momentum60은 별도의 단순 비교군이다. 성과에 따라 부호·K·기간·필터를 바꾸지 않았고 모델을 성능 우수 모델로 승격하지 않았다. 상세 결과는 done/model-v1의 `artifact.json`, `evaluation.json`, `backtest.json`에 보관한다.

이 결과는 새 일별 모델의 수익률이 아니다. 이번 주기 변경은 공식 단기 예측 방식에 맞추려는 설계 변경이며 수익 개선을 검증한 결과가 아니다. 단기 label의 거래일 이동·만기 purge, 매 턴 평가·최대 교체 수·동점 유지·미래 정보 불변성·휴장·누락 시세 및 기존 120턴 호환성을 별도 테스트한다. 후속 비교에서는 Alpha158와 momentum60에 같은 부분 교체 규칙을 적용하고, 동일가중 비교군은 같은 평가 주기에 전체 비중을 다시 맞추는 별도 전략으로 명시한다.

### 15-3. 수정 전 가격의 일별 모델 진단 (2026-09-28)

사용자가 수정주가 다운로드 전 개선 여부 확인을 요청하여 `model-v2-daily-raw-diagnostic`을 학습했다. 동일한 Alpha158 feature 파일을 hash로 대조하고, 1거래일 초과수익 label·K=10·최대 1종목 교체·6개월 재학습·기존 LightGBM 설정을 결과 확인 전에 고정했다. 20개 역사적 모델, 2,458개 예측일, 261,567개 점수의 학습 만기·날짜·순위·원천 종가 정합성 검증이 통과했다. 원본, v1의 모든 파일, 게임 연결 signals hash는 유지됐다.

- 2022~2023에는 2022년 이전 자료만 학습한 고정 모델을 사용한다. 새 모델의 평균 Rank IC는 **-0.008529**, IC는 **+0.002289** (489개 예측일)다. 2014~2023 전체 순차 재학습의 Rank IC **+0.006576**과 구분한다.
- 기존 모델도 **동일 날짜·동일 종목의 1거래일 label**로 다시 채점하면 Rank IC **-0.022120**이다. 새 모델과의 차이는 **+0.013591**, 날짜별 차이의 20거래일 블록 부트스트랩 95% 구간은 **[+0.000740, +0.025095]**다. 기존 120턴 label 자체의 -0.076989와 직접 비교하지 않는다. 이미 확인했던 평가 기간을 재사용한 진단이며 새 미사용 테스트가 아니다.

| 전략 | 2022-01-04~2023-12-28 누적 수익률 | CAGR | MDD | 매수·매도 건수 |
|---|---:|---:|---:|---:|
| 기존 모델 / 120턴 전체 교체 | -31.28% | -17.26% | -42.97% | 90 |
| 기존 점수 / 매일 부분 교체 (진단용) | -21.25% | -11.37% | -31.58% | 980 |
| 새 일별 모델 / 매일 부분 교체 | +13.99% | +6.84% | -39.73% | 988 |
| 60거래일 momentum / 매일 부분 교체 | -33.22% | -18.45% | -41.92% | 810 |
| 전체 동일가중 / 매일 재조정 | -9.51% | -4.92% | -24.82% | 109,093 |

기존 수익률을 같은 체결기로 정확히 재현했고, 비교군의 날짜·가격·종목 정보가 동일함을 검사했다. 새 모델의 누적 수익률은 기존 방식보다 45.27%p 높지만 Rank IC는 여전히 음수다. 새 모델의 기간 내 단방향 회전율은 50.83배이고 비용은 현행 게임값 0이다. 수정주가·배당·현실 거래비용 검증을 대체하지 않는다. 진단 후 사용자의 별도 요청으로 새 일별 모델을 게임에 연결했다. 진단용 기존 점수 일별 매매 비교군은 배포 허용 artifact가 아니다.

증거는 `done/quant/quant-v1-4c60eab83fe8/model-v2-daily-raw-diagnostic/`의 `diagnostic_plan.json`, `STATUS.json`, `evaluation.json`, `verification.json`, `comparison/summary.json`, `comparison/comparison.md`에 보관한다. 비교 계산은 `quant/compare_diagnostic.py`를 사용했다.

### 15-4. 다음 시가 체결 및 Open→Open 모델 (2026-09-28)

`model-v3-open-raw-diagnostic`은 동일 Alpha158 feature와 LightGBM 설정에서 정답과 체결 시점을 변경했다. 20개 역사적 모델, 2,459개 의사결정일, 261,683개 점수를 검증했다. 퀀트 최초 1턴은 현금과 매수 예약만 있으며 다음 개장일에 실제 보유가 생긴다. 예약 내역은 `market_orders.owner='quant'`에 자동 저장되고 조회 횟수와 무관하게 재현된다. 유저는 포트폴리오의 주문 내역에서 상태 확인·취소가 가능하다.

- 2022~2023 고정 모델, 유효한 487개 예측일: Rank IC **+0.038673**, IC **+0.029923**, 비연율 Rank ICIR **0.279475**.
- 2014~2023 순차 재학습: Rank IC **+0.059660** (2,449개 유효 날짜). 고정 모델 평가와 구분한다.
- 동일 게임 체결기로 2022-01-03 장 마감부터 2023-12-28까지 재생했다. 첫 체결은 2022-01-04 Open이다. 아래 전략은 같은 가격·달력·예산 규칙을 적용한다.

| 전략 | 누적 수익률 | CAGR | MDD | 매수·매도 건수 |
|---|---:|---:|---:|---:|
| 고정 Alpha158 + LightGBM, K=10 / 최대 1개 교체 | -10.70% | -5.55% | -46.94% | 624 |
| 60거래일 momentum, K=10 / 최대 1개 교체 | -22.57% | -12.11% | -41.20% | 780 |
| 초기 동일금액 배분 후 보유 (빈자리 보충 가능) | -19.51% | -10.37% | -27.91% | 117 |

v2와 정답·체결 규칙이 달라 이전 Rank IC와 직접 비교하지 않는다. v2 종가 체결 수익률 +13.99%에서 개선됐다는 결과도 아니다. 이 구간은 이미 관찰한 진단 구간이며 수정주가·배당 미반영, 제공된 종목 집합, 비용 0이라는 한계가 그대로 남는다. 상세 근거는 v3 폴더의 `diagnostic_plan.json`, `evaluation.json`, `verification.json`, `backtest.json`, `STATUS.json`이다.

`quant/check_open_integration.cjs`는 실제 PostgreSQL에서 예약·취소·멱등 요청·예산 초과·휴장·시가 누락·갭 상승 시 수량 감소·매도 우선·종가 평가·마지막 턴 차단·오류 시 전체 롤백·퀀트 자동 체결·동일 시가 체결을 검사한다. 임시 데이터는 끝에 모두 롤백한다. 가상 급등주 이벤트 테스트는 기존 규칙으로 유지한다.

### 15-5. 수정주가 최종 데이터와 게임 반영 (2026-10-06)

원천은 `IISE-CD/quant_data_2.xlsx`이며 일간·원화, 117종목, 2013~2023년이다. 실제 아이템은 수정시가 `S410000650`, 수정고가 `S410000660`, 수정저가 `S410000670`, 수정주가 `S410000700`이다. 기간별 기초/최고/최저 통계나 배당수익률 항목을 사용하지 않는다. 기존 raw OHL·거래량·거래대금과 대조한 뒤 **286,244행 / 2,706일 / 117종목**을 발행했다. 30,358개의 양수 종가 없는 행은 원천 파일에 보관하고, 거래정지·거래대금/거래량 결측 1,370행은 평가용 종가를 유지하되 체결용 OHL과 VWAP를 결측으로 둔다.

최종 위치는 `data-pipeline/data/done/quant/quant-v2-adjusted-2e6c8d6558fc-r2/`이다.

| 파일 | 용도 |
|---|---|
| `asset_prices.csv` | 수정종가와 수정종가에서 다시 계산한 등락률 |
| `stock_price_detail.csv` | 수정 OHLC/VWAP, 실제 거래량·거래대금, 유효 가격 배율, 학습용 수정 거래량 |
| `quant_daily.csv`, `qlib/` | 공식 Alpha158 입력, 거래 가능 여부와 날짜/종목 캘린더 |
| `instruments.csv`, `manifest.json` | 기존과 같은 관측 종목 구간, 원천·최종 파일 hash와 가격 기준 |
| `source_daily.csv`, `source_metadata.json` | 원본 값과 아이템·일간 빈도 메타데이터 |
| `adjustment_audit.json`, `source_close_differences.csv`, `source_vwap_outliers.csv` | 조정 검증과 원천 예외 목록 |
| `model-v4-adjusted-open/` | 20개 역사적 모델, signals, 고정 평가, 검증, 실행 상태 |

수정계수 `S410001600`은 이벤트일에 변하는 값으로, 날짜별 원주가에 곧바로 곱할 누적 배율이 아니다. 제공된 원 OHL과 수정 OHL 세 쌍에서 **각 수정가격의 ±0.5원 반올림 범위를 동시에 만족하는 유효 배율**을 계산했다. 수정 OHLC 원본은 바꾸지 않는다. VWAP는 `실제 거래대금 / 실제 거래량 × 유효 배율`, Qlib 거래량은 `실제 거래량 / 유효 배율`이다. 게임 화면에는 당시 실제 거래량을 유지하고 별도 `adjusted_volume`을 저장하므로 원 거래량을 소급 덮어쓰지 않는다.

원천 예외는 성과와 무관하게 보존한다. 기존 원종가×배율과 새 수정종가가 1.1원 넘게 다른 행 237개는 별도 목록으로 기록하고 새 원천의 수정종가를 사용한다. 거래대금÷거래량이 일중 OHL 범위를 벗어나는 행 453개도 기존 raw 입력에서 확인되므로 임의로 절삭하지 않는다. 거래량/대금 범위가 일중 시세 범위와 같은지는 원천만으로 단정하지 않는다. OHLC 범위를 벗어난 1행은 거래량·대금도 결측이며 체결 대상이 아니다. 일간 절대 수익률 35% 초과 건수는 raw의 41개에서 수정가격의 0개로 줄었으며 수익률 필터로 제거한 결과가 아니다.

내보내기 첫 후보는 큰 거래대금 15행의 유효 자릿수 손실을 발견해 배포하지 않았다. r2는 17자리 round-trip 정밀도로 실제 거래량·대금의 정확 일치를 검증하고 재학습했다. 후보는 `candidate_disposition.json`으로 별도 보존하며 파라미터·정답·종목선정 규칙을 성과에 맞춰 변경하지 않았다.

DB는 286,244행의 시가·종가·고가·저가·VWAP·등락률을 한 트랜잭션에서 변경하고 모델 hash와 퀀트 주문을 함께 교체한다. 새 파일에 없는 2012-12-28 경계 데이터 86행은 원주가 혼합을 막기 위해 백업 후 활성 시세에서 제외했다. 기존 게임의 시작일·턴·현금·상환·이벤트·스냅샷 등은 hash로 보존을 확인했다. 기존 플레이어 주식 보유·거래·주문이 하나라도 있으면 현재 전환 스크립트는 상태를 재설정하지 않고 중단한다.

2022~2023 고정 모델의 487개 유효 예측일에서 **Rank IC +0.041550**, IC +0.032196, 비연율 Rank ICIR 0.295381이다. 전체 순차 재학습 Rank IC +0.062771은 별도 결과다.

| 수정가격 기준 전략 | 누적 수익률 | CAGR | MDD | 거래 건수 |
|---|---:|---:|---:|---:|
| Alpha158 + LightGBM / 최대 1종목 교체 | +3.13% | +1.57% | -30.76% | 624 |
| 60거래일 momentum / 최대 1종목 교체 | -19.05% | -10.11% | -40.71% | 778 |
| 초기 동일금액 배분 후 보유 | -14.22% | -7.44% | -26.58% | 117 |

기존 raw v3의 -10.70%와는 입력·정답·체결 가격 자체가 바뀌므로 모델 개선 효과만을 분리한 비교가 아니다. 2022~2023은 이미 확인한 진단 기간이고 거래비용은 현행 게임값 0이다. 현금배당 별도 지급, 시장 전체의 과거 종목 구성, 당시 시점의 수정 데이터 빈티지는 확보하지 않았다. 원천은 2026년 다운로드 시점의 소급 조정 자료다.

검증은 `verify_adjusted.py`의 전 CSV/provider 대조, 모든 signals의 날짜·학습 만기·가격 검증, 실제 DB 사전 적용 후 롤백, 실제 API의 새 게임·예약·다음 수정시가 동일 체결, 기존 플레이어 상태 보존을 포함한다. 근거와 이전 DB·signals·퀀트 주문은 `data/quant/deployments/20261006-adjusted/`에 보관한다.
