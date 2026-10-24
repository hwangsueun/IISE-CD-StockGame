const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { getQuantPortfolio, loadArtifact } = require('./quantService');

const cache = new Map();
const TOLERANCE = 1e-8;
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
function validateExplanation(report, loaded, decisionDate) {
  const signal = loaded.artifact.sessions[decisionDate];
  const model = loaded.artifact.models.find(m => m.id === signal?.model_id);
  if (!signal || !model || report.method !== 'lightgbm_tree_shap' || report.artifactSha256 !== loaded.sha ||
      report.modelVersion !== loaded.artifact.model_version || report.modelId !== model.id ||
      report.modelSha256 !== model.sha256 || report.decisionDate !== decisionDate ||
      report.signalDate !== signal.signal_date || report.trainedThrough !== model.trained_through ||
      report.featureCount !== 158 || report.rows?.length !== signal.ranking.length) throw Error('Attribution provenance mismatch');
  const seen = new Set(), scores = new Map(signal.ranking.map(([id, score]) => [id, score]));
  for (const row of report.rows) {
    if (seen.has(row.assetId) || !scores.has(row.assetId) || !Number.isFinite(row.score) ||
        !Number.isFinite(row.prediction) || !Number.isFinite(row.baseValue) || row.features?.length !== 158 ||
        new Set(row.features.map(f => f.name)).size !== 158 ||
        row.features.some(f => typeof f.name !== 'string' || !Number.isFinite(f.contribution) || (f.value !== null && !Number.isFinite(f.value))))
      throw Error('Invalid attribution values');
    const sum = row.baseValue + row.features.reduce((total, f) => total + f.contribution, 0);
    if (Math.abs(row.score - scores.get(row.assetId)) > TOLERANCE || Math.abs(row.prediction - row.score) > TOLERANCE || Math.abs(sum - row.prediction) > TOLERANCE)
      throw Error('Attributions do not reconstruct the pinned score');
    seen.add(row.assetId);
  }
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
  const python = process.env.QUANT_EXPLAIN_PYTHON || process.env.USER_STRATEGY_PYTHON ||
    (fs.existsSync(path.resolve(__dirname, '../../../quant/.venv/bin/python')) ? path.resolve(__dirname, '../../../quant/.venv/bin/python') : 'python3');
  const task = new Promise((resolve, reject) => {
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
  });
  cache.set(key, task);
  try {
    const result = await task;
    while (cache.size > 16) cache.delete(cache.keys().next().value);
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
