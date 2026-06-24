# 동학개미 서바이벌 — 서버/백엔드 아키텍처

## 전체 구조

```
[ React + Vite ]  ←→  [ Express API (Node.js) ]  ←→  [ PostgreSQL (Docker) ]
     프론트                    백엔드                         DB
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
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: ./server
    ports:
      - "3001:3001"
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://admin:(비밀번호)@db:5432/antsurvival

volumes:
  pgdata:
```

---

## 2. PostgreSQL DB 스키마

### 2-1. 종목 마스터

```sql
CREATE TABLE stocks (
  stock_code   VARCHAR(6)   PRIMARY KEY,      -- 005930
  stock_name   VARCHAR(100) NOT NULL,          -- 삼성전자
  sector       VARCHAR(50),                    -- 반도체
  is_game_stock BOOLEAN DEFAULT FALSE          -- 게임 등장 여부
);
```

게임 등장 4종목: 삼성전자(005930), SK하이닉스(000660), NAVER(035420), 현대차(005380)

---

### 2-2. 일별 주가

```sql
CREATE TABLE stock_prices (
  id           SERIAL       PRIMARY KEY,
  stock_code   VARCHAR(6)   REFERENCES stocks(stock_code),
  trade_date   DATE         NOT NULL,
  close_price  INT          NOT NULL,
  open_price   INT,
  high_price   INT,
  low_price    INT,
  volume       BIGINT,
  UNIQUE (stock_code, trade_date)
);
```

---

### 2-3. 뉴스 (통합)

뉴스 타입별로 구분. 데이터 파이프라인 산출물 5종을 하나의 테이블에 적재.

```sql
CREATE TABLE news (
  id           SERIAL       PRIMARY KEY,
  news_date    DATE         NOT NULL,
  news_type    VARCHAR(30)  NOT NULL,
  -- 'macro'        : 거시뉴스 (pr05, 하루 5건)
  -- 'stock'        : 개별주식뉴스 (pr06a outputs_all.jsonl, 1,634건)
  -- 'market'       : 시장/섹터뉴스 (market_news.jsonl, 9,169건)
  -- 'earnings'     : 연간실적뉴스 (annual_earnings_news.jsonl, 1,032건)
  -- 'stock_split'  : 분리기사-공시일 (split_articles_all.jsonl, 397건)
  -- 'stock_react'  : 분리기사-반응일 (split_articles_all.jsonl, 397건)
  -- 'npc'          : 종토방 NPC 댓글 (pr_dci06)

  stock_code   VARCHAR(6)   REFERENCES stocks(stock_code),  -- macro/market은 NULL
  headline     VARCHAR(300) NOT NULL,
  body         TEXT,
  sentiment    VARCHAR(20),     -- 'positive' | 'negative' | 'neutral'
  event_family VARCHAR(50),     -- earnings | contract | dividend | investment | ...
  is_masked    BOOLEAN DEFAULT TRUE   -- 회사명 마스킹 완료 여부
);

CREATE INDEX idx_news_date ON news(news_date);
CREATE INDEX idx_news_stock ON news(stock_code, news_date);
CREATE INDEX idx_news_type ON news(news_type, news_date);
```

---

### 2-4. 게임 세션

```sql
CREATE TABLE game_sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMP    DEFAULT NOW(),
  status        VARCHAR(20)  DEFAULT 'active',   -- active | completed | bankrupt
  initial_cash  INT          DEFAULT 1000000,
  final_cash    INT,
  loan_amount   INT          DEFAULT 0,
  loan_rate     NUMERIC(5,2) DEFAULT 0.20        -- 연 이자율
);
```

---

### 2-5. 게임 턴

```sql
CREATE TABLE game_turns (
  id           SERIAL   PRIMARY KEY,
  session_id   UUID     REFERENCES game_sessions(id),
  turn_number  INT      NOT NULL,   -- 1~5
  trade_date   DATE     NOT NULL,   -- 해당 턴의 실제 날짜
  UNIQUE (session_id, turn_number)
);
```

---

### 2-6. 거래 기록

```sql
CREATE TABLE trades (
  id           SERIAL      PRIMARY KEY,
  session_id   UUID        REFERENCES game_sessions(id),
  turn_number  INT         NOT NULL,
  stock_code   VARCHAR(6)  REFERENCES stocks(stock_code),
  trade_type   VARCHAR(4)  NOT NULL,   -- 'buy' | 'sell'
  quantity     INT         NOT NULL,
  price        INT         NOT NULL,
  amount       INT         NOT NULL,   -- quantity × price
  created_at   TIMESTAMP   DEFAULT NOW()
);
```

---

### 2-7. NPC 댓글 (종토방)

```sql
CREATE TABLE npc_comments (
  id            SERIAL      PRIMARY KEY,
  comment_date  DATE        NOT NULL,
  stock_code    VARCHAR(6)  REFERENCES stocks(stock_code),
  npc_nickname  VARCHAR(50),
  body          TEXT        NOT NULL,
  sentiment     VARCHAR(20)
);

CREATE INDEX idx_npc_date_stock ON npc_comments(comment_date, stock_code);
```

---

## 3. Express API 엔드포인트

### 게임 흐름

