const test = require('node:test');
const assert = require('node:assert/strict');
const { restriction, enforce } = require('../src/services/investmentPolicy');

test('investment restrictions cover both endpoints of hospitalization and the stress-before-event gap', () => {
  const s = { id: 's', current_turn: 10, action_locked_until_turn: 12, side_job_turn: 0, stress: 0 };
  assert.equal(restriction(s).code, 'hospitalized');
  assert.equal(restriction(s).resumeTurn, 13);
  assert.equal(restriction({ ...s, current_turn: 12 }).code, 'hospitalized');
  assert.equal(restriction({ ...s, current_turn: 13 }), null);
  assert.equal(restriction({ ...s, action_locked_until_turn: 0, stress: 100 }).code, 'stress_limit');
  assert.equal(restriction({ ...s, action_locked_until_turn: 0, stress: 99 }), null);
});

test('side jobs block only their own turn; simultaneous hospitalization takes priority', () => {
  const s = { current_turn: 4, action_locked_until_turn: 0, side_job_turn: 4, stress: 20 };
  assert.equal(restriction(s).code, 'side_job');
  assert.equal(restriction(s).resumeTurn, 5);
  assert.equal(restriction({ ...s, current_turn: 5 }), null);
  assert.equal(restriction({ ...s, action_locked_until_turn: 6 }).code, 'hospitalized');
});

test('pause cancels only unfilled player orders and schedules a fresh review without disabling the model', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql.includes('market_orders') ? [{ id: 11 }, { id: 12 }] : [] };
  } };
  const result = await enforce(client, { id: 's', current_turn: 3, side_job_turn: 3 });
  assert.equal(result.cancelledOrderCount, 2);
  assert.match(calls[0].sql, /owner='player' AND status='pending'/);
  assert.deepEqual(calls[0].params, ['s', 'investment_locked_side_job']);
  assert.match(calls[1].sql, /LEAST\(next_review_turn,\$2\)/);
  assert.deepEqual(calls[1].params, ['s', 4]);
  assert.ok(calls.every(c => !/holdings|trades|enabled=FALSE|SET cash/.test(c.sql)));
  calls.length = 0;
  assert.equal(await enforce(client, { id: 's', current_turn: 4, side_job_turn: 3 }), null);
  assert.equal(calls.length, 0);
});
