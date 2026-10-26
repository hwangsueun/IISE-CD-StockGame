const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../src/services/userStrategyService.js');
function harness() {
  const workers = [], timers = [], load = createRequire(filename), module = { exports: {} };
  class Worker extends EventEmitter {
    constructor() { super(); workers.push(this); }
    async terminate() { this.terminated = true; return 1; }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'node:worker_threads' ? { Worker } : load(name),
    module, exports: module.exports, __dirname: path.dirname(filename),
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
  });
  return { run: module.exports.run, workers, timers };
}
test('saved comparisons receive one 120-second budget for each of two to four models', async () => {
  const h = harness();
  for (const count of [2, 3, 4]) {
    const pending = h.run({ mode: 'compareSaved', versions: Array(count).fill({}) });
    assert.equal(h.timers.at(-1).ms, count * 120000);
    h.workers.at(-1).emit('message', { result: { complete: true } });
    assert.equal((await pending).complete, true);
    assert.equal(h.workers.at(-1).terminated, true);
    assert.equal(h.timers.at(-1).cleared, true);
  }
});
test('other operations and invalid comparison counts cannot extend the base deadline', async () => {
  const h = harness();
  const inputs = ['save', 'practice', 'compare', 'observe', 'automate'].map(mode => ({ mode, versions: Array(4).fill({}) }));
  inputs.push(...[undefined, null, {}, [], [{}], Array(5).fill({}), Array(100).fill({})].map(versions => ({ mode: 'compareSaved', versions })));
  for (const input of inputs) {
    const pending = h.run(input);
    assert.equal(h.timers.at(-1).ms, 120000);
    h.workers.at(-1).emit('message', { result: {} }); await pending;
  }
});
test('the bounded comparison deadline still terminates the worker and rejects the request', async () => {
  const h = harness(), pending = h.run({ mode: 'compareSaved', versions: Array(4).fill({}) });
  const rejected = assert.rejects(pending, error => error.statusCode === 503);
  await h.timers[0].callback(); await rejected;
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.timers[0].cleared, true);
});
