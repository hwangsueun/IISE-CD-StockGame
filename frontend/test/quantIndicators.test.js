import test from 'node:test';
import assert from 'node:assert/strict';
import { filterQuantIndicators, INDICATOR_GROUPS, INDICATOR_PERIODS, QUANT_INDICATORS } from '../src/utils/quantIndicators.js';

test('catalog covers all 158 unique expressions with a calculation and a valid category', () => {
  assert.equal(QUANT_INDICATORS.length, 158);
  assert.equal(new Set(QUANT_INDICATORS.map(({ name }) => name)).size, 158);
  assert.equal(filterQuantIndicators({ period: 'today' }).length, 13);
  for (const period of INDICATOR_PERIODS) assert.equal(filterQuantIndicators({ period }).length, 29);
  for (const item of QUANT_INDICATORS) {
    assert.ok(INDICATOR_GROUPS[item.group]);
    assert.ok(item.expression && item.formula && item.meaning);
    assert.doesNotMatch(item.formula + item.title, /\{n\}|undefined|null/);
  }
});

test('search accepts lowercase codes, Korean meaning and multiple terms', () => {
  const names = (filter) => filterQuantIndicators(filter).map(({ name }) => name);
  assert.ok(names({ query: '  ma20 ' }).includes('MA20'));
  assert.ok(names({ query: '평균 거래량' }).includes('VMA20'));
  assert.ok(names({ query: '전일 상승', group: 'change', period: '20' }).includes('CNTP20'));
  assert.deepEqual(names({ query: 'no-such-indicator' }), []);
});

test('category and period filters intersect and can return no results', () => {
  const matched = filterQuantIndicators({ group: 'volume', period: '20' });
  assert.equal(matched.length, 8);
  assert.ok(matched.every((item) => item.group === 'volume' && item.period === 20));
  assert.deepEqual(filterQuantIndicators({ group: 'candle', period: '20' }), []);
  assert.equal(filterQuantIndicators({ query: '  ' }).length, 158);
});
