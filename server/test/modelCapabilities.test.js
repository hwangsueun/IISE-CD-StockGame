const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../src/strategy/nativeModels.js');
function harness() {
  let now = 1000, executable = 'test-python', busy = false;
  const calls = [], logs = [], load = createRequire(filename), module = { exports: {} };
  const runtime = load('../config/modelRuntime');
  const requireMock = name => {
    if (name === 'node:child_process') return { execFile: (...args) => calls.push(args), spawnSync() { throw Error('unexpected training'); } };
    if (name === '../config/modelRuntime') return { ...runtime, pythonExecutable: () => executable };
    if (name === '../services/modelWorkGate') return { withModelWork: async fn => fn(), isModelWorkBusy: () => busy };
    return load(name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: requireMock, module, exports: module.exports,
    __dirname: path.dirname(filename), process, console: { error: (...args) => logs.push(args) }, Date: { now: () => now } });
  const all = Object.fromEntries(['randomForest', 'lightgbm', 'xgboost', 'risk'].map(id => [id, { available: true, version: 'test', missing: [] }]));
  return { api: module.exports, calls, logs, all, advance: ms => { now += ms; }, executable: value => { executable = value; }, busy: value => { busy = value; },
    finish: (error = null, report = { capabilities: all }) => calls.at(-1).at(-1)(error, typeof report === 'string' ? report : JSON.stringify(report)) };
}
test('cold checks allow 60 seconds and successful checks avoid repeated imports for ten minutes', async () => {
  const h = harness(), first = h.api.capabilities();
  assert.equal(h.calls[0][2].timeout, 60000);
  h.advance(20000); const joined = h.api.capabilities(); assert.equal(h.calls.length, 1);
  h.finish(); await joined; assert.equal((await first).xgboost.available, true);
  h.advance(61000); await h.api.capabilities(); assert.equal(h.calls.length, 1);
  h.advance(10 * 60000); const refresh = h.api.capabilities(); assert.equal(h.calls.length, 2); h.finish(); await refresh;
  h.executable('different-python'); const changed = h.api.capabilities(); assert.equal(h.calls.length, 3); h.finish(); await changed;
});
test('timeouts remain unavailable with a distinct message, safe diagnostics and a short retry', async () => {
  const h = harness(), first = h.api.capabilities(); h.advance(60005);
  h.finish({ code: null, signal: 'SIGTERM', killed: true }, '');
  const result = await first; assert.equal(result.randomForest.available, false);
  assert.match(result.randomForest.reason, /확인이 지연/); assert.doesNotMatch(result.randomForest.reason, /패키지/);
  assert.equal(h.logs[0][1].elapsedMs, 60005); assert.deepEqual(Object.keys(h.logs[0][1]).sort(), ['code', 'elapsedMs', 'killed', 'signal']);
  h.advance(16000); const retry = h.api.capabilities(); assert.equal(h.calls.length, 2); h.finish(); await retry;
});
test('actual missing packages retain installation guidance and cache refresh waits while models are busy', async () => {
  const h = harness(), first = h.api.capabilities();
  h.finish(null, { capabilities: { ...h.all, lightgbm: { available: false, missing: ['lightgbm'] } } });
  const result = await first; assert.match(result.lightgbm.reason, /lightgbm/); assert.equal(result.randomForest.available, true);
  h.advance(16000); h.busy(true); await h.api.capabilities(); assert.equal(h.calls.length, 1);
  h.busy(false); const retry = h.api.capabilities(); h.finish(); await retry; assert.equal(h.calls.length, 2);
});
