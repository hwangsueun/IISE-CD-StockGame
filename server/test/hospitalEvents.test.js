const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_DEFS, rollTurnEvents } = require('../src/services/eventEngine');
const db = require('../src/db');
test.after(() => db.pool.end());

async function roll({ lockedUntil = 13, stress = 0, faint = false } = {}) {
  const original = Object.fromEntries(Object.entries(EVENT_DEFS).map(([key, def]) => [key, def.trigger]));
  const calls = [];
  const session = { id: 'hospital-test', current_turn: 10, action_locked_until_turn: lockedUntil,
    cash: 5_000_000, debt: 100_000_000, stress, trust: 90 };
  const client = { query: async (sql) => { calls.push(sql); return { rows: [{ id: 7 }] }; } };
  try {
    for (const def of Object.values(EVENT_DEFS)) def.trigger = () => false;
    for (const def of Object.values(EVENT_DEFS).filter(def => def.kind === 'choice')) def.trigger = () => true;
    EVENT_DEFS.faint.trigger = () => faint;
    const events = await rollTurnEvents(client, session, { turnNumber: 10 });
    return { events, session, calls };
  } finally {
    for (const [key, trigger] of Object.entries(original)) EVENT_DEFS[key].trigger = trigger;
  }
}

test('hospital recovery creates no new choice prompts even when every random choice would fire', async () => {
  const { events, calls } = await roll();
  assert.deepEqual(events, []);
  assert.equal(calls.length, 0);
});

test('new admission applies its actual hospital cost and lock before suppressing choices', async () => {
  const { events, session } = await roll({ lockedUntil: 0, stress: 100, faint: true });
  assert.deepEqual(events.map(e => e.eventType), ['faint']);
  assert.equal(session.stress, 0);
  assert.equal(session.cash, 3_000_000);
  assert.ok(session.action_locked_until_turn >= 13 && session.action_locked_until_turn <= 15);
});

test('ordinary choice events are available again after discharge', async () => {
  const { events } = await roll({ lockedUntil: 9 });
  assert.ok(events.length > 0);
  assert.ok(events.every(e => e.kind === 'choice'));
});
