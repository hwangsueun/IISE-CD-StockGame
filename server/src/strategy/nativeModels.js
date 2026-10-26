const { spawnSync, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const script = path.join(__dirname, 'train_native.py');
const { pythonExecutable: python, unavailableReason, root } = require('../config/modelRuntime');
const unavailable = unavailableReason();
const { withModelWork, isModelWorkBusy } = require('../services/modelWorkGate');
function environment() {
  return { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' };
}
let cached;
const probeTimeoutMs = 60000, successfulCacheMs = 10 * 60000, failedCacheMs = 15000;
async function capabilities() {
  const executable = python();
  const expired = cached && !cached.pending && Date.now() - cached.at > (cached.successful ? successfulCacheMs : failedCacheMs);
  if (!cached || cached.executable !== executable || (expired && !isModelWorkBusy())) {
    const promise = withModelWork(() => new Promise(resolve => {
      const started = Date.now();
      execFile(executable, [path.join(root, 'quant/check_runtime.py')], { timeout: probeTimeoutMs, env: environment() }, (error, stdout) => {
        let report;
        try { if (!error) report = JSON.parse(stdout); } catch { /* No imitation fallback. */ }
        const timedOut = (error?.killed && error.signal === 'SIGTERM') || error?.code === 'ETIMEDOUT';
        if (error || !report?.capabilities) console.error('[model-runtime:probe]', {
          code: error?.code ?? (error ? null : 'INVALID_OUTPUT'), signal: error?.signal || null,
          killed: !!error?.killed, elapsedMs: Date.now() - started,
        });
        resolve(Object.fromEntries(['randomForest', 'lightgbm', 'xgboost', 'risk'].map(id => {
          const capability = report?.capabilities?.[id];
          return [id, { available: !!capability?.available, version: capability?.version || null,
            reason: capability?.available ? null : timedOut
              ? '모델 실행 환경 확인이 지연되고 있습니다. 잠시 후 다시 열어 주세요.'
              : unavailableReason(capability?.missing) }];
        })));
      });
    }), { wait: true }).then(result => {
      if (cached?.promise === promise) {
        cached.at = Date.now();
        cached.pending = false;
        cached.successful = Object.values(result).every(capability => capability.available);
      }
      return result;
    });
    promise.catch(() => { if (cached?.promise === promise) cached = null; });
    cached = { executable, at: Date.now(), promise, successful: false, pending: true };
  }
  return cached.promise;
}
function train(config, samples, metadata) {
  const result = spawnSync(python(), [script], {
    input: JSON.stringify({ config, samples, keys: metadata.keys }), encoding: 'utf8',
    timeout: 45000, maxBuffer: 32 * 1024 * 1024, env: environment(),
  });
  if (result.error?.code === 'ETIMEDOUT') throw Error('모델 학습 시간이 초과되었습니다. 나무 수나 학습 기간을 줄여 주세요.');
  if (result.error || result.status !== 0) throw Error(unavailable);
  const exported = JSON.parse(result.stdout), verification = exported.verification;
  delete exported.verification;
  const model = { ...metadata, ...exported }, { predict } = require('./engine');
  let maxError = 0;
  const tolerance = model.library === 'xgboost' ? 2e-6 : 1e-9;
  for (let i = 0; i < verification.inputs.length; i++) {
    const values = Object.fromEntries(model.keys.map((k, j) => [k, verification.inputs[i][j]]));
    const ranks = Object.fromEntries(model.keys.map((k, j) => [k, (verification.inputs[i][j] + .5) * 100]));
    const result = predict({ ranks, values, zscores: values }, { ...model, transform: null }), score = result.score, expected = verification.predictions[i];
    if (verification.probabilities) result.probabilities.forEach((p, k) => { maxError = Math.max(maxError, Math.abs(p - verification.probabilities[i][k])); });
    if (!Number.isFinite(score) || !Number.isFinite(expected)) throw Error('모델 예측값 검증에 실패했습니다.');
    maxError = Math.max(maxError, Math.abs(score - expected));
  }
  if (maxError > tolerance) throw Error('저장된 나무의 예측값이 원본 모델과 다릅니다.');
  return { ...model, verification: { count: verification.inputs.length, maxError, tolerance } };
}
function runScript(name, payload) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'antsurvival-risk-'));
  let result;
  try {
    const input = path.join(dir, 'input.json');
    fs.writeFileSync(input, JSON.stringify(payload), { mode: 0o600 });
    result = spawnSync(python(), [path.join(__dirname, name), input], { stdio: ['ignore','pipe','pipe'], encoding: 'utf8', timeout: 45000, maxBuffer: 32 * 1024 * 1024, env: environment() });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (result.error?.code === 'ETIMEDOUT') throw Error('위험 모델 학습 시간이 초과되었습니다. 종목 수나 학습 기간을 줄여 주세요.');
  if (result.error || result.status !== 0) {
    console.error('[strategy risk]', result.error?.code || result.status, result.stderr?.slice(-1500));
    throw Error('위험 모델을 학습하지 못했습니다. 학습 자료와 실행 환경을 확인해 주세요.');
  }
  const parsed = JSON.parse(result.stdout); if (parsed.error) throw Error(parsed.error); return parsed;
}
module.exports = { train, capabilities, runScript };
