import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuantExplanation } from '../src/utils/quantExplanation.js';

const currentModel = {
  status: 'ready', strategy: 'topk_dropout', topK: 10, nDrop: 1,
  rebalanceTurns: 1, executionRule: 'next_market_open',
  labelHorizon: { unit: 'market_sessions', value: 1 }, initialCash: 50_000_000,
};

test('daily open model explains the prediction interval separately from execution and allocation', () => {
  const text = getQuantExplanation(currentModel);
  assert.match(text.prediction, /다음 개장일 시가부터 그다음 개장일 시가/);
  assert.match(text.prediction, /코스피 대비/);
  assert.match(text.execution, /다음 개장일 시가로 체결/);
  assert.match(text.allocationExample, /5,000,000/);
  assert.match(text.replacement, /동점이면 기존 종목을 유지/);
  assert.match(text.replacement, /처음 구성하거나 빈 자리를 채울 때/);
});

test('selection count, replacement limit and allocation follow session metadata', () => {
  const text = getQuantExplanation({ ...currentModel, topK: 5, nDrop: 2, initialCash: 100_000_000 });
  assert.match(text.summary, /최대 5종목/);
  assert.match(text.summary, /최대 2종목/);
  assert.match(text.allocationExample, /20,000,000/);
  assert.doesNotMatch(JSON.stringify(text), /최대 10종목|최대 1종목/);
});

test('legacy model retains its actual period and closing-price rules', () => {
  const text = getQuantExplanation({ status: 'ready', strategy: 'equal_weight_rebalance',
    topK: 10, rebalanceTurns: 120, labelHorizon: { unit: 'weekdays', value: 120 }, initialCash: 50_000_000 });
  assert.match(text.summary, /120턴마다/);
  assert.match(text.prediction, /120턴 뒤의 첫 개장일 종가/);
  assert.match(text.execution, /종가 기준/);
  assert.doesNotMatch(JSON.stringify(text), /매 턴|최대 1종목|시가/);
});

test('loading, unavailable or incomplete metadata does not invent portfolio rules', () => {
  for (const data of [null, {}, { ...currentModel, status: 'unavailable' },
    { ...currentModel, topK: undefined }, { ...currentModel, nDrop: null },
    { ...currentModel, strategy: 'unknown' }]) {
    assert.equal(getQuantExplanation(data), null);
  }
  assert.equal(getQuantExplanation({ ...currentModel, initialCash: null }).allocationExample, null);
});
