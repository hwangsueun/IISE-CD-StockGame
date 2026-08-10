const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/db');
const valuationPath = require.resolve('../src/services/valuationService');
const realDb = require(dbPath);

function loadService(query) {
  require.cache[dbPath].exports = { ...realDb, query };
  delete require.cache[valuationPath];
  return require(valuationPath);
}

test.after(() => {
  require.cache[dbPath].exports = realDb;
  delete require.cache[valuationPath];
  realDb.pool.end();
});

test('getPortfolioHistory returns exact total/net assets and initial-capital returns', async () => {
  const service = loadService(async (sql) => {
    if (sql.includes('SELECT initial_cash, debt_initial')) {
      return { rows: [{ initial_cash: '50000000', debt_initial: '30000000' }] };
    }
    if (sql.includes('FROM session_snapshots')) {
      return {
        rows: [
          { turn_number: 1, total_asset: '50000000', debt: '30000000' },
          { turn_number: 2, total_asset: '55000000', debt: '29000000' },
        ],
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const result = await service.getPortfolioHistory('session-1');
  assert.deepEqual(result, {
    initialCapital: 50000000,
    points: [
      { turn: 1, totalAsset: 50000000, netAsset: 20000000, returnRate: 0 },
      { turn: 2, totalAsset: 55000000, netAsset: 26000000, returnRate: 0.1 },
    ],
  });
});

test('getPortfolioHistory backfills turn 1 for sessions created before dashboard snapshots', async () => {
  const service = loadService(async (sql) => {
    if (sql.includes('SELECT initial_cash, debt_initial')) {
      return { rows: [{ initial_cash: '50000000', debt_initial: '20000000' }] };
    }
    return { rows: [{ turn_number: 3, total_asset: '45000000', debt: '18000000' }] };
  });

  const result = await service.getPortfolioHistory('legacy-session');
  assert.deepEqual(result.points, [
    { turn: 1, totalAsset: 50000000, netAsset: 30000000, returnRate: 0 },
    { turn: 3, totalAsset: 45000000, netAsset: 27000000, returnRate: -0.1 },
  ]);
});

test('computeTotalAsset honors in-transaction cash and next-turn trade date overrides', async () => {
  let holdingsParams;
  const service = loadService(async () => {
    throw new Error('global query must not be used when a transaction client is supplied');
  });
  const client = {
    query: async (sql, params) => {
      assert.match(sql, /FROM holdings/);
      holdingsParams = params;
      return {
        rows: [{
          asset_id: 'STOCK_1', asset_type: 'stock', name: '테스트전자', sector: 'IT',
          quantity: '2', avg_price: '1000', price: '1500',
        }],
      };
    },
  };

  const total = await service.computeTotalAsset('session-1', client, {
    cash: 12000,
    tradeDate: '2026-08-10',
  });
  assert.equal(total, 15000);
  assert.deepEqual(holdingsParams, ['session-1', '2026-08-10']);
});

test('active purchased surge stock remains part of holdings and total assets until resolution', async () => {
  const service = loadService(async () => {
    throw new Error('global query must not be used when a transaction client is supplied');
  });
  const client = {
    query: async (sql) => {
      assert.match(sql, /FROM surge_stocks/);
      return {
        rows: [{
          asset_id: 'SURGE_7',
          asset_type: 'stock',
          name: '명세검증테크',
          sector: '급등주 이벤트',
          quantity: '4',
          avg_price: '12500',
          price: '12500',
          is_event_asset: true,
        }],
      };
    },
  };

  const holdings = await service.evaluateHoldings('session-1', client, { tradeDate: '2026-08-10' });
  assert.deepEqual(holdings, [{
    assetId: 'SURGE_7',
    assetType: 'stock',
    name: '명세검증테크',
    sector: '급등주 이벤트',
    quantity: 4,
    avgPrice: 12500,
    price: 12500,
    value: 50000,
    isEventAsset: true,
    unrealizedPnl: 0,
    returnRate: 0,
  }]);
});

test('getPortfolioHistory rejects unknown sessions', async () => {
  const service = loadService(async () => ({ rows: [] }));
  await assert.rejects(
    service.getPortfolioHistory('missing'),
    (err) => err.statusCode === 404 && err.message === '세션을 찾을 수 없습니다'
  );
});

test('dashboard day/week/month are aggregation units over every played turn', () => {
  const service = loadService(async () => {
    throw new Error('pure period builder must not query the database');
  });
  const points = Array.from({ length: 13 }, (_, index) => ({
    turn: index + 1,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    totalAsset: 50000000 + index * 100000,
    byType: { stock: 0, bond: 0, coin: 0 },
  }));

  const daily = service.buildDashboardPeriods(points, [], 'day', 'all');
  assert.equal(daily.periods.length, 12);
  assert.deepEqual(
    daily.periods.map(({ label }) => label),
    Array.from({ length: 12 }, (_, index) => `${12 - index}일차`)
  );

  const weekly = service.buildDashboardPeriods(points, [], 'week', 'all');
  assert.deepEqual(
    weekly.periods.map(({ label, startValue, endValue }) => [label, startValue, endValue]),
    [
      ['3주차', 51000000, 51200000],
      ['2주차', 50500000, 51000000],
      ['1주차', 50000000, 50500000],
    ]
  );
  assert.ok(weekly.periods.every((period) =>
    !Object.hasOwn(period, 'fromTurn') &&
    !Object.hasOwn(period, 'toTurn') &&
    !Object.hasOwn(period, 'isPartial')
  ));

  const monthly = service.buildDashboardPeriods(points, [], 'month', 'all');
  assert.deepEqual(monthly.periods.map(({ label }) => label), ['1개월차']);
  assert.ok(monthly.periods.every((period) =>
    !Object.hasOwn(period, 'fromTurn') &&
    !Object.hasOwn(period, 'toTurn') &&
    !Object.hasOwn(period, 'isPartial')
  ));

  const all = service.buildDashboardPeriods(points, [], 'all', 'all');
  assert.equal(all.periods.length, 1);
  assert.ok(!Object.hasOwn(all.periods[0], 'fromTurn'));
  assert.ok(!Object.hasOwn(all.periods[0], 'toTurn'));
  assert.equal(all.periods[0].netAmount, 1200000);
  assert.equal(all.periods[0].returnRate, 0.024);
});

test('asset-class performance excludes buy and sell cash movement from pure profit', () => {
  const service = loadService(async () => {
    throw new Error('pure period builder must not query the database');
  });
  const points = [
    {
      turn: 1, createdAt: '2026-01-01T00:00:00.000Z', totalAsset: 1000,
      byType: { stock: 0, bond: 0, coin: 0 },
    },
    {
      turn: 2, createdAt: '2026-01-02T00:00:00.000Z', totalAsset: 1010,
      byType: { stock: 110, bond: 0, coin: 0 },
    },
  ];
  const trades = [{
    createdAt: '2026-01-01T12:00:00.000Z', assetType: 'stock', netFlow: 100,
  }];

  const { periods } = service.buildDashboardPeriods(points, trades, 'day', 'stock');
  assert.equal(periods[0].startValue, 0);
  assert.equal(periods[0].endValue, 110);
  assert.equal(periods[0].netFlow, 100);
  assert.equal(periods[0].investedBase, 100);
  assert.equal(periods[0].netAmount, 10);
  assert.equal(periods[0].returnRate, 0.1);

  const soldPoints = [points[0], {
    ...points[1],
    byType: { stock: 0, bond: 0, coin: 0 },
  }];
  const roundTripTrades = [
    trades[0],
    { createdAt: '2026-01-01T18:00:00.000Z', assetType: 'stock', netFlow: -110 },
  ];
  const sold = service.buildDashboardPeriods(soldPoints, roundTripTrades, 'day', 'stock').periods[0];
  assert.equal(sold.endValue, 0);
  assert.equal(sold.netFlow, -10);
  assert.equal(sold.investedBase, 100);
  assert.equal(sold.netAmount, 10);
  assert.equal(sold.returnRate, 0.1);
});
