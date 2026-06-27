# 동학개미 서바이벌 (ANT SURVIVAL) — UI 화면 명세

> 기존 디자인 작업물(`디자인/*.html`, Claude Design 제작)을 기준으로 정리한 화면 구성 문서. 프론트(React19+Vite) 구현과 백엔드 API 연결의 기준이 된다. 스코프는 중간보고서(131자산·240턴·이벤트), 기술스택은 `TECH_STACK_revised.md`.

---

## 0. 화면 목록 (디자인 작업 완료분)

| 화면 | 파일 | 역할 |
|---|---|---|
| 인트로/빚 설정 | `Intro - Debt Setup.html` | 난이도(부채 5천만/1억/1.5억) 선택, 초기 상태 설정 |
| **메인화면** | `Main Screen.html` | 게임 핵심 화면 (상태바·스테이지·메뉴·모든 모달 포함) |
| 사채업자 전화 | `Loanshark Call.html` | 신뢰도 기반 독촉전화 이벤트 |
| 사채업자 방문(상환) | `Loanshark Visit.html` | 상환일(20턴) 상환 입력 + 결과 |
| 기절 이벤트 | `Faint Event.html` | 스트레스 100 → 기절·입원(병원비·행동제한) |
| 명절 이벤트 | `Holiday Event.html` | 공휴일·가족 모임 이벤트 |
| 여행 이벤트 | `Travel Event.html` | 랜덤 여행(스트레스↓·현금↓) |
| 경조사(결혼식) | `Wedding Event.html` | 경조사 참석/불참 이벤트 |
| 20턴 정산 | `Final Result.html` | 월간 리포트(20턴마다) |
| 파산 엔딩 | `Bad End - Bankruptcy.html` | 실패 엔딩(부채 미상환/신뢰도 0) |

> 디자인에 **주식·채권·코인**이 모두 등장 → 풀스코프(131자산) 기준과 일치.

---

## 1. 메인화면 구성 (`Main Screen.html`)

### 1-1. 상단 상태바 (TOP STATUS BAR)
- **신뢰도** 게이지 · **스트레스** 게이지 · **총 재산** · **부채 진행바(Debt progress)** · **턴 표시(Turn pill)**
- → API: `GET /api/game/:sessionId` (cash·totalAsset·debt·stress·trust·turn)

### 1-2. 스테이지 (STAGE)
- HUD 날짜 플레이트(현재 게임 날짜/턴), 모니터 연출, 오늘의 헤드라인 패널, **오늘의 목표 패널**
- **NEXT TURN(다음 날 ▶)** CTA → `POST /api/game/:sessionId/next-turn`

### 1-3. 메뉴 버튼 → 모달
| 버튼 | 모달/뷰 | 연결 API |
|---|---|---|
| 마켓 | MARKET MODAL | `GET /api/assets` |
| 뉴스 | NEWS MODAL / DETAIL | `GET /api/news/:date(/:assetId)` |
| 포트폴리오 | PORTFOLIO MODAL | `GET /api/game/:sessionId/portfolio` |
| 캘린더 | CALENDAR MODAL | 메모: `/api/game/:sessionId/memo`, 노출뉴스 조회 |
| (턴 종료) | TURN RESULT MODAL / TURN TOAST | next-turn 결과 |

---

## 2. 마켓 모달 (MARKET MODAL)

- **상단 인덱스 스트립**(top index strip) — 대표 지수
- **사이드바**(업종별 메뉴 ☰) + **메인 영역**, 3개 뷰 전환:
  1. **랭킹 뷰** — 거래량 / 거래대금 / 상승률 Top
  2. **업종별 뷰**(sectors) — 섹터별 종목 리스트
  3. **참고지표 뷰**(reference indicators) — 기준금리·USD/KRW·CPI·국채금리·WTI·금·경기선행지수
- 자산군 필터: **전체 / 주식(▲) / 채권(■) / 코인(●)**
- → API: `GET /api/assets?type=&sort=volume|value|gainers`, `GET /api/macro/:date`

---

## 3. 종목 상세 모달 (ASSET DETAIL MODAL)

상단 **트레이드 바**(현재가·매수/매도 버튼) + 4개 탭:

