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

## 5. DB 스키마 (최종 — 자산 타입별 분리)

> 실제 드라이브 데이터 확인 결과 **타입별 가격 구조가 근본적으로 다름**(주식=OHLCV+수급, 채권=수익률 시계열, 코인=USD 종가+시총). 그래서 **공통 마스터/시세 + 타입별 상세** 로 분리한다.

### 공통
- `assets` — 통합 마스터: `asset_id, asset_type(stock|bond|coin), code, name, masked_name, sector, currency, is_active`
- `asset_prices` — **거래·평가용 최소 공통 시세**: `asset_id, trade_date, close_price, change_rate, currency` (매수/매도·총자산·포트폴리오가 타입 무관하게 이 테이블 사용)

### 타입별 상세 시세 (네이티브 컬럼)
- `stock_price_detail` — `open/high/low, volume, 외국인·기관·개인 수급, 유동주식수, 시가총액`
- `bond_price_detail` — `yield(수익률), price_index`
- `coin_price_detail` — `market_cap, volume_usd`

### 타입별 정보
- `stock_financials`(**반기별**: 매출·영업이익·순이익·부채총계·현금성·재고) · `stock_valuation`(**반기별**: PER·PBR·PSR·EV/EBITDA·ROE·ROA·EPS·BPS·SPS·시총)
- `bond_info`(채권종류·신용등급·만기) · `coin_info`(심볼·시총tier·상장/폐지연도·생존여부)

### 거시 / 뉴스 / 종토방
- `macro_indicators` · `macro_daily`
- `news`(news_type·asset_id·headline·body·sentiment·event_family·is_masked) · `news_tags`
- `community_posts` · `community_comments`(읽기 전용)

### 플레이어
- `game_sessions`(상태값: cash·debt·stress·trust·current_turn·status·difficulty) · `game_turns`(1~240)
- `holdings` · `trades`(실현손익) · `repayments`(20턴) · `event_log`(이벤트) · `memos`(캘린더) · `news_exposure`(스트레스 제한 노출)

> 권위 DDL: `server/migrations/001_init.sql`. **타입별 분리안 반영을 위해 갱신 예정**(현재 통합 asset_prices 버전 → 위 분리안으로 개정).

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
| P0 기반 | DB 스키마 + Docker + 서버 부트스트랩 | ✅ 스키마 검증(통합안) / 타입별 분리안 개정 예정 |
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

- DB 스키마(통합안 19테이블): PostgreSQL 16 생성·시드 검증 완료.
- 백엔드 프로토타입(JS): 구문검사 + 게임흐름 통합테스트 15/15 통과(4종목 기준).
- 다음: ① 스키마 타입별 분리 개정 → ② 컨트롤러 풀스코프 재작성 → ③ 실데이터 적재.

---

## 11. 산출물 / 문서 맵

| 문서/파일 | 내용 |
|---|---|
| **본 문서** | 최종 개발 파이프라인(단일 기준) |
| `UI_SCREENS.md` | 디자인 기반 화면 명세 + UI↔API 매핑 |
| `server/migrations/001_init.sql` | DB 스키마(타입별 분리안으로 개정 예정) |
| `server/` | Express JS MVC 스캐폴드 |
| `docker-compose.yml` | DB+API 컨테이너 |
| `repo_alignment_check.md` | 프로토타입↔풀스코프 정렬 이력 |

> 이전 `ARCHITECTURE_revised.md`·`TECH_STACK_revised.md`의 내용은 본 문서에 통합됨.
