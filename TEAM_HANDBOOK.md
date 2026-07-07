# 팀원용 왕초보 개발 핸드북 (ANT SURVIVAL)

> **이 문서는 코딩이 익숙하지 않은 팀원을 위한 문서다.**
> 모든 명령은 **복사–붙여넣기**로 실행할 수 있게 적었고, "어느 파일의 몇 번째 근처를 고치면 되는지"까지 적었다.
> 막히면 §7(에러가 나면)부터 보고, 그래도 안 되면 §7-4에 적힌 3가지를 캡처해서 팀 채팅에 올리면 된다.

**문서 3개의 역할** (헷갈리면 이것만 기억):

| 문서 | 언제 보나 |
|---|---|
| **TEAM_HANDBOOK.md (이 문서)** | 처음 세팅할 때, 뭔가 고치고 싶을 때, 에러 났을 때 |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | 전체 일정/작업 순서가 궁금할 때 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 설계(DB/API)가 궁금할 때 — 초보는 몰라도 됨 |

---

## 0. 전체 그림 — 데이터가 게임 화면까지 오는 길

> 코드를 고치기 전에 이 절만 읽으면 "내가 지금 어디를 만지고 있는지"를 안다.
> §0-3부터는 **직접 명령을 쳐서 눈으로 확인**하는 실습이다 (§2-2의 서버/DB가 켜져 있어야 함).

### 0-1. 한 장 지도

```
[1] 원천 데이터           [2] 데이터 공장              [3] 최종 재료 파일
 실제 금융 세계            (data-pipeline 레포,          뉴스 4종 .jsonl
 FnGuide 주가             파이썬, 오프라인 작업)   →     주가 .xlsx
 CoinGecko 코인      →    수집·정제·LLM 뉴스생성        거시지표 .csv
 GDELT/DART 뉴스원천      * 이미 대부분 완료             코인/채권 .csv
 디시인사이드 종토방                                     디시 글 .csv
                                                          │
                                              [4] 지게차: 적재 스크립트
                                               server/seeds/import_*.js
                                               (연습용은 npm run seed:stub)
                                                          ▼
                                              [5] 창고: PostgreSQL DB (Docker)
                                               28개 테이블 — 게임 재료 + 내 게임 기록
                                                          │  SQL
                                                          ▼
                                              [6] 게임 마스터: 서버 (server/)
                                               Express API, http://localhost:3001
                                               돈·스트레스·이벤트 등 모든 규칙 계산
                                                          │  JSON (API)
                                                          ▼
                                              [7] 화면: 프론트 (frontend/)
                                               React, http://localhost:5173
                                               보여주기 + 버튼 입력 전달만 함
```

| 단계 | 있는 곳 | 담당 | 팀원(디자인/프론트)이 만질 일 |
|---|---|---|---|
| [1]~[3] 데이터 공장 | **별도 레포** `data-pipeline` (파이썬) | 수은 | 없음 — 결과 파일만 받아서 씀 |
| [4] 적재 | `server/seeds/` | 수은 | `npm run seed:stub` 실행만 |
| [5] 창고(DB) | Docker 컨테이너 `antsurvival_db` | 수은 | 들여다보기만 (§0-6) |
| [6] 게임 마스터 | `server/src/` | 수은 | `constants.js` 수치, `eventEngine.js` 문구 |
| [7] 화면 | `frontend/src/` | **팀원 메인 구역** | §3 표, §4 레시피 |

핵심 원칙 하나만 기억: **계산은 전부 [6] 서버가 하고, [7] 화면은 결과를 보여주기만 한다.**
그래서 "잔액이 이상해요" 같은 문제는 십중팔구 서버(수은 구역), "버튼이 안 예뻐요"는 프론트(팀원 구역)다.

### 0-2. 각 단계가 하는 일 (한 문단씩)

