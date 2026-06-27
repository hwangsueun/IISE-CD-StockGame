# 동학개미 서바이벌 — 개발 파이프라인 (팀 공유용)

> 이 문서는 데이터 → DB → 백엔드 → 게임으로 이어지는 전체 개발 파이프라인을 팀원이 한눈에 검토할 수 있게 정리한 것이다. 레포의 `ARCHITECTURE.md` / `TECH_STACK.md`를 기준으로 작성했다.

---

## 0. 전체 그림

```
[데이터 파이프라인 (Python, 오프라인 배치)]
   Google Drive 원천 + 뉴스 생성 레포(news_generator)
        │  ETL (정제·마스킹·적재)
        ▼
[PostgreSQL (Docker, postgres:16, DB=antsurvival)]
   stocks · stock_prices · news · npc_comments · game_sessions · game_turns · trades
        │  SQL (pg)
        ▼
[백엔드 (Express, plain JS, MVC, 포트 3001)]
   routes → controllers → services
        │  REST / JSON
        ▼
[프론트 (React 19 + Vite, JS)]
   5턴 · 4종목 투자 시뮬레이션
```

- 순수 PostgreSQL(Supabase 미사용, 자체 호스팅).
- 런타임(게임)과 데이터 적재(ETL)는 분리된 파이프라인이다.

---

## 1. 게임 범위 (현재 MVP)

| 항목 | 값 |
|---|---|
| 턴 | 5턴 (게임 시작 시 2018년 거래일 중 자동 선정, 턴 간 ≥30일, 뉴스 있는 날만) |
| 종목 | 4종목 — 삼성전자(005930)·SK하이닉스(000660)·NAVER(035420)·현대차(005380) |
| 초기 자금 | 1,000,000원 / 초기 대출 500,000원(연 20%) |
| 뉴스 | 턴당 최대 5건 (거시 + 개별주식) |
| 회사명 | 2단계 마스킹(별칭→정식→가상)으로 실명 비노출 |

> 채권·코인·스트레스/신뢰도·이벤트·월간 상환은 기능명세서엔 있으나 **현재 MVP 범위 밖**(향후 확장).

---

## 2. 데이터 파이프라인 (Python)

| 단계 | 산출물 | DB 적재 |
|---|---|---|
| 개별주식뉴스 | `pr05d → pr05e → pr05f → pr06a` (Batch API) → `outputs_all.jsonl` | `news(news_type='stock')` |
| 거시뉴스 | `pr05` (Realtime) → `generated_macro_news_all.csv` | `news(news_type='macro')` |
| 시장/섹터·연간실적·분리기사 | `market_news.jsonl` · `annual_earnings_news.jsonl` · `split_articles_all.jsonl` | `news(market/earnings/stock_split/stock_react)` |
| 종토방 NPC | `pr_dci06` (Batch) | `npc_comments` |
| 주가 | 드라이브 원천 정제 | `stock_prices` |

적재 순서: ① stocks 마스터 → ② stock_prices → ③ news(거시→개별→시장→실적→분리) → ④ npc_comments → ⑤ 회사명 마스킹 일괄(`is_masked=TRUE`).
데이터 미완성 단계에서는 `node seeds/import_news.js --stub`으로 stub 데이터를 넣어 프론트 개발을 진행한다.

---

## 3. DB 스키마 (PostgreSQL)

`server/migrations/001_init.sql` 참고. 7개 테이블:

- `stocks` — 종목 마스터(code PK, name, sector, is_game_stock)
- `stock_prices` — 일별 OHLCV (stock_code, trade_date 유니크)
- `news` — 통합 뉴스(news_type, stock_code, headline, body, sentiment, event_family, is_masked)
- `npc_comments` — 종토방 NPC 댓글
- `game_sessions` — 세션(UUID, status, initial/final_cash, loan)
- `game_turns` — 세션별 5턴 날짜
- `trades` — 매수/매도 체결 로그

