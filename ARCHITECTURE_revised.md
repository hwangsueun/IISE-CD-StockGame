# 동학개미 서바이벌 (ANT SURVIVAL) — 서버/백엔드 아키텍처

> 스코프: 캡스톤 **중간보고서 풀스코프**(131자산·240턴·스트레스/신뢰도/이벤트/상환/종토방). 기술스택은 `TECH_STACK.md` 정의 유지.

## 전체 구조

```
[ React + Vite ]  ←→  [ Express API (Node.js, plain JS) ]  ←→  [ PostgreSQL (Docker) ]
     프론트                    백엔드 (MVC)                          DB (antsurvival)
```

---

## 1. Docker 컨테이너 구성

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: antsurvival
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: (비밀번호)
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./server/migrations:/docker-entrypoint-initdb.d   # 최초 기동 시 스키마 자동 적용
  api:
    build: ./server
    ports: ["3001:3001"]
    depends_on: [db]
    environment:
      DATABASE_URL: postgresql://admin:(비밀번호)@db:5432/antsurvival
volumes:
  pgdata:
```

---

## 2. PostgreSQL DB 스키마 (19개 테이블)

전체 DDL은 `server/migrations/001_init.sql`. 그룹별 요약:

### 2-A. 자산 (주식 117 + 채권 4 + 코인 10 = 131)

```sql
CREATE TABLE assets (
  asset_id    VARCHAR(20) PRIMARY KEY,   -- STOCK_005930 / BOND_KTB3Y / COIN_BTC
  asset_type  VARCHAR(10) NOT NULL,      -- stock | bond | coin
  code        VARCHAR(20),
  name        VARCHAR(100) NOT NULL,     -- 실제명(내부용)
  masked_name VARCHAR(100),              -- 게임 표시용 가상명
  sector      VARCHAR(50),               -- FnGuide 중분류(주식)
  currency    VARCHAR(3) DEFAULT 'KRW',  -- KRW | USD(코인)
  is_active   BOOLEAN DEFAULT TRUE
);
```
- `stock_financials` (asset_id, fiscal_year, 매출/영업이익/순이익/부채총계/현금성/재고, 재무비율, PER·PBR·PSR·EV/EBITDA·ROE·ROA·EPS·BPS·SPS, 시가총액)
- `bond_info` (asset_id, bond_type, credit_rating, maturity) — 국고채 3·10년, 회사채 AAA·BBB
- `coin_info` (asset_id, symbol, market_cap_tier)

### 2-B. 일별 시세 (전 자산 통합)

```sql
CREATE TABLE asset_prices (
  asset_id    VARCHAR(20) REFERENCES assets(asset_id),
  trade_date  DATE NOT NULL,
  close_price NUMERIC NOT NULL,   -- 코인/채권 소수 → NUMERIC, 코인 USD→KRW 변환
  open_price  NUMERIC, high_price NUMERIC, low_price NUMERIC,
  volume      BIGINT, change_rate NUMERIC,
  PRIMARY KEY (asset_id, trade_date)
);
```

### 2-C. 거시/투자지표

- `macro_indicators` (indicator_code, display_name, unit) — 기준금리·USD/KRW·CPI·국채금리·WTI·금·경기선행지수
- `macro_daily` (indicator_code, trade_date, value)

### 2-D. 뉴스 (통합) + 태그

```sql
CREATE TABLE news (
  id SERIAL PRIMARY KEY,
  news_date DATE NOT NULL,
  news_type VARCHAR(30) NOT NULL,   -- macro | stock | market | earnings | stock_split | stock_react
  asset_id  VARCHAR(20) REFERENCES assets(asset_id),  -- 거시/시장은 NULL
  headline  VARCHAR(300) NOT NULL, body TEXT,
  sentiment VARCHAR(20),            -- positive | negative | neutral
  event_family VARCHAR(50), is_masked BOOLEAN DEFAULT TRUE
);
```
- `news_tags` (news_id, tag_type[asset|sector|category], tag)

### 2-E. 종토방 (디시인사이드 기반, 읽기 전용)

- `community_posts` (id, post_date, asset_id, npc_nickname, title, body, recommend_count, sentiment)
- `community_comments` (id, post_id, npc_nickname, body, sentiment)

### 2-F. 플레이어 진행 데이터

```sql
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(20) DEFAULT 'active',     -- active | success | failed
  start_date DATE, current_turn INT DEFAULT 1,        -- 1~240
  initial_cash INT DEFAULT 50000000,
  debt_initial INT NOT NULL,               -- 5천만/1억/1.5억 (난이도)
  cash INT NOT NULL, debt INT NOT NULL,
  stress INT DEFAULT 0   CHECK (stress BETWEEN 0 AND 100),
  trust  INT DEFAULT 100 CHECK (trust  BETWEEN 0 AND 100),
  final_cash INT
);
```
- `game_turns` (session_id, turn_number 1~240, trade_date)
- `holdings` (session_id, asset_id, quantity, avg_price)
- `trades` (session_id, turn_number, asset_id, trade_type, quantity, price, amount, realized_pnl)
- `repayments` (session_id, month_index 1~12, due_amount, paid_amount, ratio, trust_delta, stress_delta)
- `event_log` (session_id, turn_number, event_type, detail JSONB, cash/stress/trust_delta)
- `memos` (session_id, game_date, content) — 캘린더, 한글 100자
- `news_exposure` (session_id, game_date, news_id) — 스트레스 제한 반영 노출 기록

---

## 3. Express API 엔드포인트

### 게임 흐름

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/game/start` | 세션 생성(난이도=부채 선택) + 240턴 날짜 + 초기 상태 |
| GET | `/api/game/:sessionId` | 현재 상태(현금·총자산·부채·스트레스·신뢰도·턴) |
| GET | `/api/game/:sessionId/turn/:n` | n턴 데이터(자산 시세 + 뉴스 + 상태) |
| POST | `/api/game/:sessionId/trade` | 매수/매도(정수·즉시체결·수수료0) |
| POST | `/api/game/:sessionId/next-turn` | 턴 진행(가격·뉴스·이벤트·상태 갱신, 자동저장) |
| POST | `/api/game/:sessionId/repay` | 월말 상환(20턴 주기) → 신뢰도/스트레스 반영 |
| POST | `/api/game/:sessionId/event` | 이벤트 수락/거절 결과 처리 |
| GET | `/api/game/:sessionId/portfolio` | 보유·평가금액·수익률·자산 비중 |
| GET | `/api/game/:sessionId/report/monthly/:m` · `/report/final` | 월간·최종 리포트 |
| GET | `/api/game/:sessionId/result` | 최종 결산(성공/실패) |

