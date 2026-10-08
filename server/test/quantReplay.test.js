const test = require('node:test');
const assert = require('node:assert/strict');
const { replayQuant, validateArtifact } = require('../src/services/quantReplay');
const { quoteTradeAmount } = require('../src/services/executionService');

function fixture(count = 125) {
  const dates = [];
  for (let d = new Date('2020-01-02T00:00:00Z'); dates.length < count + 1; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  const assets = ['A', 'B'].map((id) => ({ asset_id: id, masked_name: `가명${id}`, is_active: true }));
  const prices = dates.flatMap((date) => assets.map((a) => ({ asset_id: a.asset_id, trade_date: date, close_price: 100 })));
  const turns = dates.slice(1).map((date, i) => ({ turn_number: i + 1, trade_date: date }));
  const sessions = Object.fromEntries(turns.map((t, i) => [t.trade_date, {
    signal_date: dates[i], model_id: 'past', ranking: [[i < 120 ? 'A' : 'B', 1, 100]],
  }]));
  return { turns, prices, assets, initialCash: 1050, artifact: {
    top_k: 1, rebalance_turns: 120, sessions,
    models: [{ id: 'past', trained_through: '2018-12-31', available_from: '2019-01-01' }],
  } };
}

test('same initial cash; integer shares; shared execution quote; repeated reads are identical', () => {
  const input = fixture(1);
  const a = replayQuant(input);
  assert.deepEqual(a, replayQuant(input));
  assert.equal(a.holdings[0].quantity, 10);
  assert.equal(a.cash, 50);
  assert.equal(a.totalAsset, input.initialCash);
  assert.equal(a.trades[0].amount, quoteTradeAmount('buy', 100, 10));
});

test('rebalance at 1 and 121 only; viewing for the first time after 121 still replays both', () => {
  const result = replayQuant(fixture());
  assert.deepEqual(result.decisions.map((d) => d.turn), [1, 121]);
  assert.deepEqual(result.trades.map((t) => [t.turn, t.side]), [[1, 'buy'], [121, 'sell'], [121, 'buy']]);
  assert.equal(result.holdings[0].assetId, 'B');
});

test('rebalance defers a holiday to the next market day without resetting its cadence', () => {
  const input = fixture();
  input.prices = input.prices.filter((r) => r.trade_date !== input.turns[120].trade_date);
  input.artifact.sessions[input.turns[121].trade_date].signal_date = input.turns[119].trade_date;
  const pending = replayQuant({ ...input, turns: input.turns.slice(0, 121) });
  assert.equal(pending.rebalancePending, true);
  assert.equal(pending.nextRebalanceTurn, 121);
  assert.deepEqual(replayQuant(input).decisions.map((d) => d.turn), [1, 122]);
});

test('future prices and signals cannot change a current portfolio', () => {
  const input = fixture(10);
  const before = replayQuant(input);
  input.prices.push({ asset_id: 'A', trade_date: '2099-01-01', close_price: 1 });
  input.artifact.sessions['2099-01-01'] = { ranking: [['B', 9999, 1]] };
  assert.deepEqual(replayQuant(input), before);
});

test('reject future-trained models and a mismatched game price history', () => {
  const input = fixture(1);
  input.artifact.models[0].trained_through = '2025-01-01';
  assert.throws(() => replayQuant(input), /날짜/);
  input.artifact.models[0].trained_through = '2018-12-31';
  input.artifact.sessions[input.turns[0].trade_date].ranking[0][2] = 999;
  assert.throws(() => replayQuant(input), /일치/);
});

test('missing signal keeps cash; missing price does not invent a zero valuation', () => {
  const input = fixture(2);
  input.prices = input.prices.filter((r) => r.trade_date !== input.turns[1].trade_date);
  assert.equal(replayQuant(input).totalAsset, 1050);
  input.artifact.sessions = {};
  const result = replayQuant(input);
  assert.equal(result.status, 'no_signal');
  assert.equal(result.cash, 1050);
  assert.equal(result.trades.length, 0);
});

test('delisting uses the last observed price and releases cash', () => {
  const input = fixture(3);
  input.assets[0].listed_to = input.turns[1].trade_date;
  input.prices = input.prices.filter((r) => r.asset_id !== 'A' || r.trade_date <= input.assets[0].listed_to);
  const result = replayQuant(input);
  assert.equal(result.cash, 1050);
  assert.equal(result.holdings.length, 0);
  assert.equal(result.trades.at(-1).reason, 'delisted');
});

function dailyFixture(count = 4) {
  const input = fixture(count);
  const dates = [...new Set(input.prices.map((p) => p.trade_date))];
  input.assets = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ asset_id: id, masked_name: id, is_active: true }));
  input.prices = dates.flatMap((date) => input.assets.map((a) => ({ asset_id: a.asset_id, trade_date: date, close_price: 100 })));
  Object.assign(input.artifact, { schema_version: 2, strategy: 'topk_dropout', top_k: 3,
    n_drop: 1, rebalance_turns: 1, label_horizon: { unit: 'market_sessions', value: 1 } });
  for (const signal of Object.values(input.artifact.sessions)) {
    signal.ranking = input.assets.map((a, i) => [a.asset_id, 6 - i, 100]);
  }
  return input;
}

