# ANT SURVIVAL 개발 진행 가이드

> **설계 기준(스코프/DB/API/UI)은 [ARCHITECTURE.md](ARCHITECTURE.md)가 유일한 소스다.**
> 이 문서는 설계를 다루지 않는다 — "서버를 어떻게 돌리는가"와 "앞으로 무엇을 어떤 순서로 하는가"만 다룬다.
> 작성일: 2026-07-07 (스캐폴드 + 기획명세서 전체 구조 반영 완료 시점 기준)

---

## 0. 현재 상태 한눈에 보기

| 영역 | 상태 | 비고 |
|---|---|---|
| DB 스키마 (28테이블) | ✅ 완료·검증 | `001_init.sql` + `002_members_minigames.sql` |
| 게임 코어 (세션/240턴/거래/평가/자동저장) | ✅ 완료·검증 | API 플로우 테스트 통과 |
| 상태 시스템 (스트레스 5구간/신뢰도/월급·생활비/상환) | ✅ 완료 | 확정 수치 반영, 밸런싱만 남음 |
| 이벤트 A~E (독촉전화/급등주/스터디/경조사/명절/기절) | ✅ 완료·검증 | 스터디 힌트 실데이터만 TODO (명절 실제 달력 반영 완료) |
| 부업 미니게임 3종 | ✅ 완료·검증 | 점수 컷 밸런싱만 TODO |
| 회원관리 (가입/로그인/이어하기) | ✅ 완료·검증 | 게스트 허용 |
| 프론트 전 화면 (오프닝~결과, 모달 13종) | ✅ 기능 완료 | **디자인 시안 미적용** (기능 확인용 스타일) |
| 실데이터 적재기 6종 | ⚙️ 구현 완료, **실행 전** | 매핑 4건 확정 필요 (§3-1) |
| 디자인 게임 (픽셀아트 정적 페이지 12종 + 에셋) | ✅ 병합됨 (`/design.html`) | 팀원 작업분. **SPA 이식이 Phase D** (§3-D 매핑표) |
| dev mock 모드 (`VITE_USE_MOCK`) | ✅ 병합·통합됨 | 백엔드 없이 프론트 개발 가능 (§1-8) |
| LLM 리포트 (주간 평가/최종 투자성향) | ⬜ 연동 지점만 준비 | `reportService.js`의 TODO |
| 밸런싱/플레이테스트 | ⬜ 미착수 | `constants.js` 단일 파일에서 조정 |

남은 작업 지점은 코드에서 `grep -rn "TODO(" server frontend`로 전부 찾을 수 있다.
분류: `TODO(data)` 데이터 담당 / `TODO(gamelogic)` 게임로직 담당 / `TODO(frontend)` 프론트 담당.

---

## 1. 서버 실행 가이드

### 1-1. 처음 세팅 (팀원 온보딩, 최초 1회)

전제: Docker Desktop, Node.js 20+ 설치.

```bash
git clone https://github.com/hwangsueun/IISE-CD-StockGame.git
cd IISE-CD-StockGame

# 1) DB 기동 (postgres:16 컨테이너, migrations/ 자동 실행)
docker compose up -d db

# 2) 스키마 확인 (28개 테이블이 보여야 정상)
docker exec antsurvival_db psql -U admin -d antsurvival -c "\dt"

# 3) 서버 의존성 + 개발용 스텁 데이터
cd server
npm install
cp .env.example .env          # 로컬은 기본값 그대로 OK
npm run seed:stub             # 합성 데이터: 29자산/300거래일/뉴스 1,600건/종토방

# 4) API 서버 (개발 모드, 파일 변경 시 자동 재시작)
npm run dev                   # http://localhost:3001
curl http://localhost:3001/health   # {"status":"ok","db":"up"} 이어야 함

# 5) 프론트 (새 터미널)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173 (/api는 3001로 프록시)
```

여기까지 하면 **오프닝 → 회원가입 → 게임 시작 → 거래/뉴스/부업/상환 전체가 스텁 데이터로 플레이 가능**하다.

### 1-2. 실행 모드 3가지