### 자산 / 데이터 조회

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/api/assets?type=stock\|bond\|coin&sort=volume\|gainers` | 종목 리스트(Top 목록·필터) |
| GET | `/api/assets/:assetId` | 종목 상세(정보·재무비율·가치평가) |
| GET | `/api/assets/:assetId/prices?from=&to=` | 차트용 기간 시세 |
| GET | `/api/macro/:date` | 투자지표(기준금리·환율·CPI·국채·WTI·금·선행지수) |
| GET | `/api/news/:date` · `/api/news/:date/:assetId` | 뉴스 조회(태그 포함) |
| GET | `/api/community/:assetId?date=` | 종토방 게시글 목록 |
| GET | `/api/community/post/:postId/comments` | 게시글 댓글 |
| POST/GET/PUT/DELETE | `/api/game/:sessionId/memo` | 캘린더 메모(당일만 수정/삭제) |

### `GET /api/game/:sessionId/turn/:n` 응답 예시
```json
{
  "turnNumber": 45, "date": "2018-05-14", "monthIndex": 3,
  "isRepaymentTurn": false,
  "state": { "cash": 38500000, "totalAsset": 51200000, "debt": 50000000, "stress": 42, "trust": 88 },
  "stocks": [{ "assetId": "STOCK_005930", "name": "A전자", "price": 52400, "changeRate": 0.012 }],
  "news": [{ "id": 1, "type": "macro", "headline": "한국은행 기준금리 동결", "sentiment": "neutral" }],
  "newsLimit": 8
}
```

---

## 4. 폴더 구조 (Express 서버)

```
server/
├── src/
│   ├── index.js              # 진입점(3001)
│   ├── db.js                 # pg 풀 + 트랜잭션
│   ├── routes/   game.js · assets.js · news.js · community.js · portfolio.js · event.js · repayment.js · memo.js
│   ├── controllers/  game · asset · news · community · portfolio · event · repayment · memo
│   └── services/
│       ├── turnSelector.js     # 240거래일 선정
│       ├── pricingService.js   # 현재가/기간시세 + USD→KRW 환율변환
│       ├── tradeService.js     # 매수/매도·평균단가·실현손익
│       ├── valuationService.js # 총자산/순자산/수익률/비중
│       ├── eventEngine.js      # 발생판단·확률·중복·결과반영(8종 이벤트)
│       ├── stressPolicy.js     # 스트레스 변동·뉴스 열람 제한
│       ├── trustPolicy.js      # 신뢰도·독촉전화 연동
│       ├── repaymentService.js # 월말 상환 비율 → 신뢰도/스트레스
│       ├── reportService.js    # 월간/최종 리포트
│       └── maskingService.js   # 회사명 2단계 마스킹
├── migrations/  001_init.sql   # 초기 스키마(19테이블)
├── seeds/       import_news.js # 데이터 적재(--stub 지원)
├── Dockerfile
└── package.json
```

---

## 5. 턴 진행 로직

- 게임 시작 시 데이터 범위 내 **시작일을 랜덤 지정**, 이후 **240거래일**을 `game_turns`에 1~240으로 적재(주말 제외).
- 1턴 = 거래일 하루, **20턴 = 1개월** → turn 20·40·…·240에서 월말 상환창 + 월간 리포트.
- 턴 종료 시: 가격 갱신 → 평가 갱신 → 뉴스 갱신(스트레스 제한) → 이벤트 체크 → 상태(스트레스/신뢰도) 갱신 → 자동저장.
- 휴장일/부업일은 투자 제한, 기절·입원은 3거래일 행동 제한.

---

## 6. 데이터 적재 순서

```
1. assets 마스터 (주식 117 + 채권 4 + 코인 10)
2. asset_prices 일별 시세
3. stock_financials / bond_info / coin_info
4. macro_indicators + macro_daily
5. news (거시→개별→시장→실적→분리) + news_tags
6. community_posts + community_comments (종토방)
7. 회사명 가명 마스킹 일괄 적용 (is_masked = TRUE)
```

---

## 7. 개발 환경 실행

```bash
docker-compose up -d
docker exec antsurvival_api node seeds/import_news.js --stub   # 데이터 미완성 시
curl http://localhost:3001/health
cd stock-game-frontend && npm run dev   # http://localhost:5173
```

---

## 8. 환경변수 (.env)

```
DATABASE_URL=postgresql://admin:password@localhost:5432/antsurvival
PORT=3001
CORS_ORIGIN=http://localhost:5173
GAME_START_RANGE=2013-01-01..2023-12-31
```

---

## 9. 비고 — 프로토타입과의 차이

이전 버전은 4종목·5턴·7테이블 프로토타입이었다. 본 문서는 **중간보고서 풀스코프**(131자산·240턴·19테이블·스트레스/신뢰도/이벤트/상환)로 갱신했으며, **기술스택(React19+Vite·Express JS·PostgreSQL Docker)은 동일**하다.