test('daily evaluation keeps winners and quantities without unnecessary sell/buy orders', () => {
  const input = dailyFixture();
  const result = replayQuant(input);
  assert.deepEqual(result.decisions.map((d) => d.turn), [1, 2, 3, 4]);
  assert.equal(result.trades.length, 3);
  assert(result.trades.every((t) => t.turn === 1 && t.side === 'buy'));
  assert(result.holdings.every((h) => h.quantity === 3));
  assert(result.decision.selections.every((s) => s.action === 'held' && s.targetWeight === null));
  assert.equal(result.nextRebalanceTurn, 5);
  assert.deepEqual(replayQuant(input), result);
});

test('reversing all ranks replaces at most n_drop held stocks per market day', () => {
  const input = dailyFixture();
  for (const turn of input.turns.slice(1)) {
    input.artifact.sessions[turn.trade_date].ranking = ['F', 'E', 'D', 'C', 'B', 'A'].map((id, i) => [id, 6 - i, 100]);
  }
  const second = replayQuant({ ...input, turns: input.turns.slice(0, 2) });
  assert.deepEqual(second.holdings.map((h) => h.assetId).sort(), ['B', 'C', 'F']);
  assert.equal(second.holdings.find((h) => h.assetId === 'B').quantity, 3);
  const result = replayQuant(input);
  assert.deepEqual(result.holdings.map((h) => h.assetId).sort(), ['D', 'E', 'F']);
  for (const turn of input.turns.slice(1)) {
    assert.equal(result.trades.filter((t) => t.turn === turn.turn_number && t.side === 'sell').length, 1);
    assert.equal(result.trades.filter((t) => t.turn === turn.turn_number && t.side === 'buy').length, 1);
  }
});

test('ties retain incumbents; unavailable held prices cannot fund replacement purchases', () => {
  const input = dailyFixture(2);
  const signal = input.artifact.sessions[input.turns[1].trade_date];
  signal.ranking = ['F', 'E', 'D', 'C', 'B', 'A'].map((id) => [id, 1, 100]);
  assert.equal(replayQuant(input).trades.length, 3);
  signal.ranking = ['F', 'E', 'D', 'C', 'B', 'A'].map((id, i) => [id, 6 - i, 100]);
  input.prices = input.prices.filter((p) => p.trade_date !== input.turns[1].trade_date || p.asset_id !== 'A');
  const result = replayQuant(input);
  assert.equal(result.trades.length, 3);
  assert.equal(result.totalAsset, 1050);
  assert.equal(result.cash, 150);
});

test('daily replay skips holidays and missing signals while preserving holdings', () => {
  const input = dailyFixture(4);
  input.prices = input.prices.filter((p) => p.trade_date !== input.turns[1].trade_date);
  input.artifact.sessions[input.turns[2].trade_date].signal_date = input.turns[0].trade_date;
  delete input.artifact.sessions[input.turns[3].trade_date];
  const result = replayQuant(input);
  assert.deepEqual(result.decisions.map((d) => d.turn), [1, 3, 4]);
  assert.equal(result.status, 'no_signal');
  assert.equal(result.trades.length, 3);
  assert.equal(result.holdings.length, 3);
  // Future ranks, prices and repeated button presses do not change this prefix.
  const before = replayQuant({ ...input, turns: input.turns.slice(0, 2) });
  input.artifact.sessions[input.turns[2].trade_date].ranking.reverse();
  input.prices.filter((p) => p.trade_date > input.turns[1].trade_date).forEach((p) => { p.close_price = 900; });
  assert.deepEqual(replayQuant({ ...input, turns: input.turns.slice(0, 2) }), before);
});

test('artifact loading rejects changing only the cadence of a 120-turn model', () => {
  const old = { ...fixture(1).artifact, schema_version: 1 };
  assert.doesNotThrow(() => validateArtifact(old));
  assert.throws(() => validateArtifact({ ...old, rebalance_turns: 1 }), /학습 기간/);
  const daily = dailyFixture(1).artifact;
  assert.doesNotThrow(() => validateArtifact(daily));
  assert.throws(() => validateArtifact({ ...daily, label_horizon: { unit: 'weekdays', value: 120 } }), /학습 기간/);
  assert.throws(() => validateArtifact({ ...daily, n_drop: 4 }), /운용 주기/);
});