- **[2] 데이터 공장 (`data-pipeline` 레포)**: 2013~2023년 실제 주가·코인·거시지표를 수집하고, GPT로 게임용 뉴스 13,497건을 만들어 놓은 곳. 파이썬이라 팀원이 열어볼 일은 없다. 결과물(뉴스 `.jsonl` 등)은 팀 Drive에도 있다.
- **[4] 적재 스크립트 (`seeds/`)**: 재료 파일을 읽어서 DB에 넣는 일회성 프로그램. 개발할 때는 진짜 데이터 대신 **연습 데이터를 만들어 넣는 `npm run seed:stub`** 을 쓴다 (가짜 종목 20개, 가짜 뉴스 등).
- **[5] DB (창고)**: 표(테이블) 28개짜리 창고. 크게 4묶음 — ① 게임 재료(종목·시세·뉴스·종토방·지표: 읽기만 함) ② 내 게임 기록(세션·보유·거래·상환·이벤트) ③ 회원(계정·로그인) ④ 부업·급등주 기록.
- **[6] 서버 (게임 마스터)**: "매수 요청이 왔네? 현금이 모자라니 거절" / "다음 날로 넘어가네? 월급 주고, 이벤트 굴리고, 스트레스 계산" — 이런 **규칙 판정을 전부** 한다. 화면이 서버에 말을 거는 통로가 **API**(주소로 데이터를 주고받는 창구)다.
- **[7] 프론트 (화면)**: 서버가 준 JSON(데이터 꾸러미)을 예쁘게 그리고, 버튼이 눌리면 서버에 전달한다. **디자인 게임**(`public/game/`, 픽셀아트 정적 페이지)은 이 화면의 "디자인 원본"이고, 본편 SPA에 입히는 작업이 우리가 할 이식(§4 레시피 5)이다.

### 0-3. [직접 해보기 ①] 뉴스 한 건을 창고→서버→화면으로 추적

연습 데이터(`seed:stub`) 기준. 서버(터미널②)와 DB가 켜져 있어야 한다.

**1단계 — 창고(DB)에서 원본 보기.** 터미널에 붙여넣기:

```bash
docker exec antsurvival_db psql -U admin -d antsurvival -c \
  "SELECT news_id, game_publish_date, news_lines FROM news WHERE game_publish_date='2013-01-02' LIMIT 3;"
```
→ 표 형태로 뉴스 3건이 보인다. `news_lines`가 기사 문장이다.

**2단계 — 서버(API)가 그걸 어떻게 주는지 보기.** 브라우저 주소창에:

```
http://localhost:3001/api/news/2013-01-02
```
→ 방금 DB에서 본 뉴스가 JSON으로 나온다. `"headline"`, `"lines"` 항목을 찾아보자.
이 변환을 하는 코드가 `server/src/services/newsService.js`다 (스트레스에 따라 몇 건만 보여주는 것도 여기).

