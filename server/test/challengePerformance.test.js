const test = require('node:test');
const assert = require('node:assert/strict');
const { investmentReturn, applyFlow, scoreRound, firstEligibleMonth } = require('../src/services/challengePerformance');

const initial = { reference_asset: 50_000_000, performance_factor: 1, invalid_period: false };
function flow(state, before, delta) {
  const next = applyFlow(state, before, delta);
  return { reference_asset: next.reference, performance_factor: next.factor, invalid_period: next.invalid };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('salary, side jobs, repayments, expenses and prizes alone produce zero investment return', () => {
  let state = initial, assets = 50_000_000;
  for (const delta of [2_000_000, 100_000, -500_000, -4_000_000, 2_500_000]) {
    state = flow(state, assets, delta);
    assets += delta;
    close(investmentReturn(state, assets), 0);
  }
});

test('chain returns on either side of a deposit instead of dividing by starting cash', () => {
  // +10%, then salary deposit, then -5%: 1.10 * .95 - 1 = 4.5%.
  const state = flow(initial, 55_000_000, 5_000_000);
  close(investmentReturn(state, 57_000_000), .045);
  const afterRepay = flow(state, 57_000_000, -7_000_000);
  close(investmentReturn(afterRepay, 50_000_000), .045);
});

test('proportional prizes use percentage point difference and round down won', () => {
  assert.deepEqual(scoreRound(.08, .03, 50_000_000), { outcome: 'win', excess: .05, prize: 2_500_000 });
  assert.equal(scoreRound(.01, 0, 50_000_000).prize, 500_000);
  assert.equal(scoreRound(-.02, -.05, 50_000_000).prize, 1_500_000);
  assert.equal(scoreRound(.01, .02, 50_000_000).prize, 0);
  assert.equal(scoreRound(.1 + .2, .3, 50_000_000).outcome, 'tie');
  assert.equal(scoreRound(.000000035, 0, 50_000_000).prize, 1);
});

test('zero/negative capital and missing model returns cannot create a prize', () => {
  const state = flow(initial, 50_000_000, -50_000_000);
  assert.equal(investmentReturn(state, 1_000_000), null);
  assert.equal(investmentReturn(initial, 0), null);
  assert.equal(investmentReturn(initial, -1), null);
  assert.equal(scoreRound(null, -.5, 50_000_000).outcome, 'unavailable');
  assert.equal(scoreRound(.5, undefined, 50_000_000).prize, 0);
});

test('only first-day enrollment includes month one; later entries wait for a full month', () => {
  assert.equal(firstEligibleMonth(1), 1);
  for (const turn of [2, 5, 19, 20]) assert.equal(firstEligibleMonth(turn), 2);
  assert.equal(firstEligibleMonth(21), 3);
  assert.equal(firstEligibleMonth(220), 12);
  assert.equal(firstEligibleMonth(221), 13);
  assert.equal(firstEligibleMonth(240), 13);
});
