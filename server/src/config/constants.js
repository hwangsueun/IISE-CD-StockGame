// =====================================================================
// 게임 밸런싱 상수 (ARCHITECTURE.md §1, §9 / 기획서 260331 기준)
// 밸런싱 수치 변경은 이 파일에서만 한다.
// =====================================================================

module.exports = {
  // --- 게임 기간 ---
  TOTAL_TURNS: 240,             // 1턴 = 거래일 하루, 20턴 = 1개월
  TURNS_PER_MONTH: 20,
  TURNS_PER_WEEK: 5,            // 주간 평가 주기 (기획서 §7 Weekly 평가서)

  // --- 초기 자금 / 부채 난이도 ---
  INITIAL_CASH: 50_000_000,
  DEBT_BY_DIFFICULTY: {
    easy: 50_000_000,
    normal: 100_000_000,
    hard: 150_000_000,
  },
  // 월말 상환 요구액 = debt_initial / 12 (균등). repaymentService에서 사용.
  REPAYMENT_MONTHS: 12,

  // --- 월급 / 생활비 (기획서 §7 Monthly turn) ---
  MONTHLY_SALARY: 3_000_000,
  LIVING_COST_MIN: 300_000,     // 최소기준 미만: 굶주린 식사 -> 스트레스 상승
  LIVING_COST_MAX: 1_500_000,   // 최대기준 초과: 호화로운 식사 -> 스트레스 하락
  LIVING_COST_DEFAULT: 800_000,
  LIVING_COST_STRESS: { poor: +8, lavish: -5, normal: 0 },

  // --- 수수료 (0으로 시작, 추후 밸런싱) ---
  TRADE_FEE_RATE: 0,

  // --- 스트레스 (0-100) ---
  STRESS_INIT: 0,
  // 스트레스 구간별 하루 뉴스 열람 한도 (기획서 §8: >80 눈침침 -> 열람 불가)
  NEWS_LIMIT_BY_STRESS: [
    { maxStress: 40, limit: 10 },
    { maxStress: 60, limit: 7 },
    { maxStress: 80, limit: 4 },
    { maxStress: 100, limit: 0 },
  ],
  STRESS_FAINT_THRESHOLD: 100,  // 기절: 3~7거래일 행동제한 + 스트레스 리셋
  FAINT_SKIP_DAYS: { min: 3, max: 7 },
  FAINT_RESET_STRESS: 40,
  HOSPITAL_STRESS_THRESHOLD: 80, // 80 초과 구간: 병원행/급등주 소식 등 랜덤 이벤트 후보
  HOSPITAL_COST: 2_000_000,
  HOSPITAL_STRESS_RELIEF: -30,

  // --- 신뢰도 (0-100) ---
  TRUST_INIT: 100,
  TRUST_FAIL_THRESHOLD: 0,      // 신뢰도 0 = 즉시 실패
  // 상환 비율별 신뢰도/스트레스 변화 (repaymentService)
  REPAYMENT_EFFECTS: [
    { minRatio: 1.5, trustDelta: +10, stressDelta: -10 }, // 많이 갚음: 격려/칭찬
    { minRatio: 1.0, trustDelta: +5, stressDelta: 0 },    // 정확히 갚음
    { minRatio: 0.5, trustDelta: -10, stressDelta: +10 }, // 적게 갚음: 독촉
    { minRatio: 0.0, trustDelta: -20, stressDelta: +20 }, // 거의 못 갚음
  ],
  // 독촉전화 발생 확률 = BASE + (100 - trust) * SLOPE (stressPolicy/eventEngine)
  LOAN_SHARK_CALL: { baseProb: 0.02, trustSlope: 0.004, stressDelta: +10 },

  // --- 이벤트 공통 ---
  EVENT_MAX_PER_TURN: 1,
  RANDOM_EVENT_PROB: 0.05,      // 여행/결혼식/부업 등 선택형 랜덤 이벤트 발생 확률

  // --- 뉴스 ---
  NEWS_MAX_PER_DAY: 10,

  // --- 데이터 기간 ---
  DATA_RANGE: { from: '2013-01-02', to: '2023-12-31' },
};
