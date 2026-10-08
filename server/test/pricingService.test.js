const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const servicePath = require.resolve('../src/services/pricingService');
const realDb = require(dbPath);

function loadService(rows, calls = []) {
  require.cache[dbPath].exports = {
    ...realDb,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
  delete require.cache[servicePath];
  return require(servicePath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[servicePath];
  realDb.pool.end();
});

test('daily price series keeps the requested bounds and returns numeric closes', async () => {
  const calls = [];
  const service = loadService([
    { trade_date: '2024-01-02', close_price: '100', change_rate: null, bucket: '2024-01-02' },
    { trade_date: '2024-01-03', close_price: '110', change_rate: '0.1', bucket: '2024-01-03' },
  ], calls);

  assert.deepEqual(await service.getPriceSeries('STOCK_1', '2024-01-01', '2024-01-31', 'day'), [
    { date: '2024-01-02', price: 100, changeRate: null },
    { date: '2024-01-03', price: 110, changeRate: 0.1 },
  ]);
  assert.deepEqual(calls[0].params, ['STOCK_1', '2024-01-01', '2024-01-31']);
});

test('weekly bars follow calendar buckets and chain each open from the prior close', async () => {
  const service = loadService([
    { trade_date: '2024-01-02', close_price: '100', change_rate: null, bucket: '2024-01-01' },
    { trade_date: '2024-01-05', close_price: '110', change_rate: null, bucket: '2024-01-01' },
    { trade_date: '2024-01-08', close_price: '105', change_rate: null, bucket: '2024-01-08' },
    { trade_date: '2024-01-12', close_price: '120', change_rate: null, bucket: '2024-01-08' },
  ]);

  assert.deepEqual(await service.getPriceSeries('STOCK_1', '2024-01-01', '2024-01-31', 'week'), [
    {
      date: '2024-01-05', from: '2024-01-02', days: 2, unit: 'week',
      open: 100, high: 110, low: 100, close: 110, price: 110, changeRate: 0.1,
    },
    {
      date: '2024-01-12', from: '2024-01-08', days: 2, unit: 'week',
      open: 110, high: 120, low: 105, close: 120, price: 120, changeRate: 10 / 110,
    },
  ]);
});

test('decline ranking sorts ascending with missing prices last and excludes out-of-period listings', async () => {
  const calls = [];
  const service = loadService([
    {
      asset_id: 'STOCK_DOWN', asset_type: 'stock', name: '하락 종목', sector: '테스트',
      currency: 'KRW', price: '90', change_rate: '-0.1', volume: '1000',
    },
    {
      asset_id: 'STOCK_MISSING', asset_type: 'stock', name: '시세 없음', sector: '테스트',
      currency: 'KRW', price: null, change_rate: null, volume: null,
    },
  ], calls);

  const rows = await service.listAssets({ type: 'stock', sort: 'decline', date: '2014-01-17' });

  assert.match(calls[0].sql, /a\.listed_from IS NULL OR a\.listed_from <= \$2/);
  assert.match(calls[0].sql, /a\.listed_to IS NULL OR a\.listed_to >= \$2/);
  assert.match(calls[0].sql, /ORDER BY p\.change_rate ASC NULLS LAST/);
  assert.deepEqual(calls[0].params, ['stock', '2014-01-17']);
  assert.deepEqual(rows.map(({ assetId, changeRate }) => ({ assetId, changeRate })), [
    { assetId: 'STOCK_DOWN', changeRate: -0.1 },
    { assetId: 'STOCK_MISSING', changeRate: null },
  ]);
});
