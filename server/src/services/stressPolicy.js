// 스트레스 정책: 뉴스 열람 제한, 기절 판정 (ARCHITECTURE.md §9-4 / 기획서 §8)
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

/** 스트레스 구간별 하루 뉴스 열람 한도 */
function newsLimitFor(stress) {
  for (const band of C.NEWS_LIMIT_BY_STRESS) {
    if (stress <= band.maxStress) return band.limit;
  }
  return 0;
}

/** 기절 조건 (스트레스 100) */
function shouldFaint(stress) {
  return stress >= C.STRESS_FAINT_THRESHOLD;
}

/** 기절 시 스킵 일수 (3~7 거래일 랜덤) */
function rollFaintSkipDays() {
  const { min, max } = C.FAINT_SKIP_DAYS;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 턴 종료 시 자연 스트레스 변동.
 * TODO(gamelogic): 밸런싱 — 보유자산 손실률/부채 압박에 따른 스트레스 증감 곡선 확정.
 * 현재 규칙(임시): 총자산이 부채보다 작으면 +2, 아니면 -1 (자연 회복).
 */
function dailyStressDelta({ totalAsset, debt }) {
  return totalAsset < debt ? 2 : -1;
}

/** 생활비 수준에 따른 월초 스트레스 변화 (기획서 §7) */
function livingCostStressDelta(livingCost) {
  if (livingCost < C.LIVING_COST_MIN) return C.LIVING_COST_STRESS.poor;
  if (livingCost > C.LIVING_COST_MAX) return C.LIVING_COST_STRESS.lavish;
  return C.LIVING_COST_STRESS.normal;
}

module.exports = {
  clamp100,
  newsLimitFor,
  shouldFaint,
  rollFaintSkipDays,
  dailyStressDelta,
  livingCostStressDelta,
};
