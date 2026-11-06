const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('actual SQL import preserves original and corrected receipt timing, periods and exact amounts', {
  skip: process.env.FINANCIAL_STATEMENTS_INTEGRATION !== '1', timeout: 60000,
}, async t => {
  require('dotenv').config();
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.pathname, '/antsurvival_challenge_20261019');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const db = require('../src/db');
  const { importFinancials } = require('../seeds/import_financials');
  const { getFinancialStatements } = require('../src/services/financialStatementService');
  const schema = `financial_test_${randomUUID().replaceAll('-', '')}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'financial-integration-'));
  const setup = await db.pool.connect();
  t.after(async () => {
    await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    setup.release(); await db.pool.end(); await fs.rm(directory, { recursive: true, force: true });
  });
  await setup.query(`CREATE SCHEMA ${schema}`);
  await setup.query(`SET search_path TO ${schema}`);
  await setup.query("CREATE TABLE assets(asset_id VARCHAR(30) PRIMARY KEY,asset_type TEXT); INSERT INTO assets VALUES('STOCK_000660','stock')");
  await setup.query(await fs.readFile(path.join(__dirname, '../migrations/015_stock_financial_statements.sql'), 'utf8'));
  const scopedPool = { connect: async () => { const client = await db.pool.connect(); await client.query(`SET search_path TO ${schema}`); return client; } };
  const base = { asset_id: 'STOCK_000660', fiscal_year: 2015, period_start: '2015-01-01', period_end: '2015-12-31',
    published_date: '2016-03-30', available_date: '2016-03-31', receipt_no: '20160330000001', fs_div: 'CFS', currency: 'KRW',
    revenue: '900719925474099312345', operating_income: '0', net_income: '-7', metric_labels: { revenue: '매출액' },
    source: { kind: 'dart_major_accounts', sha256: 'a'.repeat(64) } };
  const correction = { ...base, receipt_no: '20211210000418', published_date: '2021-12-10', available_date: '2021-12-11', revenue: '123456789012345678901' };
  const short = { ...base, receipt_no: '20180402000954', fiscal_year: 2017, period_start: '2017-07-01', period_end: '2017-12-31',
    published_date: '2018-04-02', available_date: '2018-04-03', revenue: '52383846935' };
  const file = path.join(directory, 'bundle.json');
  await fs.writeFile(file, JSON.stringify({ version: 'integration-financials-v1', records: [base, correction, short] }));
  assert.equal((await importFinancials(scopedPool, { file })).inserted, 3);
  assert.equal((await importFinancials(scopedPool, { file })).skipped, true);
  const get = date => getFinancialStatements('STOCK_000660', date, setup);
  assert.equal((await get('2016-03-30')).financialsMeta.status, 'not_yet_available');
  assert.equal((await get('2016-03-31')).financials[0].revenue, base.revenue);
  assert.equal((await get('2016-09-26')).financials[0].revenue, base.revenue);
  const beforeCorrection = (await get('2021-12-10')).financials;
  assert.equal(beforeCorrection.find(row => row.fiscal_year === 2015).revenue, base.revenue);
  const afterCorrection = (await get('2021-12-11')).financials;
  assert.equal(afterCorrection.find(row => row.fiscal_year === 2015).revenue, correction.revenue);
  assert.equal(afterCorrection.find(row => row.fiscal_year === 2017).period_start, '2017-07-01');
  assert.equal(afterCorrection.length, 2);
  const { rows: counts } = await setup.query('SELECT COUNT(*)::int AS total FROM stock_financial_statements');
  assert.equal(counts[0].total, 3);
  await fs.writeFile(file, JSON.stringify({ version: 'integration-financials-v1', records: [base] }));
  await assert.rejects(importFinancials(scopedPool, { file }), /checksum mismatch/);
  assert.equal((await get('2016-09-26')).financials[0].revenue, base.revenue);
});
