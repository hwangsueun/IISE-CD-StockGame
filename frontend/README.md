# ANT SURVIVAL — Frontend

Vite 기반. 두 갈래로 구성된다.

1. **디자인 게임 (정적 멀티페이지)** — `public/game/`. 디자인팀이 만든 픽셀아트 화면들이 그대로
   돌아가는 실제 플레이 가능한 게임. 상태는 `localStorage`(`stockgame_demo_state_v1`),
   화면 전환은 파일명 기반. **현재 기본 진입점.**
2. **API 연동용 React SPA** — `app.html` + `src/`. `ARCHITECTURE.md` 섹션 4·8 구조를 따르는
   백엔드 연동 버전(추후 디자인 게임을 이쪽으로 흡수). 지금은 `/app.html`로 따로 접근.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  → 게임 인트로로 자동 이동
npm run build    # dist/ (index 런처 · app SPA · game/ 정적 화면)
```

- `/` (index.html) = 런처. `game/Intro - Debt Setup.html`로 리다이렉트.
- `/app.html` = React SPA(아래 "백엔드 연결" 참고).

## 디자인 게임 흐름 (`public/game/`)

연결되어 플레이 가능한 화면(이미지 보유):

```
Intro - Debt Setup.html         난이도/빚 설정
   └─▶ Main Screen.html         메인 루프(시세·매매·뉴스·턴)
          ├─▶ Loanshark Call.html    독촉 전화 (bg_room + phone)
          └─▶ Loanshark Visit.html   월말 상환 → 분기
                 ├─▶ Final Result.html       해피 엔딩
                 └─▶ Bad End - Bankruptcy.html  파산 엔딩
```

### 제외된 화면 (배경 이미지 누락)

아래 4개는 배경 PNG가 제공되지 않아 **포함하지 않았다**. 이미지 확보 시
`public/game/assets/`에 넣고 해당 HTML을 다시 추가하면 된다.

| 화면 | 필요한 배경 |
|---|---|
| Faint Event | `bg_hospital_ceiling.png` |
| Holiday Event | `bg_family.png` |
| Travel Event | `bg_travel.png` |
| Wedding Event | `bg_wedding.png` |

> 참고: 위 이벤트들은 현재 Main Screen 루프에 트리거가 연결돼 있지 않다(독립 목업).
> 이미지 확보 후 Main Screen JS의 턴/조건에 네비게이션을 붙이는 작업이 필요하다.

## 백엔드 연결 (React SPA)

- 기본값은 **dev mock**(`VITE_USE_MOCK=true`)으로, 백엔드 없이 React SPA 루프가 동작한다.
- 실제 백엔드(Express, :3001)와 붙일 때는 `.env`에 `VITE_USE_MOCK=false` 설정.
  Vite가 `/api`를 `localhost:3001`로 프록시한다.

```bash
cp .env.example .env   # 필요시 값 수정
```

## 구조

```
frontend/
├── index.html              # 게임 런처(→ public/game 인트로)
├── app.html                # React SPA 진입점
├── vite.config.js          # 두 진입점 + /api 프록시
├── public/
│   └── game/               # 디자인 게임 (정적 멀티페이지)
│       ├── *.html          # 연결된 6개 화면
│       └── assets/         # bg_room, btn_*, phone (8개 PNG)
└── src/                    # React SPA (ARCHITECTURE 섹션 4 정합)
    ├── main.jsx · App.jsx
    ├── api/                # client.js(섹션 8 래퍼) · mockApi.js
    ├── state/gameStore.jsx
    ├── pages/              # IntroPage · MainPage · ResultPage
    ├── components/         # StatusBar + 모달 8종
    ├── utils/format.js
    └── styles/global.css
```

## 원칙 (섹션 3)

- 게임 권위 계산(체결/평가/상태/턴/상환/이벤트)은 **서버 책임**. 프론트는 표시·입력 전달.
- React SPA의 컴포넌트는 `useGame()`으로 상태/액션을 받고 직접 fetch하지 않는다.
- 정적 디자인 게임은 현재 `localStorage` 기반 자체 동작이며, 추후 API 연동 시 React SPA로 통합한다.