| 모드 | 명령 | 언제 쓰나 |
|---|---|---|
| A. DB만 Docker + API/프론트 로컬 | `docker compose up -d db` + `npm run dev` ×2 | **평소 개발 (권장)** — 코드 수정 즉시 반영 |
| B. 전부 Docker | `docker compose up -d` | 시연/통합 확인 — API도 컨테이너(`antsurvival_api`)로 |
| C. 프론트만 | `npm run dev` (frontend) | UI 작업만 할 때. API는 팀원 서버/모드 A 필요 |

주의: 모드 B에서 API 코드를 고치면 `docker compose build api && docker compose up -d api`로 재빌드해야 반영된다. 개발 중에는 모드 A를 쓰는 게 편하다.

### 1-3. 마이그레이션 규칙 (중요)

- `server/migrations/*.sql`은 **빈 볼륨에서 컨테이너가 처음 뜰 때만** 자동 실행된다 (`docker-entrypoint-initdb.d`).
- **이미 돌아가는 DB에 새 마이그레이션을 추가한 경우** 수동 적용:
  ```bash
  docker exec -i antsurvival_db psql -U admin -d antsurvival < server/migrations/00X_new.sql
  ```
- DB를 완전히 리셋하고 싶을 때 (스키마 꼬임/처음부터):
  ```bash
  docker compose down -v      # 볼륨 삭제 = 데이터 전부 삭제
  docker compose up -d db     # 001+002 자동 재실행
  cd server && npm run seed:stub
  ```
- 새 마이그레이션 작성 규칙: `003_*.sql`처럼 번호를 이어가고, **재실행 가능(idempotent할 필요는 없으나 빈 DB에서 001→002→003 순서로 무조건 성공)**해야 하며, 반영 후 ARCHITECTURE.md §7에 요약을 갱신한다.

### 1-4. 실데이터 적재 절차

스텁이 아닌 실제 게임 데이터(주식 117/코인/뉴스 13,497건/종토방)를 넣는 절차.

1. **데이터 준비** — 두 가지 방법 중 하나:
   - 로컬에 `data-pipeline` 레포가 있으면 그대로 사용 (`DATA_DIR=/Users/hgs/Desktop/IISE-CD/data-pipeline`)
   - 없으면 팀 Drive에서 다운로드해 같은 폴더 구조를 만든다. 필요한 파일 목록과 경로는 **ARCHITECTURE.md §6-0 표** 참조 (뉴스 4종 JSONL은 Drive `game_news_data/` 폴더).
2. **적재 실행** (순서 의존성은 스크립트가 처리: 주식 → 거시 → 채권 → 코인 → 뉴스 → 종토방):
   ```bash
   cd server
   DATA_DIR=/path/to/data-pipeline npm run seed
   ```
   부분 재적재도 가능: `DATA_DIR=... node seeds/import_news.js` 처럼 개별 실행.
3. **적재 검증** (필수):
   ```bash
   docker exec antsurvival_db psql -U admin -d antsurvival -c "
     SELECT asset_type, COUNT(*) FROM assets GROUP BY 1;          -- stock 117 / bond 4 / coin ~10
     SELECT COUNT(*) FROM news;                                   -- ~13,497
     SELECT MIN(trade_date), MAX(trade_date) FROM asset_prices;   -- 2013~2023"
   ```
4. **주의사항**
   - `usdkrw`(거시)가 먼저 있어야 코인 KRW 환산이 된다 — `import_all.js` 순서를 바꾸지 말 것.
   - 뉴스 JSONL이 갱신되면(거시뉴스 재생성 완료 시) Drive 파일만 교체하고 `import_news.js`를 다시 돌리면 된다. **스키마는 계약(NEWS_DATA_CONTRACT.md)상 불변.**
   - 적재 전 매핑 4건(§3-1)이 확정되지 않아도 적재는 되지만, 마스킹/종토방 연결이 불완전한 상태로 들어간다. **마스킹 사전 없이 적재한 DB는 절대 외부 시연에 쓰지 말 것** (임시 가명 `종목001`로 들어가므로 노출 자체는 안 되지만, 뉴스 본문에는 실명이 남아 있다 → §3-1의 ①이 선행돼야 함).

