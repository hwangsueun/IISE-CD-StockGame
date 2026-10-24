const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function fit(samples, config, feeBps = 0) {
  const ys = samples.map(s => s.y), mu = mean(ys);
  const sigma = Math.sqrt(mean(ys.map(y => (y - mu) ** 2)));
  const fee = feeBps / 10000;
  // A buy and a sell must both be covered. The simulated execution uses these same fees.
  const cost = (1 + fee) / (1 - fee) - 1;
  const center = config.labelRule === 'sigma' ? mu : 0;
  const width = config.labelRule === 'sigma' ? sigma * config.labelSigma : config.labelThreshold / 100;
  return { type: config.target, rule: config.labelRule, lower: Math.min(-cost, center - width - cost),
    upper: Math.max(cost, center + width + cost), mu, sigma, cost, feeBps,
    classNames: config.target === 'threeClass' ? ['하락', '중립', '상승'] : ['하락 또는 비상승', '상승'],
    conditional: config.target === 'tails' };
}
function label(y, spec) {
  if (spec.type === 'return') return y;
  if (spec.type === 'binary') return y > spec.upper ? 1 : 0;
  if (spec.type === 'threeClass') return y < spec.lower ? 0 : y > spec.upper ? 2 : 1;
  return y < spec.lower ? 0 : y > spec.upper ? 1 : null;
}
function prepare(samples, config, feeBps) {
  const spec = fit(samples, config, feeBps), result = [];
  for (const s of samples) { const y = label(s.y, spec); if (y !== null) result.push({ ...s, rawReturn: s.y, y }); }
  const classes = config.target === 'threeClass' ? 3 : 2;
  const counts = Array.from({ length: classes }, (_, i) => result.filter(s => s.y === i).length);
  if (config.target !== 'return' && (result.length < 200 || counts.some(n => n < 20)))
    throw Error('라벨별 학습 사례가 부족합니다. 각 부류에 최소 20개가 필요합니다. 기준 폭이나 기간을 조정해 주세요.');
  return { samples: result, labelSpec: { ...spec, counts, excluded: samples.length - result.length } };
}
// Only evaluate labels whose exit price is already available. Never tune the model here.
function evaluate(model, data, dates, predict) {
  if (!model?.labelSpec || model.labelSpec.type === 'return') return null;
  const markets = [...data.frames.keys()], range = new Set(dates), bins = Array.from({ length: 5 }, () => ({ count: 0, predicted: 0, observed: 0 }));
  let count = 0, ignored = 0, loss = 0, brier = 0, correct = 0;
  for (let i = 0; i + 1 + model.horizon < markets.length; i += 5) {
    if (!range.has(markets[i])) continue;
    const enter = data.frames.get(markets[i + 1]), exit = data.frames.get(markets[i + 1 + model.horizon]);
    for (const row of data.frames.get(markets[i]).rows) {
      if (model.universe?.length && !model.universe.includes(row.id)) continue;
      const p0 = enter.bars.get(row.id)?.open, p1 = exit.bars.get(row.id)?.open;
      if (!(p0 > 0 && p1 > 0)) continue;
      const actual = label(p1 / p0 - 1, model.labelSpec);
      if (actual === null) { ignored++; continue; }
      const p = predict(row, model).probabilities;
      if (!p?.every(Number.isFinite)) continue;
      const up = p.length - 1, probability = p[up], bin = bins[Math.min(4, Math.floor(probability * 5))];
      bin.count++; bin.predicted += probability; bin.observed += Number(actual === up);
      count++; loss -= Math.log(Math.max(1e-12, p[actual]));
      brier += p.reduce((s, v, k) => s + (v - Number(k === actual)) ** 2, 0);
      correct += Number(p.indexOf(Math.max(...p)) === actual);
    }
  }
  return { count, ignored, conditional: model.labelSpec.conditional, logLoss: count ? loss / count : null,
    brier: count ? brier / count : null, accuracy: count ? correct / count : null,
    bins: bins.map(b => ({ count: b.count, predicted: b.count ? b.predicted / b.count : null, observed: b.count ? b.observed / b.count : null })) };
}
module.exports = { prepare, label, evaluate };
