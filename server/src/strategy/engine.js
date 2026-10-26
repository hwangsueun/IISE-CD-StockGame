const crypto = require('node:crypto');
const { features } = require('./catalog');
const research = require('./researchConfig');
const inputValue = (row, key, representation = 'rank') => representation === 'raw' ? row.values?.[key] : representation === 'zscore' ? row.zscores?.[key] : row.ranks?.[key] / 100 - .5;
const { fillOpenOrder, affordableShares, quoteTradeAmount } = require('../services/executionService');
const featureMap = new Map(features.map(f => [f.id, f]));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : NaN; };
const finite = Number.isFinite;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validateConfig(c) {
  c = { ...research.defaults, ensembleTrees: 100, ensembleDepth: 5, minLeaf: 30, learningRate: 0.05, ...c };
  if (!c || c.schemaVersion !== 1 || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60 ||
      typeof c.hypothesis !== 'string' || c.hypothesis.length > 500) throw Error('전략 이름과 가설을 확인해 주세요.');
  const enumValue = (key, options) => { if (!options.includes(c[key])) throw Error(`${key} 선택이 올바르지 않습니다.`); };
  const range = (key, min, max, integer = false) => { if (!finite(c[key]) || c[key] < min || c[key] > max || (integer && !Number.isInteger(c[key]))) throw Error(`${key} 범위를 확인해 주세요.`); };
  enumValue('method', ['conditions', 'score', 'ridge', 'tree', 'randomForest', 'lightgbm', 'xgboost']); enumValue('conditionMode', ['all', 'any']);
  enumValue('allocation', ['equal', 'inverseVol']); enumValue('rebalanceTurns', [1, 5, 20]);
  enumValue('marketMA', [0, 20, 60, 120, 200]); enumValue('horizon', [1, 5, 10, 20]);
  range('topK', 1, 30, true); range('exposure', 0, 100); range('maxWeight', 1, 100); range('targetVol', 0, 100);
  range('rankBuffer', 0, 30, true); range('trainYears', 1, 3, true); range('ridgePenalty', 0.01, 10); range('treeDepth', 1, 3, true);
  enumValue('ensembleTrees', [50, 100, 200]); enumValue('ensembleDepth', [3, 5, 8]);
  enumValue('minLeaf', [10, 30, 50]); enumValue('learningRate', [.03, .05, .1]);
  if (c.entryCeiling !== null) range('entryCeiling', -50, 100);
  if (!Array.isArray(c.terms) || c.terms.length > 12 || !Array.isArray(c.conditions) || c.conditions.length > 8) throw Error('지표는 12개, 조건은 8개까지 조합할 수 있습니다.');
  for (const t of c.terms) if (!featureMap.has(t.feature) || !finite(t.weight) || Math.abs(t.weight) > 5 || t.weight === 0) throw Error('지표와 가중치를 확인해 주세요.');
  if (new Set(c.terms.map(t => t.feature)).size !== c.terms.length) throw Error('같은 지표는 한 번만 선택해 주세요.');
  if (c.method !== 'conditions' && !c.terms.length) throw Error('순위 또는 학습에 사용할 지표를 하나 이상 선택해 주세요.');
  if (c.method === 'conditions' && !c.conditions.length) throw Error('종목 선정 조건을 하나 이상 추가해 주세요.');
  for (const r of c.conditions) if (!featureMap.has(r.feature) || !['raw', 'rank'].includes(r.measure) || !['gte', 'lte'].includes(r.op) || !finite(r.value) || Math.abs(r.value) > 1e6 || (r.measure === 'rank' && (r.value < 0 || r.value > 100))) throw Error('조건 값과 비교 방식을 확인해 주세요.');
  research.validate(c);
  // Return an allowlisted object: no expression execution or client-supplied models.
  const keys = [...Object.keys(research.defaults), 'schemaVersion', 'name', 'hypothesis', 'referenceId', 'method', 'terms', 'conditions', 'conditionMode', 'topK', 'rebalanceTurns', 'exposure', 'maxWeight', 'allocation', 'marketMA', 'targetVol', 'rankBuffer', 'entryCeiling', 'horizon', 'trainYears', 'ridgePenalty', 'treeDepth', 'ensembleTrees', 'ensembleDepth', 'minLeaf', 'learningRate'];
  return Object.fromEntries(keys.map(k => [k, k === 'referenceId' ? (typeof c[k] === 'string' ? c[k].slice(0, 40) : null) : structuredClone(c[k])]));
}
function weekdays(from, to) {
  const out = []; const d = new Date(`${from}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= to) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
function rawFeatures(a) {
  const c = a.at(-1).close, out = {};
  for (const n of [5, 20, 60, 120, 240]) out[`return${n}`] = a.length > n ? (c / a.at(-1 - n).close - 1) * 100 : NaN;
  for (const n of [60, 120, 240]) out[`skip${n}`] = a.length > n + 20 ? (a.at(-21).close / a.at(-1 - n - 20).close - 1) * 100 : NaN;
  for (const n of [20, 60]) out[`vol${n}`] = a.length > n ? std(a.slice(-n).map((p, j) => p.close / a[a.length - n + j - 1].close - 1)) * Math.sqrt(252) * 100 : NaN;
  for (const n of [20, 60, 120, 200]) out[`ma${n}`] = a.length >= n ? (c / mean(a.slice(-n).map(p => p.close)) - 1) * 100 : NaN;
  const vols = a.slice(-21, -1).map(p => p.volume);
  out.volume20 = a.length >= 21 && vols.every(finite) && mean(vols) > 0 && finite(a.at(-1).volume) ? a.at(-1).volume / mean(vols) : NaN;
  const amounts = a.slice(-20).map(p => p.amount);
  out.amount20 = a.length >= 20 && amounts.every(finite) ? mean(amounts) / 1e8 : NaN;
  const cs = a.slice(-60).map(p => p.close), lo = Math.min(...cs), hi = Math.max(...cs);
  out.position60 = a.length >= 60 && hi > lo ? (c - lo) / (hi - lo) * 100 : NaN;
  out.riskMomentum = finite(out.skip120) && out.vol60 > 0 ? out.skip120 / out.vol60 : NaN;
  for (const n of [1, 5, 20]) {
    const bars = a.slice(-n);
    out[`parkinson${n}`] = bars.length === n && bars.every(p => p.high > p.low && p.low > 0) ? Math.sqrt(mean(bars.map(p => Math.log(p.high / p.low) ** 2 / (4 * Math.log(2)))) * 252) * 100 : NaN;
  }
  return out;
}
function rankValues(rows, key) {
  const sorted = rows.filter(r => finite(r.values[key])).sort((a, b) => a.values[key] - b.values[key]);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1; while (j < sorted.length && sorted[j].values[key] === sorted[i].values[key]) j++;
    const value = sorted.length === 1 ? 50 : ((i + j - 1) / 2) / (sorted.length - 1) * 100;
    for (let k = i; k < j; k++) sorted[k].ranks[key] = value;
    i = j;
  }
}
function buildFrames({ prices, assets, benchmark }) {
  const assetMap = new Map(assets.map(a => [a.asset_id, a])), byDate = new Map(), histories = new Map(), featureHistories = new Map();
  for (const p of prices) {
    if (!byDate.has(p.trade_date)) byDate.set(p.trade_date, new Map());
    const num = x => x == null ? NaN : Number(x);
    byDate.get(p.trade_date).set(p.asset_id, { open: num(p.open_price), high: num(p.high_price), low: num(p.low_price), close: num(p.close_price), volume: num(p.adjusted_volume), amount: num(p.amount) });
  }
  const index = new Map(benchmark.map(b => [b.trade_date, Number(b.value)])), indexHistory = [], frames = new Map();
  for (const [date, bars] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = [];
    for (const [id, bar] of bars) {
      if (!(bar.close > 0)) continue;
      const a = histories.get(id) || []; a.push(bar); if (a.length > 261) a.shift(); histories.set(id, a);
      const asset = assetMap.get(id);
      if (!asset || asset.is_active === false || !(bar.open > 0) || (asset.listed_from && date < asset.listed_from) || (asset.listed_to && date > asset.listed_to)) continue;
      const values = rawFeatures(a), state = featureHistories.get(id) || { history: [], moments: {} }, zscores = {};
      // Welford add/remove updates retain the exact 60-observation definition without rescanning every window.
      // Calculate today's input before adding today's value to the historical moments.
      for (const f of features) {
        const m = state.moments[f.id], sd = m?.count === 60 ? Math.sqrt(Math.max(0, m.m2 / 59)) : NaN;
        zscores[f.id] = finite(sd) && finite(values[f.id]) ? (sd > 1e-12 ? (values[f.id] - m.mean) / sd : 0) : NaN;
      }
      const expired = state.history.length === 60 ? state.history.shift() : null;
      for (const f of features) {
        const m = state.moments[f.id] ||= { count: 0, mean: 0, m2: 0 }, old = expired?.[f.id], value = values[f.id];
        if (finite(old)) {
          if (m.count === 1) { m.count = 0; m.mean = 0; m.m2 = 0; }
          else { const nextMean = m.mean + (m.mean - old) / (m.count - 1); m.m2 = Math.max(0, m.m2 - (old - m.mean) * (old - nextMean)); m.mean = nextMean; m.count--; }
        }
        if (finite(value)) { m.count++; const delta = value - m.mean; m.mean += delta / m.count; m.m2 += delta * (value - m.mean); }
      }
      state.history.push(values); featureHistories.set(id, state);
      rows.push({ id, name: asset.masked_name || '이름 미등록', values, zscores, ranks: {}, close: bar.close });
    }
    for (const f of features) rankValues(rows, f.id);
    const benchmarkValue = index.get(date);
    // Stale/holiday index observations are never inserted as artificial zero-return sessions.
    if (benchmarkValue > 0) indexHistory.push(benchmarkValue);
    const market = { value: benchmarkValue || null, ma: {}, vol: NaN };
    for (const n of [20, 60, 120, 200]) market.ma[n] = benchmarkValue > 0 && indexHistory.length >= n ? mean(indexHistory.slice(-n)) : NaN;
    if (benchmarkValue > 0 && indexHistory.length > 20) market.vol = std(indexHistory.slice(-20).map((v, j) => v / indexHistory[indexHistory.length - 21 + j] - 1)) * Math.sqrt(252) * 100;
    frames.set(date, { date, bars, rows, market });
  }
  return { frames, assets: assetMap };
}
function vector(row, keys, representation) { return keys.map(k => inputValue(row, k, representation)); }
function solve(a, b) {
  const m = a.map((row, i) => [...row, b[i]]), n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i; for (let j = i + 1; j < n; j++) if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) throw Error('학습 행렬을 계산할 수 없습니다. 다른 지표를 선택해 주세요.');
    const d = m[i][i]; for (let k = i; k <= n; k++) m[i][k] /= d;
    for (let j = 0; j < n; j++) if (j !== i) { const t = m[j][i]; for (let k = i; k <= n; k++) m[j][k] -= t * m[i][k]; }
  }
  return m.map(row => row[n]);
}
function fitTree(samples, depth, keys) {
  const value = mean(samples.map(s => s.y));
  if (depth === 0 || samples.length < 100) return { value, count: samples.length };
  let best = null;
  for (let f = 0; f < keys.length; f++) for (const threshold of [-.4, -.3, -.2, -.1, 0, .1, .2, .3, .4]) {
    let nl = 0, nr = 0, sl = 0, sr = 0, ql = 0, qr = 0;
    for (const s of samples) { if (s.x[f] <= threshold) { nl++; sl += s.y; ql += s.y * s.y; } else { nr++; sr += s.y; qr += s.y * s.y; } }
    if (nl < 50 || nr < 50) continue;
    const loss = ql - sl * sl / nl + qr - sr * sr / nr;
    if (!best || loss < best.loss) best = { f, threshold, loss };
  }
  if (!best) return { value, count: samples.length };
  return { feature: keys[best.f], threshold: best.threshold, value, count: samples.length,
    left: fitTree(samples.filter(s => s.x[best.f] <= best.threshold), depth - 1, keys),
    right: fitTree(samples.filter(s => s.x[best.f] > best.threshold), depth - 1, keys) };
}
function trainingSet(config, data, cutoff, feeBps = 0) {
  const keys = config.terms.map(t => t.feature), dates = [...data.frames.keys()].filter(d => d < cutoff);
  const from = new Date(`${cutoff}T00:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - config.trainYears);
  const samples = []; let lastExit = null, trainingDates = 0;
  // Fixed five-session sampling bounds work and overlapping labels. Every label exit is before the forecast cutoff.
  for (let i = 0; i + 1 + config.horizon < dates.length; i += 5) {
    if (dates[i] < from.toISOString().slice(0, 10)) continue;
    const enter = data.frames.get(dates[i + 1]), exit = data.frames.get(dates[i + 1 + config.horizon]);
    let count = 0;
    for (const row of data.frames.get(dates[i]).rows) {
      if (config.riskAssets?.length && !config.riskAssets.includes(row.id)) continue;
      const x = vector(row, keys, config.representation), p0 = enter.bars.get(row.id)?.open, p1 = exit.bars.get(row.id)?.open;
      if (!x.every(finite) || !(p0 > 0) || !(p1 > 0)) continue;
      const y = p1 / p0 - 1;
      samples.push({ x, y, date: dates[i], id: row.id }); count++;
    }
    if (count) { trainingDates++; lastExit = exit.date; }
  }
  if (samples.length < 200 || trainingDates < 20) throw Error('이 시점 이전의 학습 자료가 부족합니다. 더 짧은 지표 기간 또는 조건·가중치 방식을 선택해 주세요.');
  const labelled = config.target && config.target !== 'return' ? require('./labels').prepare(samples, config, feeBps) : { samples, labelSpec: null };
  const metadata = { representation: config.representation || 'rank', horizon: config.horizon, universe: config.riskAssets || [], labelSpec: labelled.labelSpec, keys, sampleCount: labelled.samples.length, trainingDates, trainedFrom: samples[0].date, trainedThrough: lastExit, availableFrom: cutoff, trainingHash: hash(labelled.samples),
    target: `다음 개장일 시가부터 ${config.horizon}개장일 뒤 시가까지의 종목 수익률`, fixedDuringEvaluation: true };
  return { samples: labelled.samples, metadata };
}
function train(config, data, cutoff, prepared, feeBps = 0) {
  if (!['ridge', 'tree', 'randomForest', 'lightgbm', 'xgboost'].includes(config.method)) return null;
  const { samples, metadata } = require('./reduction').fit(config, prepared || trainingSet(config, data, cutoff, feeBps));
  const model = { ...metadata, method: config.method }, keys = model.keys;
  if (['randomForest', 'lightgbm', 'xgboost'].includes(config.method)) return require('./nativeModels').train(config, samples, model);
  if (config.method === 'tree' && (model.transform || config.representation !== 'rank')) return require('./nativeModels').train(config, samples, model);
  if (config.method === 'tree') return { ...model, tree: fitTree(samples, config.treeDepth, keys) };
  const p = keys.length, means = keys.map((_, i) => mean(samples.map(s => s.x[i]))), ym = mean(samples.map(s => s.y));
  const a = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
  for (const s of samples) for (let i = 0; i < p; i++) {
    b[i] += (s.x[i] - means[i]) * (s.y - ym) / samples.length;
    for (let j = 0; j < p; j++) a[i][j] += (s.x[i] - means[i]) * (s.x[j] - means[j]) / samples.length;
  }
  for (let i = 0; i < p; i++) a[i][i] += config.ridgePenalty;
  const coefficients = solve(a, b), intercept = ym - coefficients.reduce((s, c, i) => s + c * means[i], 0);
  return { ...model, coefficients, intercept };
}
function predict(row, model) {
  if(model.transform) {
    const t=model.transform, x=t.inputKeys.map(k=>inputValue(row,k,t.inputRepresentation));
    if(!x.every(finite))return {score:NaN};
    const axes=require('./reduction').project(x,t), values=Object.fromEntries(model.keys.map((k,i)=>[k,axes[i]]));
    return {...predict({values,ranks:{}},{...model,transform:null}),axisValues:values};
  }
  const value = k => inputValue(row, k, model.representation);
  if (model.keys.some(k => !finite(value(k)))) return { score: NaN };
  if (model.method === 'ridge') return { score: model.intercept + model.keys.reduce((s, k, i) => s + value(k) * model.coefficients[i], 0),
    contributions: model.keys.map((feature, i) => ({ feature, value: value(feature) * model.coefficients[i] })), intercept: model.intercept };
  if (model.ensemble) {
    const totals = Object.fromEntries(model.keys.map(k => [k, 0]));
    const classes = model.ensemble.classes || 1, scores = Array(classes).fill(0);
    let intercept = 0;
    const scale = model.ensemble.aggregation === 'mean' ? model.ensemble.trees.length / classes : 1;
    const explainClass = classes - 1;
    for (let i = 0; i < model.ensemble.trees.length; i++) {
      let node = model.ensemble.trees[i], group = node.group || 0;
      if (group === explainClass) intercept += node.value / scale;
      while (node.feature) {
        const x = model.inputPrecision === 'float32' ? Math.fround(value(node.feature)) : value(node.feature);
        const left = node.operator === '<' ? x < node.threshold : x <= node.threshold;
        const child = left ? node.left : node.right;
        if (group === explainClass) totals[node.feature] += (child.value - node.value) / scale;
        node = child;
      }
      scores[group] += node.value / scale;
    }
    const base = model.ensemble.base || Array(classes).fill(0);
    scores.forEach((_, i) => { scores[i] += base[i] || 0; }); intercept += base[explainClass] || 0;
    let probabilities;
    if (model.ensemble.link === 'logistic') { const p = 1 / (1 + Math.exp(-scores[0])); probabilities = [1 - p, p]; }
    else if (model.ensemble.link === 'softmax') { const max = Math.max(...scores), e = scores.map(v => Math.exp(v - max)), sum = e.reduce((a, b) => a + b, 0); probabilities = e.map(v => v / sum); }
    else if (model.ensemble.link === 'probability') probabilities = scores;
    return { score: probabilities ? probabilities.at(-1) : scores[0], probabilities, margin: scores[explainClass], intercept,
      contributions: model.keys.map(feature => ({ feature, value: totals[feature] })),
      treeCount: model.ensemble.trees.length, explanationMethod: probabilities && model.ensemble.link !== 'probability' ? 'margin_path_delta' : 'path_delta' };
  }
  let node = model.tree; const path = [];
  while (node.feature) {
    const left = value(node.feature) <= node.threshold;
    path.push({ feature: node.feature, percentile: row.ranks?.[node.feature], threshold: (node.threshold + .5) * 100,
      observed:value(node.feature),rawThreshold:node.threshold,representation:model.representation,direction: left ? '이하' : '초과' });
    node = left ? node.left : node.right;
  }
  return { score: node.value, path, leafCount: node.count };
}
function selection(config, frame, holdings = new Map(), model = null, risk = null) {
  const required = new Set([...config.conditions.map(r => r.feature), ...(config.method === 'conditions' ? [] : config.terms.map(t => t.feature)),
    ...(config.allocation === 'inverseVol' ? ['vol20'] : []), ...(config.entryCeiling !== null ? ['return5'] : [])]);
  const scored = [], excluded = { missing: 0, conditions: 0, entry: 0 };
  for (const row of frame.rows) {
    if (config.riskAssets?.length && !config.riskAssets.includes(row.id)) continue;
    if ([...required].some(k => !finite(row.values[k]) || !finite(row.ranks[k]))) { excluded.missing++; continue; }
    const checks = config.conditions.map(r => ({ ...r, observed: r.measure === 'rank' ? row.ranks[r.feature] : row.values[r.feature] }));
    for (const c of checks) c.passed = c.op === 'gte' ? c.observed >= c.value : c.observed <= c.value;
    if (checks.length && !(config.conditionMode === 'all' ? checks.every(c => c.passed) : checks.some(c => c.passed))) { excluded.conditions++; continue; }
    let result = { score: 0 };
    if (config.method === 'score') {
      const scale = config.terms.reduce((s, t) => s + Math.abs(t.weight), 0);
      result.contributions = config.terms.map(t => ({ feature: t.feature, value: t.weight * (row.ranks[t.feature] / 100 - .5) / scale }));
      result.score = result.contributions.reduce((s, c) => s + c.value, 0);
    } else if (model) result = predict(row, model);
    if (!finite(result.score)) { excluded.missing++; continue; }
    scored.push({ ...row, ...result, checks });
  }
  scored.sort((a, b) => b.score - a.score || Number(holdings.has(b.id)) - Number(holdings.has(a.id)) || a.id.localeCompare(b.id));
  scored.forEach((r, i) => { r.rank = i + 1; });
  const canEnter = row => (config.tradePolicy !== 'probability' || row.score >= config.entryProbability) && (holdings.has(row.id) || config.entryCeiling === null || row.values.return5 <= config.entryCeiling);
  const kept = scored.filter(r => holdings.has(r.id) && (config.tradePolicy === 'probability' ? r.score > config.exitProbability : r.rank <= config.topK + config.rankBuffer)).slice(0, config.topK);
  const chosen = [...kept];
  for (const row of scored) {
    if (chosen.some(c => c.id === row.id)) continue;
    if (!canEnter(row)) { excluded.entry++; continue; }
    if (chosen.length < config.topK) chosen.push(row);
  }
  let exposure = config.exposure / 100; const reasons = [];
  if (config.marketMA) {
    if (!finite(frame.market.ma[config.marketMA])) { exposure = 0; reasons.push('시장 추세 자료가 충분하지 않아 현금으로 대기합니다.'); }
    else if (!(frame.market.value > frame.market.ma[config.marketMA])) { exposure = 0; reasons.push(`코스피가 ${config.marketMA}거래일 평균 이하라 현금으로 대기합니다.`); }
    else reasons.push(`코스피가 ${config.marketMA}거래일 평균 위에 있습니다.`);
  }
  if (config.targetVol) {
    if (!finite(frame.market.vol)) { exposure = 0; reasons.push('시장 변동성 자료가 부족해 현금으로 대기합니다.'); }
    else { exposure *= frame.market.vol > 0 ? Math.min(1, config.targetVol / frame.market.vol) : 1; reasons.push(`시장 변동성 ${frame.market.vol.toFixed(1)}%에 맞춰 투자 비중을 조절합니다.`); }
  }
  let riskForecast = null, riskScale = 1;
  if (config.riskModel && config.riskModel !== 'none') {
    riskForecast = require('./risk').forecast(config, frame, risk, chosen, exposure);
    if (!finite(riskForecast.annualVol)) { exposure = 0; reasons.push(riskForecast.reason || '위험 예측 자료가 부족해 현금으로 대기합니다.'); }
    else { riskScale=Math.min(1, config.riskTarget / Math.max(.01, riskForecast.annualVol));exposure *= riskScale; reasons.push(`예상 연율 변동성 ${riskForecast.annualVol.toFixed(1)}%에 맞춰 비중을 조절합니다.`); }
  }
  const weights = chosen.map(r => config.allocation === 'inverseVol' ? 1 / Math.max(r.values.vol20, .1) : 1), sum = weights.reduce((a, b) => a + b, 0);
  chosen.forEach((r, i) => { r.targetWeight = riskForecast?.portfolioWeights ? riskForecast.portfolioWeights[i]*riskScale : Math.min(config.maxWeight / 100, exposure * weights[i] / sum); });
  return { date: frame.date, rows: chosen, candidates: scored.length, excluded, exposure, reasons,
    riskForecast, cashWeight: 1 - chosen.reduce((s, r) => s + r.targetWeight, 0), market: frame.market };
}
function targetOrders(decision, holdings, cash, lastPrices, frame, turn) {
  const equity = cash + [...holdings].reduce((s, [id, h]) => s + h.quantity * (lastPrices.get(id) || h.avgPrice), 0);
  const targets = new Map(decision.rows.map(r => [r.id, Math.floor(equity * r.targetWeight / r.close)])), orders = [];
  const make = (id, side, quantity) => ({ assetId: id, side, quantity, decisionTurn: turn, decisionDate: frame.date,
    referencePrice: frame.bars.get(id).close, cashBudget: side === 'buy' ? quoteTradeAmount('buy', frame.bars.get(id).close, quantity) : 0, status: 'pending' });
  for (const [id, h] of holdings) {
    const p = frame.bars.get(id); if (!(p?.open > 0) || !(p?.close > 0)) continue;
    if ((targets.get(id) || 0) < h.quantity) orders.push(make(id, 'sell', h.quantity - (targets.get(id) || 0)));
  }
  let budget = cash + orders.reduce((s, o) => s + quoteTradeAmount('sell', o.referencePrice, o.quantity), 0);
  for (const row of decision.rows) {
    const desired = (targets.get(row.id) || 0) - (holdings.get(row.id)?.quantity || 0);
    const qty = Math.min(desired, affordableShares(budget, row.close));
    if (qty > 0) { const o = make(row.id, 'buy', qty); orders.push(o); budget -= o.cashBudget; }
  }
  return orders;
}
function replay(config, data, dates, initialCash, model, { equalHold = false, endGame = false, risk = null } = {}) {
  let cash = initialCash, pending = [], lastDecision = null, nextCheck = 1, equalInitialized = false;
  const holdings = new Map(), lastPrices = new Map(), history = [], orders = [], trades = [];
  for (const [date, frame] of data.frames) { if (date >= dates[0]) break; for (const [id, bar] of frame.bars) lastPrices.set(id, bar.close); }
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i], turn = i + 1, frame = data.frames.get(date);
    for (const [id, h] of holdings) if (data.assets.get(id)?.listed_to && date > data.assets.get(id).listed_to) {
      const amount = quoteTradeAmount('sell', lastPrices.get(id) || h.avgPrice, h.quantity); cash += amount; holdings.delete(id);
      trades.push({ assetId: id, side: 'sell', quantity: h.quantity, amount, turn, reason: 'delisted' });
    }
    if (frame && pending.length) {
      for (const o of pending.sort((a, b) => Number(a.side === 'buy') - Number(b.side === 'buy') || a.assetId.localeCompare(b.assetId))) {
        const h = holdings.get(o.assetId), asset = data.assets.get(o.assetId);
        const listed = asset && (!asset.listed_from || date >= asset.listed_from) && (!asset.listed_to || date <= asset.listed_to);
        const fill = fillOpenOrder(o, { openPrice: listed ? frame.bars.get(o.assetId)?.open : NaN, cash, heldQuantity: h?.quantity || 0, avgPrice: h?.avgPrice || 0 });
        Object.assign(o, fill, { executionTurn: turn, executionDate: date });
        if (!fill.filledQuantity) continue;
        const quantity = (h?.quantity || 0) + (o.side === 'buy' ? fill.filledQuantity : -fill.filledQuantity);
        if (!quantity) holdings.delete(o.assetId);
        else holdings.set(o.assetId, { quantity, avgPrice: o.side === 'buy' ? ((h?.quantity || 0) * (h?.avgPrice || 0) + fill.filledQuantity * fill.price) / quantity : h.avgPrice });
        cash += o.side === 'buy' ? -fill.amount : fill.amount; trades.push({ ...o, turn });
      }
      pending = [];
    }
    if (frame) {
      for (const [id, bar] of frame.bars) if (bar.close > 0) lastPrices.set(id, bar.close);
      const decision = equalHold ? { rows: [], exposure: 1 } : selection(config, frame, holdings, model, risk);
      lastDecision = { ...decision, turn, reviewDue: turn >= nextCheck };
      if (equalHold) {
        if (!equalInitialized) {
          const rows = frame.rows.map(r => ({ ...r, targetWeight: 1 / frame.rows.length }));
          if (rows.length && i < dates.length - 1) { pending = targetOrders({ rows }, holdings, cash, lastPrices, frame, turn); equalInitialized = true; }
        }
      } else if ((turn >= nextCheck || (decision.exposure === 0 && holdings.size)) && !(endGame && i === dates.length - 1)) {
        pending = targetOrders(decision, holdings, cash, lastPrices, frame, turn);
        if (turn >= nextCheck) nextCheck = Math.floor((turn - 1) / config.rebalanceTurns + 1) * config.rebalanceTurns + 1;
      }
      orders.push(...pending);
    }
    const totalAsset = cash + [...holdings].reduce((s, [id, h]) => s + h.quantity * (lastPrices.get(id) || h.avgPrice), 0);
    if (cash < 0 || !finite(totalAsset)) throw Error('전략 현금 계산이 올바르지 않습니다.');
    history.push({ date, turn, totalAsset, cash, returnRate: totalAsset / initialCash - 1 });
  }
  let peak = initialCash, mdd = 0;
  for (const row of history) { peak = Math.max(peak, row.totalAsset); mdd = Math.min(mdd, row.totalAsset / peak - 1); }
  return { initialCash, totalAsset: history.at(-1)?.totalAsset ?? initialCash, returnRate: (history.at(-1)?.totalAsset ?? initialCash) / initialCash - 1,
    maxDrawdown: mdd, history, tradeCount: trades.length, orders, trades, decision: lastDecision, cash,
    nextCheck, holdings: [...holdings].map(([id, h]) => ({ assetId: id, name: data.assets.get(id)?.masked_name || '이름 미등록', ...h, value: h.quantity * (lastPrices.get(id) || h.avgPrice) })) };
}
function monthly(history, initialCash, rivalHistory = []) {
  const out = []; let before = initialCash, rivalBefore = initialCash;
  for (let i = 19; i < history.length; i += 20) {
    const row = history[i], rival = rivalHistory[i];
    out.push({ month: (i + 1) / 20, returnRate: row.totalAsset / before - 1, rivalReturn: rival ? rival.totalAsset / rivalBefore - 1 : null });
    before = row.totalAsset; if (rival) rivalBefore = rival.totalAsset;
  }
  return out;
}
function sourceHash(input, until) {
  const prices = input.prices.filter(p => p.trade_date <= until).map(p => { if (input.config?.researchVersion) return p; const { high_price, low_price, ...legacy } = p; return legacy; });
  return hash({ assets: input.assets, prices, benchmark: input.benchmark.filter(p => p.trade_date <= until) });
}
module.exports = { validateConfig, weekdays, rawFeatures, rankValues, buildFrames, trainingSet, train, predict, selection, targetOrders, replay, monthly, sourceHash, hash };
