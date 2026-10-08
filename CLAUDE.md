# ANT SURVIVAL — Claude 작업 지침

캡스톤 주식 생존 게임. `main` 브랜치에 직접 커밋하는 방식으로 협업한다.

## 문서 지도 (질문 유형별로 여기부터 확인)

| 문서 | 내용 |
|---|---|
| `TEAM_HANDBOOK.md` | 설치·매일 루틴·"이거 고치려면 어느 파일?" — **처음이면 여기부터** |
| `ARCHITECTURE.md` | 설계 정본 (DB 스키마, API, 게임 규칙, 데이터 적재) |
| `DEVELOPMENT_GUIDE.md` | Phase A~F 로드맵 |
| `PROGRESS_SNAPSHOT.md` | 완료/잔여 현황 스냅샷 |

## 실행

```bash
docker compose up -d db          # DB (도커)
cd server   && npm run dev       # API  :3001
cd frontend && npm run dev       # 화면 :5173
```

프론트/서버는 소스를 직접 실행하므로 `git pull` 하면 코드가 바로 반영된다.
(서버를 도커 컨테이너로 돌리는 경우엔 이미지에 소스가 구워져 있어
`docker compose up -d --build api` 로 재빌드해야 한다.)

## ⚠️ `git pull` 직후 반드시 확인할 것 — DB 마이그레이션

**`server/migrations/` 의 SQL은 DB를 처음 만들 때만 자동 실행된다**
(`docker-compose.yml` 이 이 폴더를 `docker-entrypoint-initdb.d` 로 마운트).
따라서 **이미 만들어져 있는 DB에는 새 마이그레이션이 절대 자동 적용되지 않는다.**

`git pull` 로 `server/migrations/` 에 새 번호 파일이 들어왔다면, 사용자에게 알리고
아래를 적용할 것. 적용하지 않으면 해당 기능에서 런타임 에러가 난다.

```bash
docker exec -i antsurvival_db psql -U admin -d antsurvival \
  < server/migrations/<새-마이그레이션-파일>.sql
```

적용 여부가 불확실하면 DB에 직접 물어보고 판단한다. 예를 들어 007(부업 미니게임 3
교체)이 적용됐는지는 이렇게 확인한다:

```bash
docker exec antsurvival_db psql -U admin -d antsurvival -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname='side_job_plays_game_key_check';"
```

→ 결과에 `sort_characters` 가 있으면 적용된 것이고,
  `passenger_tetris` 가 보이면 아직 007을 적용하지 않은 것이다.

데이터를 보존할 이유가 없다면 아래 리셋이 더 간단하다 (새 DB엔 전부 자동 적용된다):

```bash
docker compose down -v && docker compose up -d db
cd server && npm run seed:stub
```

> Windows Git Bash 에서 `docker exec` 에 `/app` 같은 절대경로를 넘길 때는
> 경로가 변환되므로 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` 를 앞에 붙인다.

## 부업 미니게임 3 (상자에 캐릭터 분류하기)

2026-08-28에 기존 "노원03 승객 테트리스"를 대체했다. **마이그레이션 007이 필요하다.**

- 게임 원본: `frontend/public/game/Minigame_Sort_Characters.{html,js}` (에셋 `assets/mini3/`)
- React 래퍼: `frontend/src/components/minigames/SortCharacters.jsx` (iframe 임베드)
- 점수 규약: 게임이 종료 시 부모창으로 `postMessage`
  `{ source:'antsurvival-minigame', game:'sort_characters', rawScore:<점수> }`
  → 서버 `SIDE_JOB.SCORE_CUTS.sort_characters` 로 등급 판정
- **게임 키를 바꾸면 3곳을 함께 고쳐야 한다**: 게임 JS의 `game:` / 래퍼의 비교문 /
  `server/src/config/constants.js` 의 `SCORE_CUTS` 키 (+ DB CHECK 제약 마이그레이션)

확인 경로: http://localhost:5173 → 인트로 진행 → 메인 화면 → **부업** → 📦 상자에 캐릭터 분류하기

`frontend/public/game/Minigame_Sort_Characters.html` 을 **직접 열면 점수가 반영되지 않는다.**
게임이 `window.parent !== window` 일 때만 점수를 전송하기 때문이며, 이는 다른 미니게임 2종도 같다.
현금·스트레스 반영을 확인하려면 반드시 앱 안의 부업 경로로 들어가야 한다.

### 점수 컷은 아직 추정치다

`SIDE_JOB.SCORE_CUTS.sort_characters` (대성공 9000 / 성공 6000 / 보통 3000 / 실패 1200) 는
플레이테스트 없이 계산으로 잡은 값이다. "잘했는데 대실패가 뜬다" 류의 피드백이 오면
`server/src/config/constants.js` 의 숫자만 조정하면 된다.
