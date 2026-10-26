const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { getQuantPortfolio, loadArtifact } = require('./quantService');
const { withModelWork } = require('./modelWorkGate');

const cache = new Map();
const TOLERANCE = 1e-8;
const ZERO_THRESHOLD = Math.fround(1e-35);
const unavailable = () => conflict('이 모델의 지표 분석 자료를 불러올 수 없습니다. 잠시 후 다시 확인해 주세요.');

// This context is server-derived. No client-supplied dates can reveal future scores.
function contextFor(portfolio, loaded, assetId) {
  if (portfolio.artifactSha256 !== loaded.sha || portfolio.modelVersion !== loaded.artifact.model_version)
    throw conflict('포트폴리오와 분석 모델이 다릅니다. 화면을 다시 열어 주세요.');
  const decision = portfolio.decision;
  const selection = decision?.selections?.find(row => row.assetId === assetId);
  if (!selection) throw notFound('최근 alpha158 평가에 포함된 종목이 아닙니다.');
  const signal = loaded.artifact.sessions[decision.date];
  const ranked = signal?.ranking.find(row => row[0] === assetId);
  const model = loaded.artifact.models.find(row => row.id === decision.modelId);
  if (!signal || !ranked || !model || !Number.isFinite(selection.score) ||
      signal.model_id !== decision.modelId || signal.signal_date !== decision.signalDate ||
      decision.date > portfolio.date || signal.signal_date > decision.date ||
      model.available_from > signal.signal_date || model.trained_through >= signal.signal_date ||
      Math.abs(ranked[1] - selection.score) > TOLERANCE) throw conflict('이 종목의 해당 시점 예측을 확인할 수 없습니다.');
  return { decision, selection, signal, model };
}
function modelDirectory(loaded) {
  if (process.env.QUANT_MODEL_DIR) return path.resolve(process.env.QUANT_MODEL_DIR);
  const sibling = path.dirname(loaded.file);
  if (fs.existsSync(path.join(sibling, 'features.parquet'))) return sibling;
  const pointer = path.join(sibling, 'active-data.json');
  if (fs.existsSync(pointer)) {
    const active = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (active.signals_sha256 === loaded.sha && typeof active.model_directory === 'string') return active.model_directory;
  }
  throw unavailable();
}
function fileStamp(file) {
  const stat = fs.statSync(file);
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
function validCondition(condition, features) {
  if (!condition || !features.has(condition.feature) ||
      condition.value !== features.get(condition.feature).value ||
      condition.valueWasMissing !== (condition.value === null) ||
      !['None', 'NaN', 'Zero'].includes(condition.missingType) ||
      typeof condition.defaultLeft !== 'boolean' || typeof condition.usedDefault !== 'boolean') return false;
  let effective = condition.value, left, usedDefault = false, routing = 'comparison', operator;
  if (condition.decisionType === '<=') {
    if (!Number.isFinite(condition.threshold)) return false;
    if (effective === null && condition.missingType !== 'NaN') {
      effective = 0; routing = 'nan_as_zero';
    }
    usedDefault = (condition.missingType === 'NaN' && effective === null) ||
      (condition.missingType === 'Zero' && Math.abs(effective) <= ZERO_THRESHOLD);
    if (usedDefault) { left = condition.defaultLeft; routing = 'missing_default'; }
    else left = effective <= condition.threshold;
    operator = left ? '<=' : '>';
  } else if (condition.decisionType === '==') {
    if (!Array.isArray(condition.threshold) || !condition.threshold.length ||
        condition.threshold.some(value => !Number.isInteger(value) || value < 0 || value >= 2147483648)) return false;
    if (effective !== null) {
      if (effective < -2147483648 || effective >= 2147483648) return false;
      effective = Math.trunc(effective);
    }
    if (effective === null || effective < 0) { left = false; routing = 'categorical_missing'; }
    else left = condition.threshold.includes(effective);
    operator = left ? 'in' : 'not_in';
  } else return false;
  return condition.effectiveValue === effective && condition.usedDefault === usedDefault &&
    condition.routing === routing && condition.selectedBranch === (left ? 'left' : 'right') &&
    condition.conditionOperator === operator;
}
function validateDecisionEvidence(report, row, references) {
  const features = new Map(row.features.map(feature => [feature.name, feature]));
  const ranked = [...row.features].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.name.localeCompare(b.name));
  const required = new Set([1, -1].flatMap(sign => ranked.filter(f => f.contribution * sign > 0).slice(0, 5).map(f => f.name)));
  for (const feature of row.features) {
    const evidence = feature.decisionEvidence;
    if (!evidence && !required.has(feature.name)) continue;
    const counts = ['totalTrees', 'modelTreeCount', 'pathTreeCount', 'splitCount', 'higherBranchCount', 'lowerBranchCount', 'equalBranchCount'];
    if (!evidence || evidence.method !== 'observed_tree_paths' ||
        counts.some(key => !Number.isInteger(evidence[key]) || evidence[key] < 0) ||
        evidence.totalTrees !== report.treeCount || evidence.modelTreeCount > report.treeCount ||
        evidence.pathTreeCount > evidence.modelTreeCount || evidence.pathTreeCount > evidence.splitCount ||
        (evidence.pathTreeCount === 0) !== (evidence.splitCount === 0) ||
        evidence.higherBranchCount + evidence.lowerBranchCount + evidence.equalBranchCount !== evidence.splitCount ||
        !Array.isArray(evidence.examples) || evidence.examples.length !== Math.min(2, evidence.pathTreeCount)) {
      throw Error('Invalid decision path evidence');
    }
    const comparison = evidence.referenceComparison;
    const reference = references.get(feature.name);
    if (!comparison || comparison.method !== 'one_feature_same_day_median' ||
        typeof comparison.available !== 'boolean' || !Number.isInteger(comparison.referencePopulation) ||
        comparison.referencePopulation < 0 || comparison.referencePopulation > report.rows.length ||
        comparison.referencePopulation !== reference.count || comparison.referenceValue !== reference.value ||
        !Number.isFinite(comparison.originalPrediction) || Math.abs(comparison.originalPrediction - row.prediction) > TOLERANCE ||
        (comparison.available
          ? comparison.referencePopulation === 0 || !Number.isFinite(comparison.referenceValue) ||
            !Number.isFinite(comparison.comparisonPrediction) || !Number.isFinite(comparison.difference) ||
            Math.abs(comparison.originalPrediction - comparison.comparisonPrediction - comparison.difference) > 1e-12
          : comparison.referencePopulation !== 0 || comparison.referenceValue !== null ||
            comparison.comparisonPrediction !== null || comparison.difference !== null)) {
      throw Error('Invalid one-feature reference comparison');
    }
    const trees = new Set();
    for (const example of evidence.examples) {
      if (!Number.isInteger(example.treeIndex) || example.treeIndex < 0 || example.treeIndex >= report.treeCount ||
          trees.has(example.treeIndex) || !Number.isInteger(example.nodeIndex) || example.nodeIndex < 0 ||
          example.feature !== feature.name || !validCondition(example, features) ||
          (report.numericSplitsOnly && example.decisionType !== '<=') ||
          !['selectedExpectedValue', 'alternativeExpectedValue', 'branchDifference'].every(key => Number.isFinite(example[key])) ||
          Math.abs(example.selectedExpectedValue - example.alternativeExpectedValue - example.branchDifference) > 1e-12 ||
          !['selectedSampleCount', 'alternativeSampleCount', 'omittedContextCount'].every(key => Number.isInteger(example[key]) && example[key] >= 0) ||
          example.selectedSampleCount + example.alternativeSampleCount === 0 ||
          !Array.isArray(example.context) || example.context.length > 3 ||
          example.context.some(condition => !validCondition(condition, features) ||
            (report.numericSplitsOnly && condition.decisionType !== '<='))) {
        throw Error('Invalid decision path example');
      }
      trees.add(example.treeIndex);
    }
  }
}
function validateExplanation(report, loaded, decisionDate) {
  const signal = loaded.artifact.sessions[decisionDate];
  const model = loaded.artifact.models.find(m => m.id === signal?.model_id);
  if (!signal || !model || report.method !== 'lightgbm_tree_shap' || report.artifactSha256 !== loaded.sha ||
      report.modelVersion !== loaded.artifact.model_version || report.modelId !== model.id ||
      report.modelSha256 !== model.sha256 || report.decisionDate !== decisionDate ||
      report.signalDate !== signal.signal_date || report.trainedThrough !== model.trained_through ||
      report.featureCount !== 158 || report.rows?.length !== signal.ranking.length ||
      report.decisionPathMethod !== 'lightgbm_observed_paths' || report.branchValueMethod !== 'leaf_count_weighted_subtree_output' ||
      !Number.isInteger(report.treeCount) || report.treeCount < 1 || typeof report.numericSplitsOnly !== 'boolean' ||
      report.pathLeavesVerified !== true || !Number.isFinite(report.maxPathScoreError) ||
      report.maxPathScoreError < 0 || report.maxPathScoreError > TOLERANCE) throw Error('Attribution provenance mismatch');
  const seen = new Set(), scores = new Map(signal.ranking.map(([id, score]) => [id, score]));
  const referenceValues = new Map();
  for (const row of report.rows) {
    if (seen.has(row.assetId) || !scores.has(row.assetId) || !Number.isFinite(row.score) ||
        !Number.isFinite(row.prediction) || !Number.isFinite(row.baseValue) || row.features?.length !== 158 ||
        new Set(row.features.map(f => f.name)).size !== 158 ||
        row.features.some(f => typeof f.name !== 'string' || !Number.isFinite(f.contribution) || (f.value !== null && !Number.isFinite(f.value))))
      throw Error('Invalid attribution values');
    const sum = row.baseValue + row.features.reduce((total, f) => total + f.contribution, 0);
    if (Math.abs(row.score - scores.get(row.assetId)) > TOLERANCE || Math.abs(row.prediction - row.score) > TOLERANCE || Math.abs(sum - row.prediction) > TOLERANCE)
      throw Error('Attributions do not reconstruct the pinned score');
    for (const feature of row.features) {
      if (!referenceValues.has(feature.name)) referenceValues.set(feature.name, []);
      if (feature.value !== null) referenceValues.get(feature.name).push(feature.value);
    }
    seen.add(row.assetId);
  }
  if (referenceValues.size !== 158) throw Error('Inconsistent attribution features');
  const references = new Map([...referenceValues].map(([name, values]) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const value = !values.length ? null : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return [name, { count: values.length, value }];
  }));
  for (const row of report.rows) validateDecisionEvidence(report, row, references);
  return report;
}
async function computeDay(loaded, decisionDate) {
  let directory, key;
  try {
    directory = modelDirectory(loaded);
    const modelId = loaded.artifact.sessions[decisionDate].model_id;
    if (!/^lgb-\d{8}$/.test(modelId)) throw Error('Invalid checkpoint name');
    key = [loaded.sha, decisionDate, directory, ...['features.parquet', 'spec.json', 'signals.json', `${modelId}.txt`].map(file => fileStamp(path.join(directory, file)))].join('|');
  } catch { throw unavailable(); }
  if (cache.has(key)) return cache.get(key);
  const python = require('../config/modelRuntime').pythonExecutable({ explain: true });
  const task = withModelWork(() => new Promise((resolve, reject) => {
    const child = execFile(python, [path.resolve(__dirname, '../../../quant/explain.py')], {
      timeout: 45000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout, stderr) => {
      if (error) { console.error('[alpha158 attribution]', error.code, stderr.slice(-700)); reject(unavailable()); return; }
      try { resolve(validateExplanation(JSON.parse(stdout), loaded, decisionDate)); }
      catch (error) { console.error('[alpha158 attribution]', error.message); reject(unavailable()); }
    });
    child.stdin.on('error', () => {}); // Spawn failures are reported through the callback.
    child.stdin.end(JSON.stringify({ modelDirectory: directory, signalsFile: loaded.file, artifactSha256: loaded.sha, decisionDate }));
  }));
  cache.set(key, task);
  try {
    const result = await task;
    while (cache.size > 2) cache.delete(cache.keys().next().value);
    return result;
  } catch (error) { cache.delete(key); throw error; }
}
async function getQuantAttribution(sessionId, assetId) {
  if (!/^STOCK_\d{6}$/.test(assetId)) throw badRequest('올바른 종목을 선택해 주세요.');
  const loaded = loadArtifact();
  if (!loaded) throw unavailable();
  const portfolio = await getQuantPortfolio(sessionId);
  const { decision, selection } = contextFor(portfolio, loaded, assetId);
  const report = await computeDay(loaded, decision.date);
  const { rows, ...metadata } = report;
  const row = rows.find(r => r.assetId === assetId);
  return { ...metadata, ...row, name: selection.name, rank: selection.rank,
    action: selection.action || 'held', decisionTurn: decision.turn, asOf: portfolio.date,
    topK: portfolio.topK, nDrop: portfolio.nDrop, strategy: portfolio.strategy,
    labelHorizon: portfolio.labelHorizon, executionRule: portfolio.executionRule };
}
module.exports = { getQuantAttribution, contextFor, validateExplanation, computeDay };