| 탭 | 내용 | API |
|---|---|---|
| **차트** | 가격 차트 + 기간(1일/1주/1개월/3개월/6개월/1년) + 기술지표(이평·볼린저·RSI, 채권 제외) | `GET /api/assets/:id/prices?from=&to=` |
| **뉴스** | 종목 관련 뉴스 | `GET /api/news/:date/:assetId` |
| **종목토론방** | 디시인사이드 기반 게시글·댓글(읽기 전용) | `GET /api/community/:assetId` |
| **정보** | 주식: 재무제표·재무비율·가치평가 / 채권: 종류·등급·만기 / 코인: 심볼·시총 | `GET /api/assets/:id` |

> 탭 구성이 자산 타입별로 달라짐(채권은 기술지표 없음, 주식만 재무 탭 풍부) → **타입별 상세 테이블 분리 설계와 일치.**

### 매수/매도 (BUY / SELL MODAL)
- 수량 입력(정수) + 비율 버튼(10/25/50/전체) + 예상금액/잔여 표시 → 매수/매도 확정
- → `POST /api/game/:sessionId/trade`, 결과 TRADE RESULT TOAST

---

## 4. 포트폴리오 모달 (PORTFOLIO MODAL)

- 탭: **종합(◆) / 주식(▲) / 채권(■) / 코인(●) / 수익분석($)**
- 종합: 자산 비중(파이) + 평가금액·수익률·평가손익
- 수익분석: 기간별(일/주/월/년/전체) 실현손익
- → `GET /api/game/:sessionId/portfolio`, `GET /api/game/:sessionId/report/...`

---

## 5. 뉴스 / 캘린더

- **뉴스 모달**: 필터(전체/거시/주식/채권/코인/중요), 정렬(최신/오래된순), 상세(태그·#해시태그), 스트레스 기반 열람 제한
- **뉴스 상세 → 관련 종목 보기**(AFFECTED ASSET PICKER)로 종목 상세 연결
- **캘린더 모달**: 과거 날짜 뉴스 조회 + 개인 메모(작성/수정/삭제, 당일만 편집, 100자)
- → `GET /api/news/:date`, `/api/game/:sessionId/memo`, `news_exposure`

---

## 6. 이벤트 / 엔딩 화면

| 화면 | 트리거 | 상태 영향 | 데이터 |
|---|---|---|---|
| 사채업자 전화 | 신뢰도 낮을 때(확률=50−신뢰도×0.45) | 스트레스↑ | `event_log` |
| 사채업자 방문(상환) | 20턴 상환일 | 상환비율→신뢰도/스트레스 | `repayments` |
| 기절·입원 | 스트레스 100 | 3거래일 제한·병원비·스트레스 리셋 | `event_log` |
| 명절/여행/결혼식 | 랜덤·공휴일 | 현금/스트레스 | `event_log` |
| 20턴 정산 | 매 20턴 | 월간 리포트 | `report/monthly` |
| 파산 엔딩 | 부채 미상환·신뢰도 0 | 게임오버 | `status='failed'` |

→ 이벤트 엔진(`POST /api/game/:sessionId/event`) + `event_log` 테이블.

---

## 7. UI ↔ 데이터/스키마 정합 메모

- 메인 상태바 5종(현금·총자산·부채·스트레스·신뢰도) = `game_sessions` 컬럼과 1:1.
- 마켓/포트폴리오/뉴스 필터가 **주식·채권·코인 3분류** → `assets.asset_type` 기준.
- 종목 상세 "정보" 탭이 타입마다 다른 화면 → `stock_financials`/`bond_info`/`coin_info` 타입별 테이블 필요(앞선 데이터 분석 결론과 동일).
- 차트 기간/기술지표 → `asset_prices`(+ 타입별 상세 가격) 시계열.

---

## 8. 비고

본 문서는 **기존 디자인 작업물(`디자인/` 10개 HTML)**을 코드/데이터 관점에서 정리한 것이다. 실제 픽셀 시안은 해당 HTML 파일을 참조하고, 본 문서는 화면↔API↔스키마 연결의 기준으로 사용한다.
