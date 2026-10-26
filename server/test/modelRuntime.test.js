const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pythonExecutable, unavailableReason } = require('../src/config/modelRuntime');

test('model runtime resolves this checkout on macOS/Linux and Windows without a personal path', () => {
  const projectRoot = path.resolve('/tmp/model-runtime-checkout');
  for (const platform of ['darwin', 'linux', 'win32']) {
    const suffix = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const runtime = path.join(projectRoot, 'quant/.runtime', suffix), legacy = path.join(projectRoot, 'quant/.venv', suffix);
    const options = { projectRoot, platform, env: {} };
    assert.equal(pythonExecutable({ ...options, exists: file => [runtime, legacy].includes(file) }), runtime);
    assert.equal(pythonExecutable({ ...options, exists: file => file === legacy }), legacy);
    assert.equal(pythonExecutable({ ...options, exists: () => false }), platform === 'win32' ? 'python' : 'python3');
  }
});

test('explicit Python overrides are honored and relative paths are checkout relative', () => {
  const projectRoot = path.resolve('/tmp/model-runtime-checkout'), env = { USER_STRATEGY_PYTHON: 'quant/custom/bin/python', QUANT_EXPLAIN_PYTHON: '/tmp/explain-python' };
  assert.equal(pythonExecutable({ projectRoot, env }), path.join(projectRoot, 'quant/custom/bin/python'));
  assert.equal(pythonExecutable({ projectRoot, env, explain: true }), '/tmp/explain-python');
  assert.equal(pythonExecutable({ env: { USER_STRATEGY_PYTHON: 'python3.12' } }), 'python3.12');
});

test('missing dependencies identify packages and provide one complete installation command', () => {
  const message = unavailableReason(['sklearn', 'lightgbm']);
  assert.match(message, /scikit-learn, lightgbm/);
  assert.match(message, /node scripts\/setup-model-runtime.cjs/);
  assert.match(message, /USER_STRATEGY_PYTHON/);
});
