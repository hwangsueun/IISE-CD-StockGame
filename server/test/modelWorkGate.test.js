const test = require('node:test');
const assert = require('node:assert/strict');
const { withModelWork, isModelWorkBusy } = require('../src/services/modelWorkGate');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('one shared slot prevents overlap, reserves a waiting job and releases on failure', async () => {
  const previous = process.env.USER_STRATEGY_MAX_WORKERS;
  process.env.USER_STRATEGY_MAX_WORKERS = '1';
  try {
    const first = deferred(), second = deferred(), order = [];
    const a = withModelWork(async () => { order.push('first'); await first.promise; });
    await Promise.resolve();
    assert.equal(isModelWorkBusy(), true);
    await assert.rejects(withModelWork(() => { throw Error('must not run'); }), e => e.statusCode === 429);
    const b = withModelWork(async () => { order.push('second'); await second.promise; throw Error('expected failure'); }, { wait: true });
    const rejected = assert.rejects(b, /expected failure/);
    first.resolve(); await a;
    assert.deepEqual(order, ['first', 'second']);
    await assert.rejects(withModelWork(() => {}), e => e.statusCode === 429);
    second.resolve(); await rejected;
    assert.equal(isModelWorkBusy(), false);
    assert.equal(await withModelWork(() => 42), 42);
  } finally {
    if (previous === undefined) delete process.env.USER_STRATEGY_MAX_WORKERS;
    else process.env.USER_STRATEGY_MAX_WORKERS = previous;
  }
});