### 1-5. 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | `postgresql://admin:password@localhost:5432/antsurvival` | pg 접속 문자열 |
| `PORT` | `3001` | API 포트 |
| `CORS_ORIGIN` | `http://localhost:5173` | 프론트 오리진 (배포 시 변경) |
| `GAME_START_RANGE` | `2013-01-02..2023-12-31` | 시작일 랜덤 범위 (240거래일 상한 자동 보정) |
| `DATA_DIR` | - | 실데이터 적재 시 data-pipeline 루트 |

### 1-6. 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| `/health`가 503 (`db: down`) | DB 컨테이너 안 뜸 → `docker compose up -d db`, `docker ps` 확인 |
| `EADDRINUSE :3001` | 이전 서버 프로세스 잔존 → `lsof -ti:3001 \| xargs kill` |
| 게임 시작 시 "거래일 데이터 부족" | 시드 미적재 → `npm run seed:stub` 또는 실데이터 적재 |
| 테이블이 24개만 보임 | 002 마이그레이션 미적용 (기존 볼륨) → §1-3 수동 적용 |
| 프론트에서 API 404/CORS | 프론트는 5173의 vite 프록시 경유가 기본. `VITE_API_BASE`를 쓸 땐 서버 `CORS_ORIGIN`도 맞출 것 |
| 날짜가 하루 밀림 | `db.js`의 DATE 파서가 문자열로 받도록 되어 있음 — 새 쿼리에서 `new Date(dateStr)` 후 `toISOString()` 변환하는 코드를 추가하지 말 것 |

### 1-7-0. 프론트 진입점 2개 + mock 모드 (병합 이후)

- `/` (index.html) = **본편 React SPA** — 백엔드 연동, 전 기능.
- `/design.html` → `public/game/` = **디자인 게임** — 픽셀아트 정적 페이지 원본 (localStorage 기반 자체 동작). 디자인 확인/이식 원본용.
- **mock 모드**: `frontend/.env`에 `VITE_USE_MOCK=true`를 넣으면 SPA가 백엔드 없이 `mockApi.js`로 동작한다. 단 회원/부업/급등주/실현손익/게임로그는 mock 미구현으로 **명시적 에러**를 던진다 — 그 기능을 만질 때는 백엔드를 켜라(§1-1). 기본값은 `false`(실서버).

### 1-7. 시연/배포 (추후, 예: 중간·최종 발표)

지금 구조 그대로 단일 VM(EC2/Lightsail/교내 서버)에 올릴 수 있다:

1. VM에 Docker 설치 → 레포 clone → `.env`에서 `POSTGRES_PASSWORD`/`CORS_ORIGIN` 변경 (기본 비밀번호로 외부 노출 금지).
2. `docker compose up -d` + 실데이터 적재 (§1-4).
3. 프론트는 `npm run build` 후 `frontend/dist`를 정적 서빙:
   - 간단히: nginx로 `dist/` 서빙 + `/api`를 `localhost:3001`로 reverse proxy.
   - 또는 Express에 `app.use(express.static('...'))` 한 줄 추가하는 방법도 있다 (필요 시 그때 결정).
4. HTTPS가 필요하면 nginx + certbot. **로컬 시연이면 이 절 전체가 불필요** — 노트북에서 §1-1로 충분.
5. 인증 토큰은 DB 저장 opaque 토큰이라 서버 재시작에도 유지된다. 단, 비밀번호 정책/토큰 만료는 미구현(§4 리스크) — 공개 배포 전 필수 보강.

---

## 2. 팀 작업 규칙 (충돌 방지)

1. **설계 변경은 ARCHITECTURE.md 먼저.** DB는 migration 파일 → 문서 요약 순서.
2. **밸런싱 수치는 `server/src/config/constants.js`에서만** 바꾼다. 서비스 코드에 숫자를 하드코딩하지 않는다. 모든 상수 옆에 근거 기획 문서가 주석으로 달려 있으니 유지할 것.
3. **돈/상태값 계산은 전부 서버.** 프론트에서 잔액/수익률을 "계산해서 저장"하는 PR은 반려. 프론트 계산은 표시용 예상치까지만.
4. **게임 응답에 원 회사명 금지.** 조회 쿼리는 `masked_name`만 select. 리뷰 때 grep으로 확인: `grep -rn "a.name" server/src` 에 게임 API가 걸리면 안 됨.
5. 역할 분담은 TODO 마커 기준: `TODO(data)`/`TODO(gamelogic)`/`TODO(frontend)`.
6. 커밋은 기능 단위로, `main` 직접 커밋(현행 유지)하되 **큰 기능은 검증 체크리스트(ARCHITECTURE.md §13) 통과 후** 커밋 메시지에 검증 내용을 적는다.
7. 새 API를 추가하면: routes → controller → service 3층 구조 유지 + `frontend/src/api/client.js`에 래퍼 추가 + ARCHITECTURE.md §8 표 갱신. 이 4개가 한 커밋에 같이 있어야 한다.

