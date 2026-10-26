const { ApiError } = require('../utils/errors');
let active = 0;
const waiting = [];
const limit = () => Math.max(1, Math.min(2, Math.floor(Number(process.env.USER_STRATEGY_MAX_WORKERS) || 1)));
const isModelWorkBusy = () => active >= limit();
function acquire(wait) {
  if (!isModelWorkBusy()) { active++; return Promise.resolve(); }
  if (!wait || waiting.length >= 4) return Promise.reject(new ApiError(429, '다른 모델을 계산하고 있습니다. 완료 후 다시 시도해 주세요.'));
  return new Promise(resolve => waiting.push(resolve));
}
async function withModelWork(fn, { wait = false } = {}) {
  await acquire(wait);
  try { return await fn(); }
  finally {
    active--;
    if (waiting.length) { active++; waiting.shift()(); }
  }
}
module.exports = { withModelWork, isModelWorkBusy };