| Method | Endpoint | 설명 |
|---|---|---|
| `POST` | `/api/game/start` | 게임 시작 — 세션 생성, 5턴 날짜 선정 |
| `GET`  | `/api/game/:sessionId` | 현재 게임 상태 |
| `GET`  | `/api/game/:sessionId/turn/:n` | n번째 턴 데이터 (주가 + 뉴스) |
| `POST` | `/api/game/:sessionId/trade` | 매수/매도 실행 |
| `POST` | `/api/game/:sessionId/next-turn` | 다음 턴으로 진행 |
| `GET`  | `/api/game/:sessionId/result` | 최종 결산 결과 |

### 뉴스/데이터 조회

| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/news/:date` | 날짜별 거시뉴스 5건 |
| `GET` | `/api/news/:date/:stockCode` | 날짜 + 종목별 뉴스 |
| `GET` | `/api/npc/:date/:stockCode` | 날짜 + 종목별 종토방 댓글 |

---

### `POST /api/game/start` 응답 예시

```json
{
  "sessionId": "uuid-...",
  "initialCash": 1000000,
  "loanAmount": 500000,
  "stocks": ["005930", "000660", "035420", "005380"],
  "turns": [
    { "turnNumber": 1, "date": "2018-03-05" },
    { "turnNumber": 2, "date": "2018-05-14" },
    { "turnNumber": 3, "date": "2018-08-21" },
    { "turnNumber": 4, "date": "2018-10-09" },
    { "turnNumber": 5, "date": "2018-12-28" }
  ]
}
```

---

### `GET /api/game/:sessionId/turn/:n` 응답 예시

```json
{
  "turnNumber": 2,
  "date": "2018-05-14",
  "stocks": [
    { "stockCode": "005930", "stockName": "A전자", "price": 52400, "priceChange": 1.2 },
    { "stockCode": "000660", "stockName": "B하이닉스", "price": 81200, "priceChange": -0.8 },
    { "stockCode": "035420", "stockName": "C버", "price": 143000, "priceChange": 2.1 },
    { "stockCode": "005380", "stockName": "D자동차", "price": 33100, "priceChange": -1.5 }
  ],
  "news": [
    { "id": 1, "type": "macro", "headline": "한국은행 기준금리 1.5% 동결", "body": "...", "sentiment": "neutral" },
    { "id": 2, "type": "stock", "stockCode": "005930", "headline": "A전자 1분기 영업이익 서프라이즈", "body": "...", "sentiment": "positive" }
  ],
  "cash": 850000,
  "holdings": {
    "005930": { "quantity": 3, "avgPrice": 51000 }
  }
}
```

---

## 4. 폴더 구조 (Express 서버)

```
server/
├── src/
│   ├── index.js             # 서버 진입점
│   ├── db.js                # PostgreSQL 연결 (pg 모듈)
│   ├── routes/
│   │   ├── game.js          # 게임 세션 라우터
│   │   ├── news.js          # 뉴스 조회 라우터
│   │   └── npc.js           # 종토방 댓글 라우터
│   ├── controllers/
│   │   ├── gameController.js
│   │   ├── newsController.js
│   │   └── npcController.js
│   └── services/
│       ├── turnSelector.js  # 5턴 날짜 선정 로직
│       └── maskingService.js # 회사명 마스킹
├── migrations/
│   └── 001_init.sql         # 초기 스키마
├── seeds/
│   └── import_news.js       # 뉴스 데이터 적재 스크립트
├── Dockerfile
└── package.json
```

---

## 5. 턴 날짜 선정 로직

게임 시작 시 1년치 데이터(예: 2018년)에서 5개 날짜를 자동 선정.

```
규칙:
- 2018년 거래일 중에서 선정
- 1턴 ~ 5턴 날짜 간격: 최소 30일 이상
- 각 턴에 뉴스가 1건 이상 존재하는 날짜만 후보
- 랜덤 선정 (seed 값으로 재현 가능)
```

---

## 6. 데이터 적재 순서

파이프라인 완성 후 아래 순서로 DB에 적재.

```
1. stocks 마스터 등록
2. stock_prices 일별 주가 적재
3. news 테이블:
   a. 거시뉴스 (generated_macro_news_all.csv)
   b. 개별주식뉴스 (outputs_all.jsonl)
   c. 시장/섹터뉴스 (market_news.jsonl)
   d. 연간실적뉴스 (annual_earnings_news.jsonl)
   e. 분리기사 (split_articles_all.jsonl)
4. npc_comments 적재 (pr_dci06 출력)
5. 회사명 마스킹 일괄 적용 (is_masked = TRUE)
```

---

## 7. 개발 환경 실행

```bash
# DB + API 컨테이너 시작
docker-compose up -d

# DB 스키마 초기화
docker exec -i antsurvival_db psql -U admin -d antsurvival < migrations/001_init.sql

# 뉴스 데이터 적재
node seeds/import_news.js

# React 개발 서버 (별도 터미널)
cd stock-game-frontend && npm run dev
```

---

## 8. 환경변수 (.env)

```
DATABASE_URL=postgresql://admin:password@localhost:5432/antsurvival
PORT=3001
CORS_ORIGIN=http://localhost:5173
```
