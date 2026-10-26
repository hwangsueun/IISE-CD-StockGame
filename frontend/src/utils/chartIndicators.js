// 과거→현재 순으로 계산한다. 화면 확대·축소 전에 전체 이력에 적용한다.
// 입력: prices = number[] (오래된 것 -> 최신 순)
const valid = (value) => typeof value === 'number' && Number.isFinite(value);
const validWindow = (window) => Number.isInteger(window) && window >= 1;

/** 단순 이동평균. 윈도우 미달 구간은 null */
export function movingAverage(prices, window) {
  const out = new Array(prices.length).fill(null);
  if (!validWindow(window)) return out;
  let sum = 0;
  let missing = 0;
  for (let i = 0; i < prices.length; i++) {
    if (valid(prices[i])) sum += prices[i];
    else missing += 1;
    if (i >= window) {
      if (valid(prices[i - window])) sum -= prices[i - window];
      else missing -= 1;
    }
    if (i >= window - 1 && missing === 0) out[i] = sum / window;
  }
  return out;
}

/** 볼린저 밴드 (기본 20일, 2σ). {mid, upper, lower} 각 배열 */
export function bollingerBands(prices, window = 20, k = 2) {
  const mid = movingAverage(prices, window);
  const upper = new Array(prices.length).fill(null);
  const lower = new Array(prices.length).fill(null);
  if (!validWindow(window) || !valid(k) || k <= 0) return { mid, upper, lower };
  for (let i = window - 1; i < prices.length; i++) {
    if (mid[i] === null) continue;
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
  if (!validWindow(window)) return out;
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
  out[window] = rsiValue(avgGain, avgLoss);
  for (let i = window + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (window - 1) + Math.max(0, diff)) / window;
    avgLoss = (avgLoss * (window - 1) + Math.max(0, -diff)) / window;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

function rsiValue(avgGain, avgLoss) {
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** EMA: 첫 연속 window개 값의 평균으로 시작. 이후 가중치 2/(window+1). */
export function exponentialMovingAverage(values, window = 20) {
  const out = new Array(values.length).fill(null);
  if (!validWindow(window)) return out;
  let seed = 0;
  let count = 0;
  let previous = null;
  const alpha = 2 / (window + 1);
  values.forEach((value, index) => {
    if (!valid(value)) {
      seed = 0; count = 0; previous = null;
      return;
    }
    if (previous === null) {
      seed += value;
      count += 1;
      if (count === window) previous = seed / window;
    } else {
      previous += alpha * (value - previous);
    }
    out[index] = previous;
  });
  return out;
}

/** 두 EMA를 각각 첫 가격부터 계산. signal은 유효한 MACD 값의 EMA. */
export function macd(prices, fast = 12, slow = 26, signalPeriod = 9) {
  const empty = () => new Array(prices.length).fill(null);
  if (![fast, slow, signalPeriod].every(validWindow) || fast >= slow) {
    return { line: empty(), signal: empty(), histogram: empty() };
  }
  const fastEma = exponentialMovingAverage(prices, fast);
  const slowEma = exponentialMovingAverage(prices, slow);
  const line = prices.map((_, i) => valid(fastEma[i]) && valid(slowEma[i]) ? fastEma[i] - slowEma[i] : null);
  const signal = exponentialMovingAverage(line, signalPeriod);
  const histogram = line.map((value, i) => valid(value) && valid(signal[i]) ? value - signal[i] : null);
  return { line, signal, histogram };
}

/** N봉 전 종가에 대한 변화율(%). */
export function rateOfChange(prices, window = 10) {
  return prices.map((price, i) => validWindow(window) && i >= window
    && valid(price) && valid(prices[i - window]) && prices[i - window] > 0
    ? (price / prices[i - window] - 1) * 100 : null);
}

/** 종가 / N봉 단순이동평균 × 100. 평균과 같으면 100. */
export function disparity(prices, window = 20) {
  const average = movingAverage(prices, window);
  return prices.map((price, i) => valid(price) && valid(average[i]) && average[i] > 0
    ? price / average[i] * 100 : null);
}

/** 최근 N개 봉별 로그수익률의 표본표준편차(%). 연율화하지 않는다. */
export function rollingVolatility(prices, window = 20) {
  const out = new Array(prices.length).fill(null);
  if (!validWindow(window) || window < 2) return out;
  const returns = prices.map((price, i) => i > 0 && valid(price) && price > 0
    && valid(prices[i - 1]) && prices[i - 1] > 0 ? Math.log(price / prices[i - 1]) : null);
  for (let i = window; i < prices.length; i++) {
    const sample = returns.slice(i - window + 1, i + 1);
    if (!sample.every(valid)) continue;
    const mean = sample.reduce((sum, value) => sum + value, 0) / window;
    out[i] = Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (window - 1)) * 100;
  }
  return out;
}

/** OBV: 첫 거래량에서 시작. 종가 상승시 더하고 하락시 뺀다. 누락 이후는 누적값 미제공. */
export function onBalanceVolume(prices, volumes) {
  const out = new Array(prices.length).fill(null);
  let total = 0;
  for (let i = 0; i < prices.length; i++) {
    if (!valid(prices[i]) || !valid(volumes[i]) || volumes[i] < 0) break;
    if (i === 0) total = volumes[i];
    else total += Math.sign(prices[i] - prices[i - 1]) * volumes[i];
    out[i] = total;
  }
  return out;
}