---

## 3. 앞으로의 진행 로드맵

간트차트(Drive) 원계획 대비 **7~9월에 잡혀 있던 개발 항목 대부분이 이미 구조·기능 수준으로 완료**됐다. 남은 것은 ①데이터 완결 ②콘텐츠·연출 ③밸런싱 ④LLM ⑤안정화 순이다. 아래 순서대로 진행하는 것을 권장한다 (선행 의존성 명시).

### Phase A — 실데이터 완결 (최우선, 다른 모든 것의 선행 조건)

> 목표: 스텁이 아닌 실데이터로 게임 1회차 완주가 가능한 상태.
> 완료 기준(DoD): §1-4 검증 쿼리 통과 + 실데이터로 240턴 완주 + 화면 어디에도 실명 미노출.

| # | 작업 | 코드 반영 지점 | 담당 |
|---|---|---|---|
| A1 | **마스킹 사전 확정** (별칭→정식명→가명 2단계, 117종목) | `maskingService.js`의 `ALIAS_TO_CANONICAL`/`CANONICAL_TO_MASKED` 채우기 → `import_all.js` 마지막 단계에서 assets.masked_name + 뉴스 본문 치환 | data |
| A2 | **갤러리→종목 매핑표** (디시 101갤러리 → stock_code) | `import_community.js`의 `GALL_TO_STOCK_CODE` | data |
| A3 | **npq 수급 시트 매핑** (외국인/기관/개인 순매수) | `import_stocks.js`의 NPQ_SHEETS 파싱 (시트 아이템명 확인 후) | data |
| A4 | **반기 재무/밸류에이션 적재기** (DataGuide 재무 파일 확정 시) | `seeds/import_financials.js` 신규 → `stock_financials`/`stock_valuation` | data |
| A5 | FICS 섹터 컬럼 채우기 (마켓 모달 업종 필터용) | A1과 같은 매핑표에 섹터 포함 권장 | data |
| A6 | ~~명절(설/추석) 실제 달력~~ **✅ 완료 (2026-07-07)** | `HOLIDAY.DATES` 22건(2013~2023) + 연휴 직후 첫 거래일 1회 발동 트리거 | data |
| A7 | 코인 시총 티어 라벨 (층화추출 결과) | `import_coins.js` market_cap_tier | data |
| A8 | (파이프라인 측) 거시뉴스 전기간 재생성 완료 시 JSONL 교체 재적재 | Drive 파일 교체 → `import_news.js` 재실행 | data |

A1이 끝나기 전에는 실데이터 DB를 시연에 쓰지 않는다 (§1-4 주의).

### Phase B — 게임로직 마감

> 목표: 기획 문서에 "미확정"으로 남은 로직을 확정해 채우기.
> 완료 기준: `grep TODO(gamelogic)` 결과 0건 (LLM 제외).

| # | 작업 | 지점 |
|---|---|---|
| B1 | 재무 공시 시점 규칙 — fiscal_year/half가 게임 날짜 기준 언제부터 보이는지 (미래 정보 차단) | `pricingService.getAssetDetail`의 cutYear 로직 |
| B2 | 투자 스터디 힌트를 실데이터 기반으로 — 다음 주 실제 시장 변동/예정 이벤트에서 간접 신호 생성 ("정답 공개 금지" 원칙) | `eventEngine.buildDirectionHint/buildOmenHint` |
| B3 | 급등주 결과 가중치 확정 (현재 임의 가중치 8/15/17/25/25/10) — 기대값이 음수(유혹 이벤트)가 되도록 기획과 합의 | `constants.js` SURGE_STOCK.OUTCOMES |
| B4 | 부업 점수 컷 조정 — 팀원 3명이 각 게임 5판씩 플레이한 분포로 컷 재설정 | `constants.js` SIDE_JOB.SCORE_CUTS |
| B5 | ~~기절 중 월말 경과 시 "해당 월 미납 처리" 자동화~~ **✅ 완료 (2026-07-07)** — 상환 턴을 상환 없이 지나치면 자동 미납(ratio 0) 기록 + 미납 페널티 반영. next-turn 응답에 `missedRepayment` 추가 | `repaymentService.recordMissedIfUnpaid` + `turnService.advanceTurn` |
| B6 | 수익 시 스트레스 하락 수치 확정 (현재 임시 −2) | `constants.js` DAILY_RETURN_STRESS |

