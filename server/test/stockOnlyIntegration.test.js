const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Run against the local challenge copy; create and clean up only this test's sessions.
test('stock-only game: API restrictions, new games, legacy orders, holiday deferral and stock round trip', {
  skip: process.env.STOCK_ONLY_INTEGRATION !== '1', timeout: 90000,
}, async t => {
  require('dotenv').config();
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db');
  const execution = require('../src/services/executionService');
  const orders = require('../src/services/orderService');
  const calendar = require('../src/services/turnSelector');
  const ids = [];
  t.after(async () => {
    for (const id of ids) await db.query('DELETE FROM game_sessions WHERE id=$1', [id]);
    await db.pool.end();
  });
  async function request(path, body) {
    const res = await fetch(`http://127.0.0.1:3002/api${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  const created = await request('/game/start', { difficulty: 'normal' });
  assert.equal(created.status, 201);
  ids.push(created.body.sessionId);
  assert.equal(created.body.cash, created.body.totalAsset);
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM session_coin_universe WHERE session_id=$1', [ids[0]])).rows[0].count), 0);
  const first = await request(`/game/${ids[0]}/turn/1`);
  assert.ok(first.body.assets.length > 0);
  assert.ok(first.body.assets.every(a => a.assetType === 'stock'));
  assert.deepEqual(first.body.executionRules, { stock: 'next_market_open' });
  const market = await request('/assets?date=2014-09-05');
  assert.ok(market.body.length > 0 && market.body.every(a => a.assetType === 'stock'));
  const pf = await request(`/game/${ids[0]}/portfolio`);
  assert.deepEqual(Object.keys(pf.body.weights).sort(), ['cash', 'stock']);
  assert.equal(pf.body.totalAsset, created.body.totalAsset);

  const dates = ['2014-09-05', '2014-09-08', '2014-09-11', '2014-09-12'];
  const { rows: [s] } = await db.query(`INSERT INTO game_sessions
    (difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost)
    VALUES ('normal',$1,50000000,50000000,100000000,100000000,800000) RETURNING *`, [dates[0]]);
  ids.push(s.id);
  await calendar.createGameTurns(db, s.id, dates);
  const { rows: excluded } = await db.query(`SELECT DISTINCT ON (asset_type) asset_id,asset_type
    FROM assets WHERE is_active AND asset_type IN ('bond','coin') ORDER BY asset_type,asset_id`);
  assert.equal(excluded.length, 2);
  for (const asset of excluded) {
    assert.equal((await request(`/assets?type=${asset.asset_type}`)).status, 400);
    assert.equal((await request(`/assets/${asset.asset_id}?date=${dates[0]}`)).status, 404);
    assert.deepEqual((await request(`/assets/${asset.asset_id}/prices?from=${dates[0]}&to=${dates[3]}`)).body, []);
    assert.deepEqual((await request(`/community/${asset.asset_id}?date=${dates[0]}`)).body, []);
    assert.equal((await request(`/game/${s.id}/portfolio/dashboard?assetType=${asset.asset_type}`)).status, 400);
    assert.equal((await request(`/game/${s.id}/portfolio/pnl?assetType=${asset.asset_type}`)).status, 400);
    for (const tradeType of ['buy', 'sell']) {
      const blocked = await request(`/game/${s.id}/trade`, { assetId: asset.asset_id, tradeType, quantity: 1 });
      assert.equal(blocked.status, 400);
      assert.match(blocked.body.error, /주식만/);
    }
    await db.query(`INSERT INTO market_orders
      (session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget)
      VALUES ($1,'player',$2,$3,'buy',1,$4,1,50000000,50000000)`,
    [s.id, `legacy-${asset.asset_type}`, asset.asset_id, dates[0]]);
    assert.equal((await request(`/game/${s.id}/trade`, {
      assetId: asset.asset_id, tradeType: 'buy', quantity: 1, orderKey: `legacy-${asset.asset_type}`,
    })).status, 400);
  }

  // Choose a real stock with a next open within the fixed decision-day budget.
  const { rows: [stock] } = await db.query(`SELECT a.asset_id,p.close_price,n.open_price
    FROM assets a JOIN asset_prices p USING(asset_id)
    JOIN stock_price_detail d ON d.asset_id=a.asset_id AND d.trade_date=p.trade_date
    JOIN stock_price_detail n ON n.asset_id=a.asset_id AND n.trade_date=$2
    JOIN stock_price_detail last ON last.asset_id=a.asset_id AND last.trade_date=$3
    WHERE a.asset_type='stock' AND a.is_active AND p.trade_date=$1
      AND d.open_price>0 AND n.open_price>0 AND last.open_price>0
      AND n.open_price<=p.close_price AND p.close_price<1000000
    ORDER BY a.asset_id LIMIT 1`, [dates[0], dates[2], dates[3]]);
  assert.ok(stock);
  assert.equal((await request(`/game/${s.id}/trade`, { assetId: stock.asset_id, tradeType: 'buy', quantity: 0.5 })).status, 400);
  const orderKey = randomUUID();
  const submitted = await request(`/game/${s.id}/trade`, { assetId: stock.asset_id, tradeType: 'buy', quantity: 2, orderKey });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.status, 'pending');
  assert.equal(submitted.body.executionRule, 'next_market_open');
  const replay = await request(`/game/${s.id}/trade`, { assetId: stock.asset_id, tradeType: 'buy', quantity: 2, orderKey });
  assert.equal(replay.body.orderId, submitted.body.orderId);
  assert.equal((await request(`/game/${s.id}`)).body.cash, 50000000);
  assert.deepEqual((await request(`/game/${s.id}/portfolio`)).body.holdings, []);

  async function settle(turn) {
    return db.withTransaction(async client => {
      const { rows: [session] } = await client.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE', [s.id]);
      session.current_turn = turn;
      const result = await orders.settlePendingOrders(client, session, dates[turn - 1], await calendar.isMarketOpen(dates[turn - 1], client));
      await client.query('UPDATE game_sessions SET current_turn=$2,cash=$3 WHERE id=$1', [s.id, turn, session.cash]);
      return result;
    });
  }
  assert.equal(await calendar.isMarketOpen(dates[1]), false);
  assert.deepEqual(await settle(2), []);
  const legacy = (await db.query(`SELECT status,reason FROM market_orders WHERE session_id=$1 AND order_key LIKE 'legacy-%'`, [s.id])).rows;
  assert.ok(legacy.every(o => o.status === 'cancelled' && o.reason === 'stock_only'));
  assert.equal((await request(`/game/${s.id}/orders`)).body[0].status, 'pending');
  assert.equal((await request(`/game/${s.id}/trade`, { assetId: stock.asset_id, tradeType: 'buy', quantity: 1 })).status, 409);
  const [buy] = await settle(3);
  assert.equal(buy.status, 'filled');
  assert.equal(buy.filledQuantity, 2);
  assert.equal(buy.price, Number(stock.open_price));
  let portfolio = (await request(`/game/${s.id}/portfolio`)).body;
  assert.equal(portfolio.holdings.length, 1);
  assert.equal(portfolio.holdings[0].quantity, 2);
  assert.equal(portfolio.cash, 50000000 - execution.quoteTradeAmount('buy', buy.price, 2));
  assert.ok(Math.abs(portfolio.weights.cash + portfolio.weights.stock - 1) < 1e-10);
  const heldDashboard = (await request(`/game/${s.id}/portfolio/dashboard`)).body;
  assert.deepEqual(heldDashboard.allocation.map(row => row.key), ['cash', stock.asset_id]);
  assert.equal(heldDashboard.allocation[1].label, portfolio.holdings[0].name);
  assert.equal(heldDashboard.allocation[1].value, portfolio.holdings[0].value);
  assert.ok(Math.abs(heldDashboard.allocation.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-10);
  const { rows: sourceVolumes } = await db.query(
    'SELECT trade_date,volume FROM stock_price_detail WHERE asset_id=$1 AND trade_date BETWEEN $2 AND $3 ORDER BY trade_date',
    [stock.asset_id, dates[0], dates[3]]);
  const chart = (await request(`/assets/${stock.asset_id}/prices?from=${dates[0]}&to=${dates[3]}`)).body;
  assert.deepEqual(chart.map(row => ({ date: row.date, volume: row.volume })),
    sourceVolumes.map(row => ({ date: row.trade_date, volume: Number(row.volume) })));
  const sell = await request(`/game/${s.id}/trade`, { assetId: stock.asset_id, tradeType: 'sell', quantity: 2 });
  assert.equal(sell.status, 200);
  const [sold] = await settle(4);
  assert.equal(sold.status, 'filled');
  portfolio = (await request(`/game/${s.id}/portfolio`)).body;
  assert.deepEqual(portfolio.holdings, []);
  assert.equal(portfolio.cash, 50000000 - buy.amount + sold.amount);
  assert.ok((await request(`/game/${s.id}/orders`)).body.every(o => o.assetType === 'stock'));
  const dashboard = await request(`/game/${s.id}/portfolio/dashboard`);
  assert.deepEqual(dashboard.body.allocation.map(a => a.key), ['cash']);
});
