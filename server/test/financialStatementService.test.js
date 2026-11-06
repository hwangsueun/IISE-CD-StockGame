const test = require('node:test');
const assert = require('node:assert/strict');
const { getFinancialStatements, publicStatement, validateDate } = require('../src/services/financialStatementService');
const { pool } = require('../src/db');
test.after(() => pool.end());

test('statement public fields retain exact amounts and actual periods without issuer-identifying receipts', () => {
  const row = { fiscal_year: 2017, period_start: '2017-07-01', period_end: '2017-12-31',
    fs_div: 'CFS', currency: 'KRW', revenue: '900719925474099312345', operating_income: '0',
    net_income: '-123', total_assets: null, receipt_no: '20180402000954', source_sha256: 'private',
    metric_labels: { revenue: '영업수익', unknown: 'not public' } };
  const result = publicStatement(row);
  assert.equal(result.revenue, row.revenue);
  assert.equal(result.operating_income, '0');
  assert.equal(result.net_income, '-123');
  assert.equal(result.total_assets, null);
  assert.equal(result.period_start, '2017-07-01');
  assert.equal(result.period, 'annual');
  assert.equal(result.basis, 'CFS');
  assert.equal(result.receipt_no, undefined);
  assert.equal(result.source_sha256, undefined);
  assert.deepEqual(result.metric_labels, { revenue: '영업수익' });
});

test('empty source coverage and not-yet-published periods have separate UI states', async () => {
  for (const collected of [true, false]) {
    let calls = 0;
    const result = await getFinancialStatements('STOCK_000660', '2013-01-02', {
      query: async (_sql, params) => {
        calls++;
        if (calls === 1) { assert.deepEqual(params, ['STOCK_000660', '2013-01-02']); return { rows: [] }; }
        return { rows: [{ collected }] };
      },
    });
    assert.equal(result.financialsMeta.status, collected ? 'not_yet_available' : 'not_collected');
    assert.deepEqual(result.financials, []);
  }
});

test('invalid dates are rejected before querying the financial source', async () => {
  assert.equal(validateDate('2020-02-29'), '2020-02-29');
  for (const date of ['2019-02-29', '2020-13-01', '2020-1-01', 'tomorrow']) {
    await assert.rejects(getFinancialStatements('STOCK_000660', date, {
      query: () => assert.fail('invalid dates cannot query a statement'),
    }), /date/);
  }
});