### Phase C — LLM 리포트 (기획서 §10 Argument, 차별화 포인트)

> 목표: 주간 평가서 + 최종 투자성향/학습 피드백을 LLM으로 생성.
> 완료 기준: 주간 리포트에 자연어 평가문, 엔딩에 투자성향 분석 표시.

1. **입력 설계**: `reportService`가 이미 계산하는 값(주간 수익률, 거래이력, 자산군 비중, 이벤트 대응)을 JSON으로 요약하는 함수부터 작성 — LLM 없이도 이 요약 자체를 화면에 먼저 노출 가능.
2. **호출 구조**: 서버에서만 호출(API 키 노출 금지). `server/src/services/llmService.js` 신설, 환경변수 `LLM_API_KEY`. 실패 시 규칙 기반 문장으로 폴백(현재 comment가 그 폴백).
3. **비용 통제**: 주간 평가는 세션당 48회 발생 가능 → 캐시(`session_snapshots.detail`에 저장, 이미 UNIQUE 제약 있음) + 짧은 프롬프트.
4. **연동 지점**: `reportService.getWeeklyReport`의 comment, `getFinalReport`의 investmentStyle/learningFeedback/aiAnalysis (필드는 이미 응답에 존재 — 프론트 무수정으로 표시됨).

### Phase D — 디자인 게임 → 본편 SPA 이식 (Phase A~B와 병행 가능)

> 목표: `public/game/`의 픽셀아트 디자인(팀원 작업분, 병합 완료)을 본편 SPA 컴포넌트에 이식.
> 완료 기준: 아래 매핑표 전 행 이식 + 기능 회귀 없음 (§13 체크리스트 재통과).
> 방법: 디자인 HTML의 마크업/CSS/에셋 경로를 해당 React 컴포넌트로 옮긴다.
> 에셋은 이미 `public/game/assets/`에 있으므로 `<img src="/game/assets/...">`로 바로 참조 가능.

**디자인 페이지 ↔ SPA 컴포넌트 매핑표**

| 디자인 원본 (`public/game/`) | 이식 대상 (SPA) | 비고 |
|---|---|---|
| `Intro - Debt Setup.html` | `pages/IntroPage.jsx` | 난이도 카드 → 픽셀 스타일 |
| `Main Screen.html` | `pages/MainPage.jsx` + `StatusBar` | bg_room + btn_market/news/portfolio/calendar/game/nextturn 에셋 |
| `Loanshark Call.html` | `EventPopup` (loan_shark_call) | bg_room + phone.png, 유형별(압박/위협) 대화 연출 |
| `Loanshark Visit.html` | `RepaymentModal` | 월말 상환 분기 연출 |
| `Holiday Event.html` | `EventPopup` (holiday) | bg_family |
| `Travel Event.html` | `EventPopup` (travel) | bg_travel |
| `Wedding Event.html` | `EventPopup` (condolence:wedding) | bg_wedding |
| `Faint Event.html` | 기절 연출 (MainPage 오버레이) | bg_hospital_ceiling |
| `Final Result.html` | `pages/ResultPage.jsx` (success) | |
| `Bad End - Bankruptcy.html` | `pages/ResultPage.jsx` (failed) | |
| `Minigame_Catch_Waxon.html` | `minigames/CatchWaxon.jsx` | bird.png, boong_bg.png, dragon_* 에셋 |
| `Minigame_Professor_Proposal_v2.html` | `minigames/AvoidProfessor.jsx` | professor_*, run/walk 스프라이트 |
| (디자인 없음) | `minigames/PassengerTetris.jsx` | **테트리스 디자인 페이지 제작 필요** |
| (디자인 없음) | `SideJobModal`, `SurgeStockPopup`, `AuthPanel`, `PortfolioModal`, `NewsModal`, `MarketModal`, `AssetDetailModal`, `CalendarModal`, `ReportModal`, `OpeningPage` | 디자인 시안 추가 제작 대상 |

