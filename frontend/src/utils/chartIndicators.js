// 기술적 지표 계산 (미팅5 §1: 이동평균 5/10/60/120, 볼린저밴드, RSI, 거래량)
// 입력: prices = number[] (오래된 것 -> 최신 순)

/** 단순 이동평균. 윈도우 미달 구간은 null */
export function movingAverage(prices, window) {
  const out = new Array(prices.length).fill(null);
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= window) sum -= prices[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** 볼린저 밴드 (기본 20일, 2σ). {mid, upper, lower} 각 배열 */
export function bollingerBands(prices, window = 20, k = 2) {
  const mid = movingAverage(prices, window);
  const upper = new Array(prices.length).fill(null);
  const lower = new Array(prices.length).fill(null);
  for (let i = window - 1; i < prices.length; i++) {
    const slice = prices.slice(i - window + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / window;
    const sd = Math.sqrt(variance);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { mid, upper, lower };
}

/** RSI (기본 14일, Wilder 평활). 0~100 배열 */
export function rsi(prices, window = 14) {
  const out = new Array(prices.length).fill(null);
  if (prices.length <= window) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= window; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / window;
  let avgLoss = loss / window;
  out[window] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = window + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (window - 1) + Math.max(0, diff)) / window;
    avgLoss = (avgLoss * (window - 1) + Math.max(0, -diff)) / window;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}
