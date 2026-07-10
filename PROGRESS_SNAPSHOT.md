# ANT SURVIVAL 진행 현황 스냅샷 (2026-07-10 기준)

> 팀원 공유용 요약 문서. 설계 기준은 [ARCHITECTURE.md](ARCHITECTURE.md), 실행/로드맵 상세는
> [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)가 원본이다. 이 문서는 "지금 뭐가 끝났고 뭐가 남았는지"를
> 한 번에 훑어보기 위한 스냅샷이며, 시간이 지나면 갱신이 필요하다.

---

## 1. 한눈에 보기

| 영역 | 상태 | 비고 |
|---|---|---|
| DB 스키마 (28테이블) | ✅ 완료 | `001_init.sql` + `002_members_minigames.sql` |
| 게임 코어 (세션/240턴/거래/평가/자동저장) | ✅ 완료 | |
| 상태 시스템 (스트레스/신뢰도/월급·생활비/상환) | ✅ 완료 | 밸런싱 수치만 조정 대상 |
| 이벤트 A~E (독촉전화/급등주/스터디/경조사/명절/기절) | ✅ 완료 | 스터디 힌트 실데이터화만 TODO |
| 부업 미니게임 3종 (백엔드 판정) | ✅ 완료 | 점수 컷 밸런싱만 TODO |
| 회원관리 (가입/로그인/이어하기, 게스트 허용) | ✅ 완료 | |
| 실데이터 적재기 6종 | ⚙️ 구현 완료, **실행 전** | 매핑 미확정 4~5건 (§3) |
| 프론트 기능 전체 (오프닝~결과, 모달 13종) | ✅ 기능 완료 | |
| **디자인(픽셀아트) 이식 — Phase D** | 🔶 진행 중 (아래 §2-3 표) | 메인화면/모달스킨/캘린더/인트로/이벤트3종/미니게임2종 완료, 나머지 남음 |
| LLM 리포트 (주간/최종) | ⬜ 미착수 | 연동 지점만 준비됨 |
| 밸런싱·플레이테스트 | ⬜ 미착수 | |

---

## 2. 지금까지 완료된 것

### 2-1. 백엔드/게임 코어 (초기 스캐폴드 ~ 기획 반영)

- **DB 28테이블 + Express API + React SPA 풀스택 스캐폴드** 구축 (`d9e79f5`)
- **기획명세서 전체 구조 반영**: 부업 미니게임, 회원관리, 급등주 등 누락 구조 구현 (`2c3b489`)
- 팀원 디자인 게임(픽셀아트 정적 페이지 12종 + 에셋) + SPA 스캐폴드 병합 (`f09aeeb`)
- **A6 명절 실제 달력** — 설/추석 22건(2013~2023) 반영, 연휴 직후 첫 거래일 1회 발동
- **B5 상환 턴 자동 미납 처리** — 기절 등으로 상환 턴을 그냥 지나쳐도 자동 미납(ratio 0) 기록
- 240턴 도착 즉시 실패 판정 버그 수정, 명절 이벤트 우선순위 상향

이 부분은 기능적으로 전부 완료·검증된 상태다 (세션/240턴/거래/평가/이벤트 A~E/부업 3종/회원관리).

### 2-2. Phase D — 디자인 이식 (2026-07-08 ~ 07-10)

`public/game/`의 픽셀아트 디자인 원본을 본편 React SPA로 옮기는 작업.

| 날짜 | 커밋 | 내용 |
|---|---|---|
| 07-08 | `393c633` | 메인 화면 이식 — `Main Screen.html` → `MainPage.jsx` + `StatusBar` |
| 07-08 | `dbd24a6` | 모달 전체 픽셀 스킨 이식 — 마켓/뉴스/캘린더/포트폴리오 외 9종 공용 클래스 교체 |
| 07-08 | `a5ad8f9` | 캘린더 월 그리드 이식 — `cal-overlay` → `CalendarModal` |
| 07-10 | `1840b04` | **인트로 + 이벤트 3종(독촉전화/월말상환/기절) + 미니게임 2종 이식** — `IntroPage`, `EventPopup`(전화 전용 연출 분리), `RepaymentModal`(사채업자 방문 컷신), `FaintOverlay`(기절 컷신), `useTypewriter` 공용 훅, `CatchWaxon`/`AvoidProfessor` 미니게임 연동 |

**이식 순서표 기준 완료 항목**: Main Screen → Intro → 이벤트 3종(Call/Visit/Faint) → 미니게임 2종 — **여기까지 전부 완료**.

### 2-3. 오늘(2026-07-10) 추가 수정 사항

Phase D 이식과 별개로, 실제 플레이하면서 발견된 UI/로직 이슈를 수정했다.

| 커밋 | 내용 |
|---|---|
| `9dff172` | **마켓 모달 사이드바 리뉴얼** — 주식/채권/코인/참고지표 사이드 탭 + 정렬(거래대금/거래량/상승률/하락률) + 상단 지수 스트립(KOSPI/KOSDAQ/환율) + 참고지표 카드뷰로 재작성. 도형 아이콘 제거. **뉴스/종목상세 모달 크기 고정** — 탭 전환 시 창 크기가 흔들리지 않도록 목록 컨테이너 높이 고정 |
| `1fd0462` | **월말 상환 자동 팝업** — 상환 턴(20일 주기) 도달 시 버튼 없이 자동으로 상환 컷신이 뜨도록 변경. 입원 중이면 띄우지 않고 다음 턴에 서버가 자동 미납 처리. **급등주 매수 방식 변경** — 금액 직접입력 → 수량 입력(수량×현재가 환산)으로 변경. **독촉전화 로직 원복** — "독촉전화"(loan_shark_call, 신뢰도 기반 랜덤)와 "월말 상환"(20일 주기 고정)을 착각해 잘못 결합했던 걸 원복. **참고지표 데이터 보강** — 로컬 개발용 스텁 시드가 거시지표 4종만 생성하던 걸 게임 노출 대상 10종 전체로 확장 |

