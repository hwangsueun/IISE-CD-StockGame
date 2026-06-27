# 레포 대조 검증 — 내 설계 vs `IISE-CD-StockGame`

대상 레포: `https://github.com/hwangsueun/IISE-CD-StockGame` (현재 `ARCHITECTURE.md`, `TECH_STACK.md`만 존재, 코드 없음)

## 한 줄 결론
방향(순수 PostgreSQL · Express+pg · REST · 데이터 파이프라인 분리)은 **일치**한다. 그러나 **DB 스키마 모델 · 사용 언어 · 턴 처리 방식 · 게임 범위**가 레포 기준과 **어긋난다**. 레포는 기능명세서 전체가 아니라 **축소 MVP**(5턴·4종목·주식만)를 정의하고 있어, 내가 만든 풀스코프 설계와 차이가 크다.

---

## 1. 일치하는 부분 ✅
- 순수 PostgreSQL, Supabase 미사용, 자체 호스팅 — 일치.
- 백엔드 Express(Node) + `pg`, REST API로 턴 데이터·뉴스·주가 전달 — 일치.
- 프론트 ← API ← DB 3단 구조 — 일치.
- 매수/매도·평균단가·게임 세션 개념 — 일치.
- 데이터 파이프라인: Python · GDELT/DART · GPT-4o Batch — 내가 분석한 `news_generator`와 일치.

---

## 2. 어긋나는 부분 ❌ (수정 필요)

### 2-1. 사용 언어 / 백엔드 구조
| 항목 | 레포 기준 | 내가 만든 것 | 조치 |
|---|---|---|---|
| 백엔드 언어 | **JavaScript (plain)** | TypeScript | JS로 변환 또는 합의 |
| 구조 | `routes/ controllers/ services/` (MVC) | `repositories/` (리포지토리) | 레포 폴더 구조로 재배치 |
| 폴더 | `server/src/...`, `migrations/`, `seeds/`, `Dockerfile` | `backend/src/...` | `server/`로 정렬 |
| 프론트 | React 19 + Vite + **JSX(JS)** | HTML 예제 / TS 데모 | React19 JS로 |

### 2-2. 포트 · DB 이름
| 항목 | 레포 | 내것 | 조치 |
|---|---|---|---|
| API 포트 | **3001** | 4000 | 3001로 |
| DB/계정 | `antsurvival` / `admin` | `donghak` | 레포 값으로 |
| 인프라 | **Docker (docker-compose, postgres:16)** | 미사용(CI에만) | docker-compose 도입 |

### 2-3. DB 스키마 모델 — **가장 큰 차이**
레포는 `raw/core/game` 3계층이 아니라 **단일 평면 스키마**다. 테이블명·키 설계가 다르다.

| 개념 | 레포 스키마 | 내 schema.sql | 핵심 차이 |
|---|---|---|---|
| 종목 | `stocks(stock_code PK, stock_name, sector, is_game_stock)` | `core.asset`/`game.assets(asset_id)` | 레포는 **주식만**, code가 PK |
| 시세 | `stock_prices(stock_code, trade_date, close/open/high/low, volume)` | `game.asset_prices(asset_id, turn_index, ...)` | **레포는 trade_date 키 / 내것은 turn_index 글로벌** |
| 턴 | **세션마다** `game_turns(session_id, turn_number 1~5, trade_date)` | 글로벌 `game.game_calendar(turn_index)` | 레포는 **시작 시 5턴 날짜 선정**(세션 스코프) |
| 뉴스 | 단일 `news(news_type, stock_code, headline, body, sentiment, event_family, is_masked)` | `game.news(turn_index, importance, news_order, asset_class)` | 컬럼·키 다름 |
| 감정값 | `'positive'/'negative'/'neutral'` (**소문자**) | `'POSITIVE'/...` (대문자) | 케이스 불일치 |
| 세션 | `game_sessions(UUID, status, initial_cash, final_cash, loan_amount, loan_rate)` | (play 스키마로 제안만) | 레포가 더 단순·확정 |
| 거래 | `trades(session_id, turn_number, stock_code, trade_type, quantity, price, amount)` | (play.trade_log 제안) | 레포 컬럼 기준으로 |
| 종토방 | `npc_comments(comment_date, stock_code, npc_nickname, body, sentiment)` | 없음 | 추가 필요 |

> 결정적: 레포는 **트랜잭션 날짜(trade_date) 기반 + 세션별 5턴 선정** 모델이고, 내 설계는 **글로벌 turn_index** 모델이다. 둘은 호환되지 않으므로 레포 모델로 맞춰야 한다.

### 2-4. 게임 범위(스코프) — 명세서 vs 레포
| 요소 | 기능명세서(내 파이프라인 기준) | 레포 MVP | 비고 |
|---|---|---|---|
| 턴 | 일별(1일 1턴), 월간 20턴 사이클 | **5턴** | 레포가 대폭 축소 |
| 종목 | 주식+채권+코인 | **주식 4종목** | 채권·코인 없음 |
| 초기자금 | 설정값 | **100만원** | |
| 부채/상환 | 월말 상환·상환비율·신뢰도 | loan_amount/rate만 보유 | 상환 로직 미정의 |
| 스트레스/신뢰도 | 있음 | **스키마에 없음** | 이벤트 시스템 미포함 |
| 이벤트 엔진 | 있음(독촉·부업·급등주·경조사…) | **없음** | |
| 캘린더 메모 | 있음 | 없음 | |
| 회사명 마스킹 | 없음 | **2단계 마스킹(별칭→정식→가상)** | 레포 필수 |
| NPC 종토방 | 없음 | **있음(pr_dci06)** | 레포 필수 |

레포는 "플레이 가능한 핵심 루프"만 담은 MVP다. 내 파이프라인 문서는 기능명세서 **전체**(스트레스·신뢰도·이벤트·채권·코인·월간사이클)를 대상으로 해서 레포보다 범위가 크다.

---

## 3. 그래서, 내 산출물 상태
| 산출물 | 레포 정합성 | 처리 |
|---|---|---|
| `schema.sql` (raw/core/game 3계층, turn_index) | ❌ 모델 불일치 | 레포 평면 스키마로 재작성 |
| `etl_pipeline.py` | △ 부분 | 마스킹·NPC·news_type 통합 적재 반영 |
| `backend/` (TS, repositories) | ❌ 언어·구조 | JS MVC(`server/`)로 재작성 |
| `frontend-example/` (HTML) | △ | React19+Vite로 교체 |
| `game_dev_pipeline.md` | △ 방향 OK, 범위 과대 | 레포 MVP 범위로 축소 정렬 |
| `ci.example.yml` | ✅ 대부분 | 포트/DB명만 수정 |

---

## 4. 결론 & 선택지
1. **레포 MVP에 맞춤(권장)** — 레포의 평면 스키마·세션별 5턴·trade_date 모델·JS MVC·Docker로 내 산출물을 재작성. 가장 빠르게 실제 개발과 합류.
2. **기능명세서 풀스코프 유지** — 레포를 향후 확장 기준으로 보고 내 풀스코프 설계를 단계적 목표로. 단 현재 레포와는 당장 안 맞음.

핵심 질문: **레포가 지금의 정답(MVP 우선)인가, 기능명세서가 정답(레포는 1차 MVP)인가?**
- 레포 우선이면 → 레포 스키마/구조에 맞춰 `schema.sql`·`backend`를 재작성.
- 기능명세서 우선이면 → 레포 스키마를 확장하도록 팀과 합의 필요(스트레스·이벤트·채권·코인 테이블 추가).
