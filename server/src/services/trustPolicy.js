// 신뢰도 정책: 독촉전화 확률, 상환 결과 반영 (ARCHITECTURE.md §9-4)
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

/** 신뢰도가 낮을수록 사채업자 독촉전화 확률 증가 */
function loanSharkCallProb(trust) {
  const { baseProb, trustSlope } = C.LOAN_SHARK_CALL;
  return Math.min(1, baseProb + (100 - trust) * trustSlope);
}

/** 상환 비율(paid/due)에 따른 신뢰도/스트레스 변화 */
function repaymentEffect(ratio) {
  for (const band of C.REPAYMENT_EFFECTS) {
    if (ratio >= band.minRatio) {
      return { trustDelta: band.trustDelta, stressDelta: band.stressDelta };
    }
  }
  const last = C.REPAYMENT_EFFECTS[C.REPAYMENT_EFFECTS.length - 1];
  return { trustDelta: last.trustDelta, stressDelta: last.stressDelta };
}

module.exports = { clamp100, loanSharkCallProb, repaymentEffect };
