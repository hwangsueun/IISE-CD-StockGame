/** 스트레스/신뢰도 공용: 0-100 범위 고정 */
const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

module.exports = { clamp100 };