이식 순서 권장: Main Screen → Intro → 이벤트 3종(Call/Visit/Faint) → 미니게임 2종 → 엔딩 2종.
이식이 끝난 디자인 페이지는 지우지 말고 `public/game/`에 원본으로 유지한다 (디자인 레퍼런스).

**추가 연출/UI 작업 (기존 D 목록)**

| # | 작업 | 지점 |
|---|---|---|
| D-a | 오프닝 컷신/일러스트 | `OpeningPage` STORY 배열 |
| D-b | 캘린더 월 그리드 UI | `CalendarModal` |
| D-c | 캔들차트/거래량 바 | `PriceChart` |
| D-d | 엔딩 월별 자산 추이 차트 + AI 분석 표시 | `ResultPage` |
| D-e | 사운드/BGM (선택) | 신규 |

### Phase E — 밸런싱·플레이테스트

> Phase A~B 완료 후. 완료 기준: 난이도별 목표 클리어율에 대한 팀 합의 + 그 수치 달성.

1. 자동 시뮬레이션 먼저: "매턴 랜덤 매매 봇" / "현금 보유 봇" 스크립트(`server/scripts/simulate.js` 신설 권장)로 240턴 1,000회 돌려 클리어율/파산 원인 분포 측정.
2. 조정 노브는 전부 `constants.js`: 월급, 생활비 기준, 상환 요구율, 이벤트 확률, 급등주 기대값, 부업 기본급.
3. 사람 테스트: 난이도별 3회씩, 스트레스 100 도달 빈도/독촉전화 체감 빈도 기록.
4. 목표 가이드(합의 전 초안): easy 60~70% / normal 35~45% / hard 15~25% 클리어.

### Phase F — 안정화·마감 (10~11월, 간트 원계획 유지)

- 전체 회귀 테스트: ARCHITECTURE.md §13 체크리스트 재실행 (실데이터 기준).
- 세션 만료/동시성 등 엣지 케이스: 같은 세션 두 탭 거래(행잠금은 있음), 새로고침 복구, 게스트 세션 유실 안내.
- 보안 보강(§4), 에러 메시지 정리, 로딩 상태 정돈.
- 논문/발표 자료: `server/scripts/simulate.js` 결과(클리어율 곡선)와 데이터 파이프라인 규모(뉴스 13,497건 등)가 좋은 소재.

### 권장 진행 순서 요약

```
지금 →  A(실데이터, data 담당) ──┐
        D(디자인, frontend 담당) ─┼─ 병행 가능
        B(로직 마감, gamelogic) ──┘
     →  C(LLM)  →  E(밸런싱)  →  F(안정화/논문)
```

---

## 4. Git 협업 · 병합 규칙

2026-07-07 병합(f09aeeb)에서 로컬 스캐폴드와 팀원 프론트가 같은 경로에서 충돌했다. 재발 방지를 위한 규칙:

### 4-1. 기본 워크플로우

```bash
# 작업 시작 전 (항상)
git pull --rebase origin main        # 내 커밋을 최신 원격 위로 재배치

# 작업 → 커밋 → 푸시 전 (항상)
git fetch origin
git log --oneline main..origin/main  # 원격에 새 커밋이 있는지 확인
git pull --rebase origin main        # 있으면 rebase 후 충돌 해소
npm run build (frontend) + node --check (server)  # 충돌 해소 후 반드시 빌드 확인
git push origin main
```

- 소규모 팀이므로 `main` 직접 커밋 유지하되, **푸시 전 pull --rebase가 필수**다. 이번처럼 3커밋 vs 7커밋으로 갈라진 뒤에는 병합 비용이 커진다.
- **이틀 이상 걸리는 큰 작업은 브랜치**(`feat/<이름>`)로 하고, 끝나면 본인이 rebase 후 머지한다.
- 푸시했으면 팀 채팅에 한 줄 공유: "어떤 파일을 건드렸는지".