**3단계 — 화면에서 확인.** 게임(http://localhost:5173)에서 게임을 시작하고 뉴스(📰)를 열면, 같은 데이터가 예쁘게 그려져 있다. 그리는 코드는 `frontend/src/components/NewsModal.jsx`.

이 세 단계가 이 게임의 모든 기능의 공통 패턴이다: **DB의 행(row) → 서버의 JSON → 화면의 그림.**

### 0-4. [직접 해보기 ②] 매수 버튼을 누르면 무슨 일이 생기나 (F12 구경)

1. 게임 화면에서 `F12` → **Network(네트워크) 탭**을 연다. (이 탭은 "화면↔서버가 주고받는 편지함"이다)
2. 마켓에서 아무 종목 → 매수 → 수량 1 → 확정.
3. Network 탭에 **`trade`** 라는 줄이 생긴다. 클릭해 보면:
   - **Payload(요청)**: 화면이 서버에 보낸 것 — `{"assetId":"...","tradeType":"buy","quantity":1}`
   - **Response(응답)**: 서버가 판정한 결과 — 체결가, 남은 현금.
4. 이 여행의 경로를 코드로 따라가면:

```
[화면] TradeModal.jsx의 확정 버튼
  → [통로] frontend/src/api/client.js 의 trade()      ← 화면이 쓰는 전화번호부
  → [서버 문] server/src/routes/game.js               ← 주소(/trade)를 보고 담당자 연결
  → [검사] server/src/controllers/gameController.js   ← 입력값이 말이 되는지 확인
  → [판정] server/src/services/tradeService.js        ← 진짜 규칙: 현금 확인, 평균단가, 체결
  → [창고] DB의 trades / holdings 테이블에 기록
  → 결과 JSON이 역순으로 돌아와 화면 갱신
```

서버 쪽 파일은 전부 이 **routes(문) → controllers(검사) → services(판정)** 3단 구조다. 어떤 기능이든 이 순서로 따라가면 코드를 찾을 수 있다.

### 0-5. "다음 날 ▶"을 누르면 서버가 하는 일 (순서대로)

`server/src/services/turnService.js` 하나에 이 순서가 그대로 코드로 있다:

1. 어제 상환 날이었는데 안 갚았으면 **자동 미납 처리** (신뢰도 하락)
2. 월초(21, 41...턴)면 **월급 지급 + 생활비 차감**
3. 어제 산 **급등주가 있으면 결과 정산** (자동 매도)
4. 내 자산이 어제보다 얼마나 늘었나 계산 → **손실이면 스트레스 상승**
5. **이벤트 주사위 굴리기** — 기절(스트레스 100이면 무조건) > 독촉전화(신뢰도 낮을수록) > 급등주 등장(스트레스 높을수록) > 경조사/명절/스터디/여행(랜덤)
6. 결과를 전부 DB에 저장(=자동 세이브) + **승패 판정** (빚 0원 = 승리 / 신뢰도 0 또는 240턴 초과 = 패배)

그래서 이벤트 확률이나 월급을 바꾸고 싶으면 이 파일이 아니라 **수치 창고인 `constants.js`** 만 바꾸면 된다 (레시피 4).

### 0-6. 창고(DB) 구경하는 법

```bash
# 창고 안 표 목록 (28개)
docker exec antsurvival_db psql -U admin -d antsurvival -c "\dt"

# 지금 진행 중인 게임 상태 (현금/빚/스트레스/신뢰도)
docker exec antsurvival_db psql -U admin -d antsurvival -c \
  "SELECT current_turn, cash, debt, stress, trust, status FROM game_sessions ORDER BY created_at DESC LIMIT 3;"

# 내가 한 거래 기록
docker exec antsurvival_db psql -U admin -d antsurvival -c \
  "SELECT turn_number, asset_id, trade_type, quantity, price FROM trades ORDER BY id DESC LIMIT 5;"
```

> 이 명령들은 **읽기만** 하므로 아무리 실행해도 안전하다. `UPDATE`/`DELETE`가 들어간 SQL은 치지 말 것.

### 0-7. 용어 사전 (이 프로젝트에서 쓰는 말)

| 용어 | 뜻 |
|---|---|
| **API** | 화면과 서버가 데이터를 주고받는 창구. 주소(예: `/api/news/날짜`)로 부른다 |
| **JSON** | 데이터를 글자로 포장한 형식. `{"cash": 50000000}` 같은 모양 |
| **DB / 테이블** | 창고 / 창고 안의 표 하나 (엑셀 시트 하나라고 생각하면 됨) |
| **마이그레이션** | 창고에 표를 만드는 설계도 SQL (`server/migrations/`). 건드리지 않기 |
| **시드(seed)** | 창고에 데이터를 채워 넣는 것. `npm run seed:stub` = 연습 데이터 |
| **스텁(stub)** | 진짜 대신 쓰는 가짜 연습 데이터 |
| **mock 모드** | 서버 없이 화면만 개발할 때 쓰는 가짜 서버 (`VITE_USE_MOCK=true`) |
| **컴포넌트** | 화면 조각 하나 (`.jsx` 파일 하나) |
| **세션** | 게임 1판. 새 게임 시작 = 새 세션 생성 |
| **커밋 / 푸시 / 풀** | 저장 지점 만들기 / GitHub에 올리기 / 팀원 것 내려받기 (§6) |

### 0-8. 전체 레포 지도 (누가 어디서 일하나)

```
data-pipeline (별도 레포, 파이썬)  ← 수은: 원천 데이터 → 게임 재료 파일
IISE-CD-StockGame (이 레포)
├── server/     ← 수은: 게임 규칙·API·DB  (팀원은 constants.js 수치, eventEngine.js 문구만)
└── frontend/   ← 팀원 메인 구역: 화면 전부
    ├── src/            본편 SPA (여기에 디자인을 입힌다)
    └── public/game/    디자인 게임 원본 (픽셀아트, 자유롭게 수정)
```

---

## 1. 딱 한 번만 하는 설치 (약 30분)

이미 설치돼 있으면 건너뛴다. 확인 방법도 같이 적었다.

### 1-1. 설치할 프로그램 4개

| 프로그램 | 용도 | 다운로드 |
|---|---|---|
| **Visual Studio Code** | 코드 편집기 (메모장의 코딩 버전) | https://code.visualstudio.com |
| **Node.js (LTS 버전)** | 게임 서버/화면을 돌리는 엔진 | https://nodejs.org — "LTS"라고 적힌 쪽 |
| **Docker Desktop** | 데이터베이스(DB)를 돌리는 프로그램 | https://www.docker.com/products/docker-desktop |
| **Git** | 코드 버전 관리 (팀원과 코드 합치기) | Mac: 이미 있음 / Windows: https://git-scm.com |

설치 후 **터미널을 열고** (여는 법은 §2-1) 아래를 한 줄씩 붙여넣어 숫자/버전이 나오면 성공:

```bash
node -v        # v20.x.x 처럼 나오면 OK
git --version  # git version 2.x 처럼 나오면 OK
docker -v      # Docker version 2x.x 처럼 나오면 OK (Docker Desktop을 먼저 실행해둘 것)
```

### 1-2. GitHub 로그인 (코드 올리기용)

1. VS Code 실행 → 왼쪽 맨 아래 **사람 모양 아이콘** 클릭 → **"Sign in with GitHub"** → 브라우저가 열리면 GitHub 계정으로 로그인.
2. 이렇게 해두면 나중에 코드를 올릴 때(푸시) 비밀번호를 물어보지 않는다.

### 1-3. 프로젝트 받기

터미널에 한 줄씩:

```bash
cd ~/Desktop                # 바탕화면으로 이동 (원하는 폴더로 바꿔도 됨)
git clone https://github.com/hwangsueun/IISE-CD-StockGame.git
```

그다음 VS Code에서: **File → Open Folder → 바탕화면의 `IISE-CD-StockGame` 폴더 선택**.
앞으로 모든 작업은 이 폴더 안에서 한다.

### 1-4. 처음 한 번만 하는 준비

VS Code에서 터미널을 열고(§2-1) 아래를 **위에서부터 순서대로** 붙여넣는다.
`#` 뒤는 설명이니 같이 복사해도 된다.

```bash
# 1) 데이터베이스 켜기 (Docker Desktop이 실행 중이어야 함)
docker compose up -d db

# 2) 서버 부품 설치 + 설정 파일 만들기 (몇 분 걸림)
cd server
npm install
cp .env.example .env

# 3) 연습용 게임 데이터 넣기
npm run seed:stub

# 4) 화면(프론트) 부품 설치
cd ../frontend
npm install
```

빨간 에러 없이 끝났으면 설치 완료. 이제 §2의 "매일 루틴"만 반복하면 된다.

---

## 2. 매일 하는 루틴

### 2-1. 터미널 여는 법

- VS Code에서 **`Ctrl + \`` (백틱, 키보드 Esc 아래 키)** 또는 메뉴 **Terminal → New Terminal**.
- 터미널을 **3개** 쓴다. 터미널 오른쪽 위 **`+` 버튼**으로 추가한다.

### 2-2. 작업 시작 (터미널 3개에 각각 붙여넣기)

**터미널 ① — 최신 코드 받기 + DB 켜기** (딱 한 번 실행하고 놔둠):

```bash
git pull --rebase origin main
docker compose up -d db
```

**터미널 ② — 게임 서버 켜기** (켜두면 계속 돌아감):

```bash
cd server
npm run dev
```
→ `[antsurvival] API listening on :3001` 이 나오면 성공. **이 터미널은 끄지 말 것.**

**터미널 ③ — 게임 화면 켜기** (켜두면 계속 돌아감):

```bash
cd frontend
npm run dev
```
→ 브라우저에서 **http://localhost:5173** 을 열면 게임이 보인다.
→ 디자인 게임(픽셀아트 원본)은 **http://localhost:5173/design.html**.

> 💡 **코드를 고치고 저장(Ctrl+S)하면 브라우저 화면이 자동으로 바뀐다.** 새로고침도 필요 없다.
> 단, `server/` 안의 파일을 고치면 서버가 자동 재시작되는데 2~3초 걸린다.

### 2-3. 작업 끝 (내 작업 올리기)

**방법 A — VS Code 버튼으로 (추천)**

1. 왼쪽 세로 아이콘 중 **나뭇가지 모양(Source Control)** 클릭.
2. 바뀐 파일 목록이 보인다. 파일명을 클릭하면 **뭘 바꿨는지 좌우 비교**로 보여준다. 여기서 내가 의도한 변경만 있는지 확인.
3. 위 입력창에 **한 줄 설명**을 쓴다. 예: `메인 화면 배경 이미지 적용`
4. **✓ Commit** 버튼 클릭 → 이어서 **Sync Changes**(또는 ⋯ → Push) 클릭.
5. 팀 채팅에 한 줄: "메인 화면 배경 올렸어요. MainPage.jsx / global.css 건드림."

**방법 B — 터미널로**

```bash
git add -A
git commit -m "메인 화면 배경 이미지 적용"
git pull --rebase origin main    # 팀원이 먼저 올린 게 있으면 합치기
git push origin main
```

> ⚠️ **푸시가 거절되면(rejected)** 팀원이 먼저 올린 것 → `git pull --rebase origin main` 를 실행하고 다시 push. 충돌이 나면 §6-3.

### 2-4. 완전히 새로 시작하고 싶을 때 (게임 데이터 리셋)

게임 데이터가 꼬였거나 처음부터 다시 하고 싶으면:

```bash
docker compose down -v      # DB 통째로 삭제
docker compose up -d db     # 새 DB 생성 (테이블 자동 생성)
cd server && npm run seed:stub   # 연습 데이터 다시 넣기
```

브라우저에서도 **F12 → Console 탭 → `localStorage.clear()` 입력 후 Enter → 새로고침** 하면 저장된 세션이 지워지고 오프닝부터 시작한다.

---

## 3. "이거 고치고 싶은데 어느 파일이지?" 표

전부 `frontend/src/` 아래에 있다. VS Code에서 **`Cmd+P`(Mac) / `Ctrl+P`(Win)** 를 누르고 파일명을 치면 바로 열린다.

| 고치고 싶은 것 | 파일 | 찾는 방법 |
|---|---|---|
| 오프닝 스토리 문장 | `pages/OpeningPage.jsx` | 파일 위쪽 `STORY = [...]` 배열의 따옴표 안 글자 |
| 시작 화면(난이도 선택) | `pages/IntroPage.jsx` | `쉬움/보통/어려움` 글자로 검색 |
| 로그인/회원가입 칸 | `components/AuthPanel.jsx` | |
| 메인 화면 전체 배치 | `pages/MainPage.jsx` | 날짜/메뉴 버튼/다음 날 버튼 전부 여기 |
| 상단 상태바(현금/스트레스 게이지) | `components/StatusBar.jsx` | |
| 뉴스 목록/뉴스 팝업 | `components/NewsPanel.jsx`, `NewsModal.jsx` | |
| 마켓(종목 목록) | `components/MarketModal.jsx` | |
| 종목 상세(차트/정보/종토방) | `components/AssetDetailModal.jsx` | |
| 매수/매도 창 | `components/TradeModal.jsx` | |
| 포트폴리오 창 | `components/PortfolioModal.jsx` | |
| 캘린더/메모 | `components/CalendarModal.jsx` | |
| 상환(빚 갚기) 창 | `components/RepaymentModal.jsx` | |
| 이벤트 팝업(독촉전화/경조사 등) | `components/EventPopup.jsx` | 이벤트 **문구 자체**는 서버 쪽 §4-6 참고 |
| 부업 선택 창 | `components/SideJobModal.jsx` | |
| 미니게임 3종 | `components/minigames/CatchWaxon.jsx`, `AvoidProfessor.jsx`, `PassengerTetris.jsx` | |
| 급등주 팝업 | `components/SurgeStockPopup.jsx` | |
| 엔딩 화면 | `pages/ResultPage.jsx` | |
| **모든 색/글꼴/여백** | `styles/global.css` | §4-2 방법으로 클래스 이름 찾기 |
| **게임 수치(월급/이벤트 확률 등)** | `server/src/config/constants.js` | §4-4 |
| 디자인 게임 원본(정적 페이지) | `frontend/public/game/*.html` | 픽셀아트 화면들. 자유롭게 수정 가능 |
| 이미지 에셋 | `frontend/public/game/assets/` | §4-3 |

---

## 4. 자주 하는 작업 레시피 (따라하기)

### 레시피 1 — 화면의 글자 바꾸기

예: 메인 화면의 "다음 날 ▶" 버튼을 "하루 넘기기 ▶"로.

1. `Ctrl+P` → `MainPage.jsx` 열기.
2. `Ctrl+F`로 `다음 날` 검색.
3. 따옴표/중괄호 밖의 한글만 바꾼다: `{loading ? '진행 중...' : '하루 넘기기 ▶'}`
4. 저장(Ctrl+S) → 브라우저가 자동으로 바뀜.

> 규칙: **한글 문구는 마음껏 바꿔도 된다.** 단 `{ }` `< >` 같은 기호와 영어 단어(변수명)는 건드리지 말 것.

### 레시피 2 — 색/크기 바꾸기 (CSS)

예: "다음 날" 버튼 색을 초록 → 노랑으로.

1. 브라우저에서 그 버튼에 **마우스 우클릭 → 검사(Inspect)**.
2. 개발자 도구에 `<button class="btn-next-turn">` 처럼 **class 이름**이 보인다.
3. `Ctrl+P` → `global.css` 열기 → `Ctrl+F`로 `btn-next-turn` 검색.
4. `background: #4caf7d;` 의 색 코드를 `#e8a33d` 로 바꾸고 저장.

> 색 코드는 구글에 "color picker" 검색하면 고를 수 있다.

### 레시피 3 — 이미지 넣기

디자인 에셋은 이미 `frontend/public/game/assets/` 에 들어 있다 (팀원이 올린 픽셀아트).
코드에서 이렇게 쓴다 — **주소가 `/game/assets/` 로 시작하는 것이 중요**:

```jsx
<img src="/game/assets/bg_room.png" alt="방 배경" />
```

배경으로 깔고 싶으면 `global.css`에서:

```css
.main-page {
  background-image: url('/game/assets/bg_room.png');
  background-size: cover;        /* 화면에 꽉 차게 */
  image-rendering: pixelated;    /* 픽셀아트가 안 뭉개지게 */
}
```

새 이미지 파일을 추가하고 싶으면 그냥 `frontend/public/game/assets/` 폴더에 파일을 복사해 넣으면 된다.

### 레시피 4 — 게임 수치 바꾸기 (월급, 이벤트 확률, 부업 보상...)

1. `Ctrl+P` → `constants.js` (server/src/config/) 열기.
2. 모든 수치에 한글 주석이 달려 있다. 예:
   ```js
   MONTHLY_SALARY: 3_000_000,   // 월급 300만 원 (3_000_000 = 3000000, _는 읽기 편하라고 넣은 것)
   ```
3. 숫자만 바꾸고 저장. **서버 터미널(②)이 자동 재시작될 때까지 2~3초 기다린 뒤** 브라우저에서 확인.

> ⚠️ 이 파일 말고 다른 서버 파일에 숫자를 직접 쓰지 말 것 (팀 규칙).

### 레시피 5 — 디자인 페이지를 본편에 이식하기 (실전 예제)

> 목표: `public/game/Main Screen.html` 의 디자인을 본편 메인 화면에 입히기.
> 원리: 디자인 HTML에서 **모양(HTML 구조와 CSS)** 을 가져오고, **동작(버튼 클릭 등)** 은 기존 코드 것을 유지한다.

1. **디자인 원본 열어보기**: 브라우저에서 `http://localhost:5173/game/Main%20Screen.html` 열고 → 우클릭 → 검사로 구조 확인. VS Code에서도 `Main Screen.html` 파일을 연다.
2. **픽셀 폰트 가져오기 (처음 한 번만)**: 디자인 HTML `<head>`에 있는 폰트 `<link ...>` 줄들(fonts.googleapis / galmuri.css)을 복사해서 **`frontend/index.html`의 `<head>` 안**에 붙여넣는다. 이걸 해야 SPA에서도 픽셀 글꼴이 나온다.
3. **CSS 옮기기**: 디자인 HTML의 `<style>...</style>` 안 내용을 복사해서 `frontend/src/styles/global.css` **맨 아래**에 붙여넣는다. 단 3가지는 조심:
   - `:root { --gold: ... }` 색 변수 블록 → 그대로 붙여도 안전.
   - `html, body { ... }`, `* { ... }` 처럼 **화면 전체에 걸리는 규칙** → 그대로 붙이면 다른 화면(모달 등)까지 다 바뀐다. `body`를 `.main-page`처럼 **그 화면의 클래스 이름으로 바꿔서** 붙일 것.
   - 이미 같은 이름의 클래스가 global.css에 있으면(예: `.status-bar`) 아래쪽(나중에 붙인 것)이 이긴다 — 의도한 게 맞는지 화면으로 확인.
4. **HTML 구조 옮기기**: 디자인의 `<div class="...">` 구조를 `MainPage.jsx`의 해당 위치에 맞춰 바꾼다. 이때 JSX 규칙 딱 2개만 주의:
   - `class=` → **`className=`** 으로 바꿔야 한다.
   - `<img ...>` 처럼 닫는 태그가 없는 것은 **`<img ... />`** 로 끝에 `/`를 붙인다.
5. **동작 유지**: 기존 코드의 `onClick={...}` 부분은 절대 지우지 말고 새 구조의 버튼에 그대로 옮겨 단다.
   ```jsx
   {/* 예: 디자인의 이미지 버튼에 기존 동작 달기 */}
   <button className="pixel-btn" onClick={() => openModal('market')}>
     <img src="/game/assets/btn_market.png" alt="마켓" />
   </button>
   ```
6. 저장하고 브라우저 확인 → 이상하면 `Ctrl+Z`로 되돌리면 된다.
7. 한 화면이 끝나면 §2-3으로 커밋+푸시. **화면 하나당 커밋 하나**가 깔끔하다.

어떤 디자인 파일이 어떤 본편 파일과 짝인지는 [DEVELOPMENT_GUIDE.md §3 Phase D 매핑표](DEVELOPMENT_GUIDE.md)에 전부 있다.

### 레시피 6 — 이벤트 문구/선택지 바꾸기

독촉전화, 여행, 경조사 같은 이벤트의 대사는 서버 파일에 있다:

1. `Ctrl+P` → `eventEngine.js` (server/src/services/) 열기.
2. `prompt:` 로 검색하면 이벤트별 대사가 나온다. 예:
   ```js
   prompt: '친구가 주말 여행을 제안했다.',
   choices: [
     { key: 'go', label: '간다 (-100만원, 스트레스 -15)', ... },
   ```
3. `prompt`와 `label`의 **따옴표 안 한글만** 바꾼다. `key: 'go'` 의 영어는 건드리지 말 것.
4. 저장 → 서버 자동 재시작 → 다음 이벤트 발생 때 반영.

---

## 5. React 최소 지식 5가지 (이것만 알면 됨)

1. **`.jsx` 파일 하나 = 화면 조각 하나(컴포넌트)**. `MainPage.jsx`는 메인 화면, `StatusBar.jsx`는 상태바.
2. **JSX는 HTML과 거의 같다.** 다른 점: `class=` 대신 `className=`, 태그는 꼭 닫는다(`<img />`).
3. **`{ }` 중괄호 안은 자바스크립트다.** `{won(state.cash)}` = "현금 숫자를 원화로 표시해라". 중괄호 안은 웬만하면 건드리지 말 것.
4. **모양은 `global.css`, 내용/구조는 `.jsx`.** 색·크기·위치를 바꾸고 싶으면 십중팔구 CSS다.
5. **저장하면 브라우저가 즉시 반영한다.** 반영이 안 되면 → 터미널 ③에 빨간 에러가 떠 있는지 확인(§7).

---

## 6. Git 왕초보 (코드 합치기)

### 6-1. 개념 한 문단

Git은 "코드의 구글닥스"다. **커밋** = 저장 지점 만들기, **푸시** = 내 저장을 GitHub에 올리기, **풀** = 팀원이 올린 걸 내려받기. 순서만 기억하면 된다: **작업 전에 풀, 작업 후에 커밋→풀→푸시.**

### 6-2. 절대 규칙 4개

1. **작업 시작 전에 항상** `git pull --rebase origin main`.
2. **커밋 전에 Source Control에서 바뀐 파일 목록을 확인**한다 — 내가 안 건드린 파일이 있으면 팀 채팅에 물어볼 것.
3. `server/` 폴더는 백엔드 담당 것 — 고치기 전에 물어보기. **단 `constants.js` 숫자와 `eventEngine.js` 문구는 자유.**
4. 뭘 삭제하는 명령(`git reset --hard`, `rm`, `docker compose down -v`)은 **의미를 알 때만**.

### 6-3. 충돌(Conflict)이 났을 때

풀을 받았는데 이런 게 파일에 생기면 충돌이다:

```
<<<<<<< HEAD
내가 고친 내용
=======
팀원이 고친 내용
>>>>>>> origin/main
```

**VS Code가 버튼을 띄워준다:**
- **Accept Current Change** = 내 것 유지
- **Accept Incoming Change** = 팀원 것 유지
- **Accept Both** = 둘 다 유지

같은 파일을 서로 다르게 고친 것이니, **어느 쪽이 맞는지 모르면 팀 채팅에 물어보고 선택**한다.
선택이 끝나면(파일에서 `<<<<` `====` `>>>>` 가 전부 사라졌으면):

```bash
git add -A
git rebase --continue     # 그리고 push
```

### 6-4. 망했을 때 되돌리기

| 상황 | 해결 |
|---|---|
| 방금 고친 파일 하나를 원래대로 | Source Control에서 파일 우클릭 → **Discard Changes** |
| 아직 커밋 안 한 변경 전부 버리기 | `git checkout -- .` |
| 내 로컬을 통째로 GitHub 상태로 되돌리기 (⚠️ 내 미푸시 작업 전부 삭제) | `git fetch origin && git reset --hard origin/main` |
| 뭔지 모르겠고 무섭다 | 아무것도 하지 말고 터미널 화면 캡처해서 팀 채팅 |

---

## 7. 에러가 나면

### 7-1. 에러 읽는 법 (30초)

- **브라우저 화면이 하얗거나 이상함** → `F12` → **Console 탭** → 빨간 글씨 확인. 보통 `파일명:줄번호`가 적혀 있다 — 그 파일 그 줄 근처에서 방금 고친 걸 의심.
- **터미널 ②(서버)나 ③(화면)에 빨간 글씨** → 첫 줄과 `at 파일명:줄번호` 부분만 읽으면 된다.
- 방금 고친 게 원인일 확률 99% → **Ctrl+Z로 되돌리고 저장**해서 화면이 살아나는지 먼저 확인.

### 7-2. 흔한 에러 사전

| 에러 메시지에 이런 말이 있으면 | 뜻 | 해결 |
|---|---|---|
| `Unexpected token` / `Unterminated string` | 따옴표/괄호를 잘못 닫음 | 방금 고친 곳에서 `' " ( ) { }` 짝 확인 |
| `xxx is not defined` | 이름 오타 | 변수/함수 이름 철자 확인 (대소문자 구분!) |
| `Cannot read properties of undefined` | 데이터가 아직 없는데 씀 | 방금 고친 부분 Ctrl+Z |
| `EADDRINUSE ... 3001` | 서버가 이미 켜져 있음 | `npx kill-port 3001` 실행 후 다시 `npm run dev` (Mac은 `lsof -ti:3001 \| xargs kill`도 가능) |
| `db: down` / `ECONNREFUSED ... 5432` | DB가 꺼져 있음 | Docker Desktop 실행 확인 → `docker compose up -d db` |
| `거래일 데이터 부족` | 게임 데이터가 없음 | `cd server && npm run seed:stub` |
| `Merge conflict` | 코드 충돌 | §6-3 |
| 화면에 `[mock] ...은(는) mock 미구현` | mock 모드로 켜져 있는데 서버가 필요한 기능을 씀 | `frontend/.env`의 `VITE_USE_MOCK`를 지우거나 `false`로 + 서버(터미널②) 켜기 |

### 7-3. 최후의 리셋 (전부 처음 상태로)

```bash
# ⚠️ 내가 푸시 안 한 코드 변경도 사라진다. 코드가 아깝으면 §6-4 먼저.
git fetch origin && git reset --hard origin/main
docker compose down -v && docker compose up -d db
cd server && npm install && npm run seed:stub
cd ../frontend && npm install
```

### 7-4. 질문할 때 이 3개를 캡처해서 올리기

1. **에러가 보이는 터미널 전체** (② 또는 ③)
2. **브라우저 F12 Console 탭**
3. **방금 고친 파일 이름 + 뭘 하려고 했는지 한 줄**

---

## 8. 하지 말 것 목록

- ❌ `server/migrations/` 안의 기존 SQL 파일 수정 (새 번호 파일로만 추가 — 백엔드 담당에게 요청)
- ❌ `package.json`, `package-lock.json`, `vite.config.js`, `docker-compose.yml` 수정 (합의 필요)
- ❌ `.env` 파일을 커밋 (자동으로 무시되지만, 강제로 add 하지 말 것 — 비밀번호가 들어감)
- ❌ `node_modules/` 폴더 건드리기 (몇만 개 파일이 든 부품 창고다. 지워졌으면 `npm install`로 복구)
- ❌ 커밋 메시지 없이 커밋 / 확인 없이 `git push --force` (force는 절대 금지)
- ❌ 한 커밋에 여러 화면 왕창 (화면 하나 = 커밋 하나)

---

## 9. 치트시트 (이 표만 인쇄해도 됨)

```bash
# ── 매일 시작 ──────────────────────────────
git pull --rebase origin main     # 최신 코드 받기
docker compose up -d db           # DB 켜기
cd server && npm run dev          # 터미널② 서버
cd frontend && npm run dev        # 터미널③ 화면 → http://localhost:5173

# ── 매일 끝 ────────────────────────────────
git add -A
git commit -m "무엇을 했는지 한 줄"
git pull --rebase origin main
git push origin main

# ── 자주 쓰는 것 ───────────────────────────
npm run seed:stub                 # (server에서) 연습 데이터 다시 넣기
docker compose down -v            # DB 초기화 (다음에 up 하면 새로 생성)
npx kill-port 3001                # "서버 이미 켜짐" 에러 해결
git checkout -- .                 # 커밋 안 한 변경 전부 취소
```

| 화면 주소 | 내용 |
|---|---|
| http://localhost:5173 | 본편 게임 (서버 연동) |
| http://localhost:5173/design.html | 디자인 게임 (픽셀아트 원본) |
| http://localhost:3001/health | 서버 살아있는지 확인 (`{"status":"ok"}` 면 정상) |
