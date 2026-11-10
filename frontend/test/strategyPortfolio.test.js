import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategyPortfolioSnapshot } from '../src/utils/strategyPortfolio.js';

test('holdings use executed positions and cash-inclusive weights, not target selections', () => {
  const report = {
    cash: 400, totalAsset: 1500,
    holdings: [{ assetId: 'held', quantity: 10, avgPrice: 100, value: 1100 }],
    decision: { rows: [{ id: 'next', targetWeight: 1 }] },
    pendingOrders: [{ assetId: 'next', side: 'buy', quantity: 5 }],
  };
  const original = structuredClone(report), portfolio = new StrategyPortfolioSnapshot(report);
  assert.equal(portfolio.available, true);
  assert.equal(portfolio.holdings.length, 1);
  const holding = portfolio.holdings[0];
  assert.equal(holding.assetId, 'held');
  assert.equal(holding.price, 110);
  assert.equal(holding.profit, 100);
  assert.ok(Math.abs(holding.returnRate - .1) < 1e-12);
  assert.ok(Math.abs(holding.weight + portfolio.cashWeight - 1) < 1e-12);
  assert.deepEqual(report, original);
});

test('each model keeps its own balances, including a first-day cash-only portfolio', () => {
  const invested = new StrategyPortfolioSnapshot({ cash: 200, totalAsset: 1000,
    holdings: [{ assetId: 'S1', quantity: 10, avgPrice: 100, value: 800 }] });
  const waiting = new StrategyPortfolioSnapshot({ cash: 1000, totalAsset: 1000, holdings: [],
    pendingOrders: [{ assetId: 'S2', quantity: 5 }],
    history: [{ turn: 1, totalAsset: 1000, cash: 1000, returnRate: 0 }] });
  assert.equal(invested.holdings[0].profit, -200);
  assert.equal(waiting.available, true);
  assert.deepEqual(waiting.holdings, []);
  assert.equal(waiting.cashWeight, 1);
  assert.equal(waiting.history[0].totalAsset, 1000);
});

test('old reports keep available holdings and never invent historical cash balances', () => {
  const legacy = new StrategyPortfolioSnapshot({ cash: 100, totalAsset: 100, holdings: [], chart: [{ own: 0 }] });
  assert.equal(legacy.available, true);
  assert.equal(legacy.history, null);
  assert.equal(new StrategyPortfolioSnapshot({}).available, false);
  const empty = new StrategyPortfolioSnapshot({ cash: 0, totalAsset: 0, holdings: [] });
  assert.equal(empty.available, true);
  assert.equal(empty.cashWeight, null);
});