---

## 3. 남은 작업

우선순위 순서: **Phase A(데이터) → Phase B(로직 확정) → Phase D 잔여(디자인) → Phase C(LLM) → Phase E(밸런싱) → Phase F(안정화)**.
전체 로드맵 상세는 [DEVELOPMENT_GUIDE.md §3](DEVELOPMENT_GUIDE.md#3-앞으로의-진행-로드맵) 참고.

### Phase A — 실데이터 완결 (최우선, 아직 미착수)

지금 로컬/서버는 전부 **스텁(합성) 데이터**로 동작 중이다. 아래가 끝나야 실데이터 시연이 가능하다.

- [ ] 마스킹 사전 확정 (별칭→정식명→가명, 117종목) — `maskingService.js`
- [ ] 갤러리→종목 매핑표 (디시 101갤러리 → stock_code) — `import_community.js`
- [ ] npq 수급 시트 매핑 (외국인/기관/개인 순매수) — `import_stocks.js`
- [ ] 반기 재무/밸류에이션 적재기 신규 작성
- [ ] FICS 섹터 컬럼 채우기 (마켓 모달 업종 필터용)
- [ ] 코인 시총 티어 라벨
- [ ] (파이프라인 측) 거시뉴스 전기간 재생성 완료 시 JSONL 교체

> ⚠️ 마스킹 사전 없이 실데이터를 적재하면 뉴스 본문에 실명이 남는다 — 외부 시연 절대 금지.

### Phase B — 게임로직 마감 (미확정 수치/규칙)

- [ ] 재무 공시 시점 규칙 (미래 정보 차단) — `pricingService.getAssetDetail`
- [ ] 투자 스터디 힌트 실데이터 기반화 — `eventEngine.buildDirectionHint/buildOmenHint`
- [ ] 급등주 결과 가중치 확정 (기대값이 음수가 되도록 팀 합의 필요) — `constants.js SURGE_STOCK.OUTCOMES`
- [ ] 부업 점수 컷 조정 (플레이테스트 필요) — `constants.js SIDE_JOB.SCORE_CUTS`
- [ ] 수익 시 스트레스 하락 수치 확정 (현재 임시값) — `constants.js DAILY_RETURN_STRESS`

### Phase D — 디자인 이식 잔여분

| 디자인 원본 | 이식 대상 | 상태 |
|---|---|---|
| `Holiday Event.html` | `EventPopup`(holiday) | ⬜ 미이식 — 현재 제네릭 모달로만 표시 |
| `Travel Event.html` | `EventPopup`(travel) | ⬜ 미이식 — 현재 제네릭 모달로만 표시 |
| `Wedding Event.html` | `EventPopup`(condolence:wedding) | ⬜ 미이식 — 현재 제네릭 모달로만 표시 |
| `Final Result.html` | `ResultPage.jsx`(success) | ⬜ 미이식 — 현재 기능만 있는 plain 화면 |
| `Bad End - Bankruptcy.html` | `ResultPage.jsx`(failed) | ⬜ 미이식 — 위와 동일 |
| (디자인 없음) | `SurgeStockPopup`, `AuthPanel`, `OpeningPage` | ⬜ 디자인 시안 자체가 없음 — 신규 제작 필요 |
| (디자인 없음) | `minigames/PassengerTetris.jsx` | ⬜ 테트리스 디자인 페이지 자체가 없음 — 신규 제작 필요 |

추가 연출 작업:
- [ ] 오프닝 컷신/일러스트 — `OpeningPage`
- [ ] 캔들차트/거래량 바 — `PriceChart`
- [ ] 엔딩 월별 자산 추이 차트 + AI 투자성향 분석 표시 — `ResultPage`
- [ ] 사운드/BGM (선택)

### Phase C — LLM 리포트 (완전 미착수)

- [ ] 주간 리포트 입력 요약 함수 작성 (LLM 없이도 먼저 화면에 노출 가능)
- [ ] `server/src/services/llmService.js` 신설, 서버 전용 호출, 실패 시 규칙 기반 문장 폴백
- [ ] 비용 통제(캐시) + 프롬프트 설계
- [ ] `reportService.getWeeklyReport`/`getFinalReport` 연동

### Phase E — 밸런싱·플레이테스트 (미착수)

- [ ] 자동 시뮬레이션 스크립트 (`server/scripts/simulate.js` 신설 권장) — 240턴 1,000회 랜덤매매 봇으로 클리어율 측정
- [ ] `constants.js` 노브 조정 (월급/생활비/상환요구율/이벤트확률/급등주기대값/부업기본급)
- [ ] 사람 테스트 (난이도별 3회씩)
- [ ] 목표 클리어율 합의: easy 60~70% / normal 35~45% / hard 15~25% (초안)

### Phase F — 안정화·마감

Phase A~E 완료 후 진행. 상세는 DEVELOPMENT_GUIDE.md §3 참고.

---

## 4. 참고

- 설계/스키마/API 기준: [ARCHITECTURE.md](ARCHITECTURE.md)
- 서버 실행법 + 전체 로드맵 상세: [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)
- 코딩 입문 팀원용 가이드: [TEAM_HANDBOOK.md](TEAM_HANDBOOK.md)
- 남은 TODO 전체는 `grep -rn "TODO(" server frontend`로 언제든 직접 확인 가능 (`TODO(data)` / `TODO(gamelogic)` / `TODO(frontend)`)
