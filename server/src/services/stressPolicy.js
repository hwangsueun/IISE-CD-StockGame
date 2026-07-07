// 스트레스 정책 (미팅4 §2 Stress 로직 / 기능명세서 §메인-상태요약)
// - 뉴스 내용은 바꾸지 않는다. 열람 가능한 뉴스 수만 줄인다.
// - 신뢰도를 직접 깎지 않는다 (판단 악화 -> 상환 실패 -> 신뢰도 하락의 간접 경로).
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

/** 스트레스 구간 정보 { limit, band } */
function bandFor(stress) {
  for (const b of C.NEWS_LIMIT_BY_STRESS) {
    if (stress <= b.maxStress) return b;
  }
  return C.NEWS_LIMIT_BY_STRESS[C.NEWS_LIMIT_BY_STRESS.length - 1];
}

/** 구간별 하루 뉴스 열람 한도 (10/8/6/4/2/0) */
function newsLimitFor(stress) {
  return bandFor(stress).limit;
}

/** 기절 조건 (스트레스 100 도달 즉시) */
function shouldFaint(stress) {
  return stress >= C.STRESS_FAINT_THRESHOLD;
}

/** 기절 시 스킵 일수 (3~5 거래일, 미팅5) */
function rollFaintSkipDays() {
  const { min, max } = C.FAINT_SKIP_DAYS;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 일일 투자 손익률 -> 스트레스 변화 (미팅4: 손실 −5~−15%: +5 / −15% 초과: +12)
 * @param {number} dailyReturn 전일 대비 총자산 수익률 (0.01 = +1%)
 */
function dailyReturnStressDelta(dailyReturn) {
  for (const band of C.DAILY_RETURN_STRESS) {
    if (dailyReturn <= band.maxReturn) return band.delta;
  }
  return 0;
}

/** 생활비 수준에 따른 월초 스트레스 변화 (기획서 §7) */
function livingCostStressDelta(livingCost) {
  if (livingCost < C.LIVING_COST_MIN) return C.LIVING_COST_STRESS.poor;
  if (livingCost > C.LIVING_COST_MAX) return C.LIVING_COST_STRESS.lavish;
  return C.LIVING_COST_STRESS.normal;
}

module.exports = {
  clamp100,
  bandFor,
  newsLimitFor,
  shouldFaint,
  rollFaintSkipDays,
  dailyReturnStressDelta,
  livingCostStressDelta,
};
