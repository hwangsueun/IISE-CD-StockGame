// 신뢰도 정책 (미팅5 §2·§3)
// 신뢰도 = 채권자 입장에서 보는 상환 신뢰 수준. 월말 상환 결과로만 변한다.
const C = require('../config/constants');
const { clamp100 } = require('../utils/clamp');

/** 독촉전화 발생 확률: (50 − 신뢰도×0.45)% , 하한 5% / 상한 50% */
function loanSharkCallProb(trust) {
  const { probBase, probSlope, probMin, probMax } = C.LOAN_SHARK_CALL;
  const p = probBase - trust * probSlope;
  return Math.min(probMax, Math.max(probMin, p)) / 100;
}

/** 신뢰도 구간별 독촉 유형 (일반/압박/위협/최후통첩) */
function loanSharkTier(trust) {
  for (const tier of C.LOAN_SHARK_CALL.tiers) {
    if (trust >= tier.minTrust) return tier;
  }
  return C.LOAN_SHARK_CALL.tiers[C.LOAN_SHARK_CALL.tiers.length - 1];
}

/**
 * 상환 비율(paid/due)에 따른 [신뢰도, 스트레스] 변화 (미팅5 표)
 * 초과 +2/−5, 전액 0/0, 50~99% −5/+10, 1~49% −15/+20, 미납 −25/+35
 */
function repaymentEffect(ratio) {
  for (const band of C.REPAYMENT_EFFECTS) {
    if (ratio >= band.minRatio) {
      return { trustDelta: band.trustDelta, stressDelta: band.stressDelta, label: band.label };
    }
  }
  const last = C.REPAYMENT_EFFECTS[C.REPAYMENT_EFFECTS.length - 1];
  return { trustDelta: last.trustDelta, stressDelta: last.stressDelta, label: last.label };
}

module.exports = { clamp100, loanSharkCallProb, loanSharkTier, repaymentEffect };
