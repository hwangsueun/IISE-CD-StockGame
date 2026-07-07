// =====================================================================
// 게임 밸런싱 상수
// 근거 문서: ARCHITECTURE.md §1·§9, 기획서 260331/260414(미팅4)/260504(미팅5),
//           중간보고서(2026-06), 기능명세서 시트
// 밸런싱 수치 변경은 이 파일에서만 한다.
// =====================================================================

module.exports = {
  // --- 게임 기간 ---
  TOTAL_TURNS: 240,             // 1턴 = 거래일 하루, 20턴 = 1개월
  TURNS_PER_MONTH: 20,
  TURNS_PER_WEEK: 5,            // 주간 평가 주기

  // --- 초기 자금 / 부채 난이도 ---
  INITIAL_CASH: 50_000_000,
  DEBT_BY_DIFFICULTY: {
    easy: 50_000_000,
    normal: 100_000_000,
    hard: 150_000_000,
  },
  REPAYMENT_MONTHS: 12,         // 월 상환 요구액 = debt_initial / 12

  // --- 월급 / 생활비 (기획서 §7 Monthly turn) ---
  MONTHLY_SALARY: 3_000_000,
  LIVING_COST_MIN: 300_000,     // 미만: 굶주린 식사 -> 스트레스 상승
  LIVING_COST_MAX: 1_500_000,   // 초과: 호화로운 식사 -> 스트레스 하락
  LIVING_COST_DEFAULT: 800_000,
  LIVING_COST_STRESS: { poor: +8, lavish: -5, normal: 0 },

  // --- 수수료 (0으로 시작, 추후 밸런싱) ---
  TRADE_FEE_RATE: 0,

  // =====================================================================
  // 스트레스 (0-100) — 미팅4 §2 Stress 로직 구체화
  // =====================================================================
  STRESS_INIT: 0,
  // 구간별 하루 뉴스 열람 한도 (일일 10개 기준, 구간 1단계마다 2개 차감)
  // 안정 0–29:10 / 긴장 30–49:8 / 불안 50–69:6 / 고위험 70–89:4 / 붕괴직전 90–99:2 / 기절 100:0
  NEWS_LIMIT_BY_STRESS: [
    { maxStress: 29, limit: 10, band: 'stable' },
    { maxStress: 49, limit: 8, band: 'tense' },
    { maxStress: 69, limit: 6, band: 'anxious' },
    { maxStress: 89, limit: 4, band: 'high_risk' },
    { maxStress: 99, limit: 2, band: 'critical' },
    { maxStress: 100, limit: 0, band: 'faint' },
  ],
  // 투자 손익 -> 스트레스 (미팅4: 손실 −5~−15%: +5 / −15% 초과: +12)
  DAILY_RETURN_STRESS: [
    { maxReturn: -0.15, delta: +12 },   // 하루 −15% 초과 손실
    { maxReturn: -0.05, delta: +5 },    // 하루 −5 ~ −15% 손실
    { maxReturn: 0.05, delta: 0 },
    { maxReturn: Infinity, delta: -2 }, // 수익 시 하락 (기능명세서 '수익 스트레스 하락 반영', 수치 TODO 밸런싱)
  ],
  // 기절·입원 (미팅5 §E 강제 페널티형): 100 도달 즉시, 3~5일 투자·부업 불가
  STRESS_FAINT_THRESHOLD: 100,
  FAINT_SKIP_DAYS: { min: 3, max: 5 },
  FAINT_RESET_STRESS: 0,        // 스트레스 0 리셋 (신뢰도 유지)
  HOSPITAL_COST: 2_000_000,     // 정액 차감. 현금 부족분은 부채 증가 (미팅5)

  // =====================================================================
  // 신뢰도 (0-100) — 미팅5 §2 신뢰도 로직 (월말 상환 결과, 다음날 아침 반영)
  // =====================================================================
  TRUST_INIT: 100,
  TRUST_FAIL_THRESHOLD: 0,
  // 상환 비율별 [스트레스, 신뢰도] 변화
  REPAYMENT_EFFECTS: [
    { minRatio: 1.000001, stressDelta: -5, trustDelta: +2, label: '초과 상환' },
    { minRatio: 1.0, stressDelta: 0, trustDelta: 0, label: '전액 납부' },
    { minRatio: 0.5, stressDelta: +10, trustDelta: -5, label: '50~99% 납부' },
    { minRatio: 0.01, stressDelta: +20, trustDelta: -15, label: '1~49% 납부' },
    { minRatio: 0, stressDelta: +35, trustDelta: -25, label: '미납' },
  ],

  // --- 독촉 전화 (미팅5 §3): 발생확률(%) = 50 − 신뢰도×0.45, 하한 5 / 상한 50 ---
  LOAN_SHARK_CALL: {
    probBase: 50, probSlope: 0.45, probMin: 5, probMax: 50,
    // 신뢰도 구간별 유형 (전화 중 즉시 일부 상환 입력 가능 — 기능명세서 §이벤트/독촉전화)
    tiers: [
      { minTrust: 51, type: 'normal', stressDelta: +8, label: '일반 독촉' },
      { minTrust: 31, type: 'pressure', stressDelta: +15, label: '압박형' },
      { minTrust: 11, type: 'threat', stressDelta: +20, label: '위협형' },
      { minTrust: 0, type: 'ultimatum', stressDelta: +25, label: '최후통첩형' },
    ],
  },

  // =====================================================================
  // 부업 미니게임 (미팅5 §6, 기능명세서 §부업)
  // 하루 1회 / 입원(행동제한) 중 불가 / 부업한 날은 투자 불가
  // =====================================================================
  SIDE_JOB: {
    BASE_PAY: 300_000,          // 기본급. 등급 배율 적용
    // 등급: 대성공/성공/보통/실패/대실패 (현금 배율, 스트레스)
    GRADES: {
      great_success: { payRate: 1.8, stressDelta: +3 },
      success: { payRate: 1.5, stressDelta: +5 },
      normal: { payRate: 1.0, stressDelta: +10 },
      fail: { payRate: 0.6, stressDelta: +13 },
      great_fail: { payRate: 0.2, stressDelta: +17 },
    },
    // 게임별 원점수 -> 등급 컷 (내림차순 검사). TODO(gamelogic): 플레이테스트로 컷 조정
    SCORE_CUTS: {
      avoid_professor: [ // 생존 시간(초)
        { min: 60, grade: 'great_success' }, { min: 45, grade: 'success' },
        { min: 30, grade: 'normal' }, { min: 15, grade: 'fail' }, { min: 0, grade: 'great_fail' },
      ],
      catch_waxon: [ // 제한시간 내 포획 수
        { min: 20, grade: 'great_success' }, { min: 15, grade: 'success' },
        { min: 10, grade: 'normal' }, { min: 5, grade: 'fail' }, { min: 0, grade: 'great_fail' },
      ],
      passenger_tetris: [ // 점수
        { min: 3000, grade: 'great_success' }, { min: 2000, grade: 'success' },
        { min: 1000, grade: 'normal' }, { min: 400, grade: 'fail' }, { min: 0, grade: 'great_fail' },
      ],
    },
  },

  // =====================================================================
  // 이벤트 (미팅4·5 이벤트 분류 체계 A~E)
  // =====================================================================
  EVENT_MAX_PER_TURN: 1,

  // B. 투자 스터디 (랜덤 기회형): 수락 시 하루 행동 1회 소모, 현금 수익 없음
  INVEST_STUDY: {
    prob: 0.08,                          // 기회 발생 확률. TODO(gamelogic) 밸런싱
    baseStress: { min: -12, max: -6 },   // 기본 보상 (항상)
    hintProb: 0.4,                       // 시장 방향성 힌트
    rareProb: 0.1,                       // 희귀: 스트레스 −15 + 이벤트 전조 힌트
    rareStress: -15,
  },

  // C. 급등주 (상태 연동형): 스트레스 구간별 발생 확률 (미팅5 §4)
  SURGE_STOCK: {
    PROB_BY_BAND: { stable: 0.05, tense: 0.10, anxious: 0.20, high_risk: 0.35, critical: 0.55, faint: 0 },
    // 다음 턴 결과 분포: [수익률 구간, 스트레스 변화, 발생 가중치]
    // TODO(gamelogic): 가중치는 기획 미확정 - 플레이테스트로 조정
    OUTCOMES: [
      { key: 'surge', retMin: 0.30, retMax: 0.80, stressDelta: -20, weight: 8 },
      { key: 'rise', retMin: 0.10, retMax: 0.30, stressDelta: -12, weight: 15 },
      { key: 'small_rise', retMin: 0.0, retMax: 0.10, stressDelta: -5, weight: 17 },
      { key: 'fall', retMin: -0.15, retMax: -0.05, stressDelta: +10, weight: 25 },
      { key: 'plunge', retMin: -0.35, retMax: -0.15, stressDelta: +20, weight: 25 },
      { key: 'crash', retMin: -0.60, retMax: -0.35, stressDelta: +30, weight: 10 },
    ],
    NAMES: ['텐배거바이오', '급등테크', '로켓에너지', '불꽃반도체', '골드러시자원'], // 가상 작전주 이름 풀
  },

  // D. 경조사 (외부 랜덤형): 거부 불가, 비용 확정 차감, 스트레스 방향만 랜덤 (미팅4 §14)
  CONDOLENCE: {
    prob: 0.03,
    TYPES: [
      { key: 'wedding', label: '지인 결혼식', cost: 200_000, downProb: 0.5, stressAbs: 10 },
      { key: 'funeral', label: '지인 장례식', cost: 300_000, downProb: 0.3, stressAbs: 10 },
      { key: 'first_birthday', label: '친구 돌잔치', cost: 100_000, downProb: 0.6, stressAbs: 10 },
      { key: 'reunion', label: '동창 모임', cost: 150_000, downProb: 0.5, stressAbs: 10 },
    ],
  },

  // 명절 (미팅4 §8): 랜덤 결과 — 사촌동생 용돈(현금 지출) / 아늑한 우리집(스트레스 하락)
  HOLIDAY: {
    // 설날/추석 당일 (2013~2023 실제 날짜, 음력 기준 공휴일).
    // 트리거: 명절 당일이 직전 거래일과 이번 거래일 사이에 오면 발동 (연휴 직후 첫 거래일, 명절당 1회)
    DATES: [
      '2013-02-10', '2013-09-19',
      '2014-01-31', '2014-09-08',
      '2015-02-19', '2015-09-27',
      '2016-02-08', '2016-09-15',
      '2017-01-28', '2017-10-04',
      '2018-02-16', '2018-09-24',
      '2019-02-05', '2019-09-13',
      '2020-01-25', '2020-10-01',
      '2021-02-12', '2021-09-21',
      '2022-02-01', '2022-09-10',
      '2023-01-22', '2023-09-29',
    ],
    RESULTS: [
      { key: 'allowance', label: '사촌동생들 용돈', cashDelta: -200_000, stressDelta: 0, weight: 1 },
      { key: 'cozy_home', label: '아늑한 우리집', cashDelta: 0, stressDelta: -10, weight: 1 },
    ],
  },

  // 여행 (선택형, 미팅4 §8: 스트레스 하락 + 현금 지출)
  TRAVEL: { prob: 0.02, cost: 1_000_000, stressDelta: -15, declineStress: +3 },

  // --- 뉴스 ---
  NEWS_MAX_PER_DAY: 10,

  // --- 데이터 기간 ---
  DATA_RANGE: { from: '2013-01-02', to: '2023-12-31' },
};
