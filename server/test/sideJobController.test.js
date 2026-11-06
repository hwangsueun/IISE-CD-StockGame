const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/sideJobService');
const controllerPath = require.resolve('../src/controllers/sideJobController');
const realService = require(servicePath);
const db = require('../src/db');

test.after(() => {
  require.cache[servicePath].exports = realService;
  delete require.cache[controllerPath];
  db.pool.end();
});

test('controller passes only game, score and mode to the authoritative service; auto needs no score', async () => {
  const calls = [];
  require.cache[servicePath].exports = { submitPlay: async (...args) => { calls.push(args); return { mode: args[3] }; } };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  const replies = [];
  const res = { json: (value) => replies.push(value) };
  await controller.submitPlay({ params: { sessionId: 'test' }, body: {
    gameKey: 'catch_waxon', mode: 'auto', cashReward: 999999999, stressDelta: -100, grade: 'great_success',
  } }, res);
  await controller.submitPlay({ params: { sessionId: 'test' }, body: { gameKey: 'catch_waxon', rawScore: '0' } }, res);
  assert.deepEqual(calls, [['test', 'catch_waxon', undefined, 'auto'], ['test', 'catch_waxon', '0', 'manual']]);
  assert.deepEqual(replies, [{ mode: 'auto' }, { mode: 'manual' }]);
  await assert.rejects(controller.submitPlay({ params: { sessionId: 'test' }, body: { mode: 'auto' } }, res), /gameKey/);
});