### 4-2. 영역 오너십 (충돌 예방의 핵심)

| 경로 | 오너 | 다른 사람이 고칠 때 |
|---|---|---|
| `server/**` | 백엔드 담당 | 사전 합의 |
| `frontend/src/**` | 프론트(SPA) 담당 | 사전 합의 |
| `frontend/public/game/**` | 디자인 담당 (정적 원본, 자유롭게 추가) | 건드리지 않기 |
| `server/migrations/**` | 백엔드 담당. **번호 이어 새 파일로만 추가** (기존 파일 수정 금지) | PR/합의 필수 |
| `server/src/config/constants.js` | 게임로직 담당 | 수치만 변경 가능 |
| `ARCHITECTURE.md` | 공동 — 설계 회의 후 | 충돌나면 회의 |

### 4-3. 이번 병합에서 정한 것 (f09aeeb 기록)

- **본편은 서버 연동 SPA** (`/`), 팀원의 mock SPA(src/)는 서버 연동본으로 대체. 단 팀원의 **mockApi.js는 `VITE_USE_MOCK` 스위치로 통합**되어 백엔드 없이 개발하는 워크플로우는 그대로 살아 있다.
- **디자인 게임은 전부 보존** (`public/game/` + `/design.html` 런처). SPA 이식은 Phase D 매핑표대로.
- `app.html` 삭제 (SPA가 `/`를 차지해 중복). 디자인 게임 진입은 `design.html`.
- `stock_price_detail`에서 OHLC 제거(팀원 수정 채택 — DataGuide 원천에 종가만 있음). migration/적재기/문서 모두 반영.
- 같은 화면을 다시 만드는 낭비를 막기 위해, **새 화면을 만들기 전에 §3-D 매핑표에서 담당/이식 여부를 먼저 확인**할 것.

## 5. 리스크 / 결정 필요 항목

| 항목 | 내용 | 결정 주체/시점 |
|---|---|---|
| 마스킹 사전 | A1 없이는 실데이터 시연 불가. 뉴스 본문 치환까지 포함해야 함 | data 담당, **가장 먼저** |
| 급등주 기대값 | 기획 문서에 결과 확률 미확정 — 유혹 이벤트로서 기대값 음수 여부 | 팀 회의 (Phase B) |
| LLM 비용/키 | 어떤 모델/예산인지, 키 관리(서버 env, 레포 커밋 금지) | Phase C 착수 시 |
| 인증 보안 | 토큰 만료 없음, 레이트리밋 없음, 비밀번호 정책 최소 — 교내 시연 수준은 OK, 공개 배포 전 보강 필수 | Phase F |
| DB 비밀번호 | docker-compose 기본값 `password` — 외부 노출 시 반드시 변경 | 배포 시 |
| 부업 중도 이탈 | 미니게임 도중 모달을 닫으면 미제출(기회 유지) — 악용 여지(결과 나쁠 때 이탈). "시작 시 소모"로 바꿀지 결정 | 팀 회의 (Phase B) |
| 저장 데이터 정합 | 게스트 세션은 localStorage 유실 시 복구 불가 — 안내 문구 또는 로그인 유도 | Phase D |

---

## 6. 현재 열려 있는 TODO 전체 목록 (2026-07-07 grep 기준)

**data (7)** — Phase A 대응: 마스킹 사전 2건(`maskingService`), 갤러리 매핑(`import_community`), npq 수급(`import_stocks`), masked_name/섹터(`import_stocks`), 반기 재무(`import_all`), 코인 티어(`import_coins`). ~~명절 달력~~ (2026-07-07 완료)

**gamelogic (7)** — Phase B/C 대응: 부업 점수 컷·랜덤 이벤트 확률·급등주 가중치(`constants`), 재무 공시 시점(`pricingService`), 스터디 힌트(`eventEngine`), LLM 주간/최종(`reportService` 2건).

**frontend (4)** — Phase D 대응: 캔들차트(`PriceChart`), 월 그리드 캘린더(`CalendarModal`), 오프닝 컷신(`OpeningPage`), 엔딩 차트/AI 분석(`ResultPage`).

최신 목록은 항상 `grep -rn "TODO(" server frontend`가 기준이다.
