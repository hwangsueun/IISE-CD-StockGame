# ANT SURVIVAL — Frontend

Vite 기반. **두 갈래**로 구성된다 (2026-07-07 병합 이후 기준).

1. **본편: React SPA (서버 연동)** — `index.html` + `src/`. `/` 진입.
   ARCHITECTURE.md 섹션 4·8 구조를 따르며 백엔드(:3001)와 실통신한다.
   오프닝/회원/거래/이벤트/부업 미니게임/급등주/리포트 전 화면 구현 완료.
2. **디자인 게임 (정적 멀티페이지)** — `public/game/`. `/design.html` 진입(→ 인트로로 이동).
   디자인팀이 만든 픽셀아트 화면 원본. 상태는 `localStorage`, 화면 전환은 파일명 기반.
   **본편 SPA에 이 디자인을 이식하는 것이 Phase D 작업이다** (DEVELOPMENT_GUIDE.md §3 참조).

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  → 본편 SPA (/api는 :3001로 프록시)
                 # http://localhost:5173/design.html → 디자인 게임
npm run build    # dist/ (index SPA · design 런처 · game/ 정적 화면)
```

## 백엔드 없이 개발 (mock 모드)

`.env`(또는 `.env.local`)에:

```bash
VITE_USE_MOCK=true
```

`src/api/client.js`가 `mockApi.js`(디자인팀 작업분)로 위임한다.
mock은 §8-1~8-4(게임 흐름/자산/뉴스/종토방/메모)만 커버하며,
신규 기능(회원/부업/급등주/실현손익/게임 로그)은 명시적 에러를 던진다 → 해당 기능 개발은 백엔드를 켜고 할 것.

## 폴더

- `src/api/client.js` — 전 엔드포인트 래퍼 + mock 스위치
- `src/state/gameStore.js` — zustand 전역 상태 (서버 응답 미러)
- `src/pages/` `src/components/` `src/components/minigames/` — 화면
- `src/utils/chartIndicators.js` — MA/볼린저/RSI 계산
- `public/game/` — 디자인 게임 원본 (에셋 `public/game/assets/`)