키 설계: 시세는 **trade_date** 기준, 턴은 **세션마다 선정**(글로벌 캘린더 아님).

---

## 4. 백엔드 구조 (`server/`)

```
server/src/
├── index.js              # 진입점(3001)
├── db.js                 # pg 풀 + 트랜잭션
├── routes/   game.js · news.js · npc.js
├── controllers/ gameController · newsController · npcController
└── services/  turnSelector(5턴 선정) · maskingService(회사명 마스킹)
```

### API
| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/game/start` | 세션 생성 + 5턴 날짜 선정 |
| GET | `/api/game/:sessionId` | 게임 상태(현금·보유) |
| GET | `/api/game/:sessionId/turn/:n` | n턴 데이터(시세+뉴스+현금+보유) |
| POST | `/api/game/:sessionId/trade` | 매수/매도(정수·현금·보유 검증, 수수료 0, 즉시 체결) |
| POST | `/api/game/:sessionId/next-turn` | 다음 턴 |
| GET | `/api/game/:sessionId/result` | 최종 결산(총자산·순자산·수익률·승패) |
| GET | `/api/news/:date` · `/api/news/:date/:stockCode` | 뉴스 조회 |
| GET | `/api/npc/:date/:stockCode` | 종토방 댓글 |

---

## 5. 개발 로드맵 / 마일스톤

각 단계가 "플레이 가능한 슬라이스"로 끝나게 수직 분할.

| Phase | 목표 | 상태 |
|---|---|---|
| P0 기반 | DB 스키마 + Docker + 서버 부트스트랩 + 헬스체크 | ✅ 스캐폴드 완료·검증 |
| P1 게임 코어 | start·turn·trade·next-turn·result (5턴 루프) | ✅ 구현·통합테스트 통과 |
| P2 데이터 적재 | 실데이터 ETL → DB (마스킹·NPC 포함) | ⏳ stub→실데이터 연결 |
| P3 프론트 | React19+Vite 화면(대시보드·투자·뉴스·결산) | ⏳ 착수 전 |
| P4 확장 | 종토방·참고지표·포트폴리오 수익분석 | 후순위 |
| P5 안정화 | 밸런싱·배포 | 후순위 |

---

## 6. 개발 환경 실행

```bash
# DB + API 컨테이너 (스키마 자동 적용)
docker-compose up -d

# 데이터 미완성 시 stub 시드
docker exec antsurvival_api node seeds/import_news.js --stub

# 헬스체크
curl http://localhost:3001/health

# 프론트(별도)
cd stock-game-frontend && npm run dev   # http://localhost:5173
```

환경변수(`server/.env.example`): `DATABASE_URL`, `PORT=3001`, `CORS_ORIGIN`, `GAME_YEAR=2018`, `DEFAULT_LOAN=500000`.

---

## 7. 검증 상태 (현재까지)

- DB 스키마: PostgreSQL 16에서 7개 테이블 생성 확인.
- 백엔드: JS 11개 파일 구문 검사 통과.
- 게임 흐름: 실제 PostgreSQL + 실제 컨트롤러로 **통합테스트 15/15 통과**
  (start 5턴·4종목 → turn 시세/뉴스/현금 → 매수·매도 + 현금부족/보유초과/비정수 거부 → result 결산).

---

## 8. 다음 작업

1. `seeds/import_news.js`를 실제 파이프라인 산출물(JSONL/CSV)에 연결 + `stock_prices`·`npc_comments` 적재 추가.
2. 프론트(React19+Vite) 화면 스캐폴드.
3. CI(임시 PostgreSQL로 스키마+통합테스트) 연결.

---

## 부록 — 기존 설계와의 관계

초기에 기능명세서 전체(채권·코인·스트레스·이벤트·turn_index 글로벌 모델, TypeScript)를 기준으로 만든 설계가 있었으나, **레포 기준(평면 스키마·세션별 5턴·trade_date·JS MVC·Docker)으로 전면 정렬**했다. 상세 갭 분석은 `repo_alignment_check.md` 참고.
