const test = require('node:test');
const assert = require('node:assert/strict');
const { InvestmentValuation } = require('../src/services/investmentValuation');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const holding = (quantity, avgPrice, price) => ({ quantity, avgPrice, value: quantity * price });

test('one holding with a 0.93% gain reports 0.93% against its purchase cost', () => {
  const result = new InvestmentValuation([holding(1000, 1000, 1009.3)]).toJSON();
  assert.equal(result.cost, 1000000);
  assert.equal(result.value, 1009300);
  assert.equal(result.unrealizedPnl, 9300);
  close(result.returnRate, .0093);
});

test('multiple holdings use purchase-cost weights, not a mean of percentages or market-value weights', () => {
  const result = new InvestmentValuation([holding(10, 100, 110), holding(30, 100, 95)]).toJSON();
  assert.equal(result.cost, 4000);
  assert.equal(result.unrealizedPnl, -50);
  close(result.returnRate, -.0125);
});

test('remaining shares after a partial sale use their remaining average purchase cost', () => {
  const result = new InvestmentValuation([holding(7, 120, 132)]).toJSON();
  assert.equal(result.cost, 840);
  close(result.returnRate, .1);
});

test('no holdings or a fully sold position has no investment return', () => {
  for (const holdings of [[], [holding(0, 100, 110)]]) {
    assert.deepEqual(new InvestmentValuation(holdings).toJSON(), {
      cost: 0, value: 0, unrealizedPnl: 0, returnRate: null,
    });
  }
});

test('a total investment loss remains -100%; invalid holdings cannot invent a valid return', () => {
  assert.equal(new InvestmentValuation([holding(1, 100, 0)]).toJSON().returnRate, -1);
  for (const bad of [holding(1, 0, 100), holding(-1, 100, 110), { quantity: 1, avgPrice: 100, value: null }]) {
    assert.equal(new InvestmentValuation([holding(1, 100, 110), bad]).toJSON().returnRate, null);
  }
});
