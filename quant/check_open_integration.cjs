// Explicit local PostgreSQL check. Every inserted fixture is rolled back.
// Usage: node quant/check_open_integration.cjs /absolute/path/to/v3/signals.json
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const dbPath=require.resolve('../server/src/db');
const realDb=require(dbPath);
process.env.QUANT_SIGNALS_FILE=process.argv[2];
if(!process.env.QUANT_SIGNALS_FILE)throw Error('A staged v3 signals.json path is required');
process.env.GAME_START_RANGE='2022-01-03..2022-01-03';

(async()=>{
 const client=await realDb.pool.connect();
 const checks=[];let savepoint=0;
 const originalRandom=Math.random;
 try {
  await client.query('BEGIN');
  require.cache[dbPath].exports={...realDb,query:(...a)=>client.query(...a),withTransaction:async fn=>{
   const name=`integration_${++savepoint}`;
   await client.query(`SAVEPOINT ${name}`);
   try{const result=await fn(client);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
   catch(e){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw e;}
  }};
  const orders=require('../server/src/services/orderService');
  const turns=require('../server/src/services/turnService');
  const game=require('../server/src/services/gameService');
  const quant=require('../server/src/services/quantService');
  const valuation=require('../server/src/services/valuationService');
  const sid=crypto.randomUUID();
  const prefix=`CHECK_${crypto.randomBytes(4).toString('hex')}`;
  const [a,b,c]=['A','B','C'].map(s=>`${prefix}_${s}`);
  await client.query(`INSERT INTO game_sessions(id,difficulty,start_date,cash,initial_cash,debt,debt_initial,monthly_living_cost)
   VALUES($1,'normal','2090-01-02',1000,1000,10000,10000,0)`,[sid]);
  const dates=['2090-01-02','2090-01-03','2090-01-04','2090-01-05'];
  for(const [i,date] of dates.entries())await client.query('INSERT INTO game_turns VALUES($1,$2,$3)',[sid,i+1,date]);
  for(const id of [a,b,c]){
   await client.query(`INSERT INTO assets(asset_id,asset_type,code,name,masked_name) VALUES($1,'stock',$1,$1,$1)`,[id]);
   for(const [i,date] of dates.entries()){
    if(i===1)continue; // Market holiday.
    await client.query('INSERT INTO asset_prices(asset_id,trade_date,close_price) VALUES($1,$2,$3)',[id,date,i===2?200:100]);
    await client.query('INSERT INTO stock_price_detail(asset_id,trade_date,open_price) VALUES($1,$2,$3)',[id,date,id===c&&i===2?null:i===2?125:100]);
   }
  }
  const submit=(id,side,qty,key)=>orders.submitOrder(sid,{assetId:id,tradeType:side,quantity:qty,orderKey:key});
  const queued=await submit(a,'buy',10,'idempotent');
  assert.equal(queued.status,'pending');assert.equal(queued.cash,1000);
  assert.equal((await submit(a,'buy',10,'idempotent')).orderId,queued.orderId);
  await assert.rejects(submit(a,'buy',9,'idempotent'),/식별자/);
  await assert.rejects(submit(b,'buy',1,'overbudget'),/예산/);
  assert.equal((await client.query('SELECT * FROM holdings WHERE session_id=$1',[sid])).rowCount,0);
  assert.equal((await client.query('SELECT * FROM trades WHERE session_id=$1',[sid])).rowCount,0);
  const cancelled=await orders.cancelOrder(sid,queued.orderId);assert.equal(cancelled.status,'cancelled');
  await assert.rejects(orders.cancelOrder(sid,queued.orderId),/대기 주문/);
  await submit(a,'buy',8,'fill');await submit(c,'buy',2,'missing_open');
  checks.push('pending cash/holdings unchanged; idempotence; oversubscription; cancellation');
  const session=(await client.query('SELECT * FROM game_sessions WHERE id=$1',[sid])).rows[0];
  session.current_turn=2;
  assert.deepEqual(await orders.settlePendingOrders(client,session,dates[1],false),[]);
  assert.equal((await orders.listOrders(sid)).filter(o=>o.status==='pending').length,2);
  session.current_turn=3;
  const fills=await orders.settlePendingOrders(client,session,dates[2],true);
  assert.equal(fills.find(o=>o.assetId===a).filledQuantity,6);
  assert.equal(fills.find(o=>o.assetId===a).price,125);
  assert.equal(fills.find(o=>o.assetId===c).reason,'no_open_price');
  assert.equal(session.cash,250);
  assert.equal(await valuation.computeTotalAsset(sid,client,{cash:session.cash,tradeDate:dates[2]}),1450);
  assert.deepEqual(await orders.settlePendingOrders(client,session,dates[2],true),[]);
  await client.query('UPDATE game_sessions SET current_turn=3,cash=$2 WHERE id=$1',[sid,session.cash]);
  await submit(a,'sell',6,'sell');await submit(b,'buy',7,'funded_by_sell');
  session.current_turn=4;
  const replacement=await orders.settlePendingOrders(client,session,dates[3],true);
  assert.deepEqual(replacement.map(o=>o.tradeType),['sell','buy']);
  assert.equal(session.cash,150);
  await client.query('UPDATE game_sessions SET current_turn=4,cash=$2 WHERE id=$1',[sid,session.cash]);
  await assert.rejects(submit(b,'sell',1,'last_turn'),/次|다음 개장일/);
  checks.push('holiday deferral; real open fills; gap budget; missing open; close valuation; once-only fills; sells first; last turn guard');

  // Bond/coin next-turn prices coexist with stock opens, including stock holidays.
  const mixedSid=crypto.randomUUID();
  const bond=prefix+'_BOND',coin=prefix+'_COIN',outside=prefix+'_OUT';
  await client.query(`INSERT INTO game_sessions(id,difficulty,start_date,cash,initial_cash,debt,debt_initial)
    VALUES($1,'normal',$2,1000,1000,10000,10000)`,[mixedSid,dates[0]]);
  for(const [i,date] of dates.entries())await client.query('INSERT INTO game_turns VALUES($1,$2,$3)',[mixedSid,i+1,date]);
  for(const [id,type,prices] of [[bond,'bond',[100,120,90,null]],[coin,'coin',[200,400,200,100]],[outside,'coin',[200,200,200,200]]]){
    await client.query(`INSERT INTO assets(asset_id,asset_type,code,name,masked_name) VALUES($1,$2,$1,$1,$1)`,[id,type]);
    for(const [i,price] of prices.entries())if(price!==null)await client.query('INSERT INTO asset_prices(asset_id,trade_date,close_price) VALUES($1,$2,$3)',[id,dates[i],price]);
  }
  await client.query("INSERT INTO session_coin_universe(session_id,asset_id,tier) VALUES($1,$2,'mega')",[mixedSid,coin]);
  const mixedSubmit=(id,side,qty,key)=>orders.submitOrder(mixedSid,{assetId:id,tradeType:side,quantity:qty,orderKey:key});
  await assert.rejects(mixedSubmit(bond,'buy',0.5,'fractional_bond'),/정수/);
  await assert.rejects(mixedSubmit(coin,'buy',0.000000001,'fractional_coin'),/8자리/);
  await assert.rejects(mixedSubmit(outside,'buy',0.1,'outside_coin'),/거래 가능한 코인/);
  const bondOrder=await mixedSubmit(bond,'buy',2,'bond_buy');
  assert.equal(bondOrder.executionRule,'next_turn_price');assert.equal(bondOrder.assetType,'bond');
  let coinOrder=await mixedSubmit(coin,'buy',0.5,'coin_cancel');
  assert.equal((await orders.cancelOrder(mixedSid,coinOrder.orderId)).executionRule,'next_turn_price');
  coinOrder=await mixedSubmit(coin,'buy',0.5,'coin_buy');
  assert.equal((await mixedSubmit(coin,'buy',0.5,'coin_buy')).orderId,coinOrder.orderId);
  await assert.rejects(mixedSubmit(coin,'buy',0.25,'coin_buy'),/식별자/);
  await mixedSubmit(a,'buy',2,'stock_buy');
  const mixed=(await client.query('SELECT * FROM game_sessions WHERE id=$1',[mixedSid])).rows[0];
  assert.equal(Number(mixed.cash),1000);
  assert.equal((await client.query('SELECT 1 FROM holdings WHERE session_id=$1',[mixedSid])).rowCount,0);
  assert.deepEqual(await orders.settlePendingOrders(client,mixed,dates[0],true),[]);
  mixed.current_turn=2;
  const holidayFills=await orders.settlePendingOrders(client,mixed,dates[1],false);
  assert.equal(holidayFills.length,2);
  assert.equal(holidayFills.find(o=>o.assetId===bond).price,120);
  assert.equal(holidayFills.find(o=>o.assetId===bond).filledQuantity,1);
  assert.equal(holidayFills.find(o=>o.assetId===coin).price,400);
  assert.equal(holidayFills.find(o=>o.assetId===coin).filledQuantity,0.25);
  assert.equal(mixed.cash,780);
  assert.equal((await orders.listOrders(mixedSid)).find(o=>o.assetId===a).status,'pending');
  await client.query('UPDATE game_sessions SET current_turn=2,cash=$2 WHERE id=$1',[mixedSid,mixed.cash]);
  await mixedSubmit(bond,'sell',1,'bond_sell');
  await mixedSubmit(coin,'sell',0.1,'coin_sell');
  mixed.current_turn=3;
  const laterFills=await orders.settlePendingOrders(client,mixed,dates[2],true);
  assert.equal(laterFills[0].assetType,'stock');assert.equal(laterFills[0].price,125);
  assert.equal(laterFills.find(o=>o.assetId===bond).price,90);
  assert.equal(laterFills.find(o=>o.assetId===coin).filledQuantity,0.1);
  assert.equal(mixed.cash,765);
  assert.deepEqual(await orders.settlePendingOrders(client,mixed,dates[2],true),[]);
  await client.query('UPDATE game_sessions SET current_turn=3,cash=$2 WHERE id=$1',[mixedSid,mixed.cash]);
  await mixedSubmit(bond,'buy',1,'bond_missing');await mixedSubmit(coin,'sell',0.15,'coin_sell_all');
  mixed.current_turn=4;
  const finalFills=await orders.settlePendingOrders(client,mixed,dates[3],true);
  assert.equal(finalFills.find(o=>o.assetId===bond).reason,'no_price');
  assert.equal(finalFills.find(o=>o.assetId===coin).filledQuantity,0.15);
  assert.equal(mixed.cash,780);
  assert.equal((await client.query('SELECT 1 FROM holdings WHERE session_id=$1 AND asset_id=$2',[mixedSid,coin])).rowCount,0);
  await client.query('UPDATE game_sessions SET current_turn=4,cash=$2 WHERE id=$1',[mixedSid,mixed.cash]);
  await assert.rejects(mixedSubmit(coin,'buy',0.1,'last_coin'),/다음 턴/);
  await assert.rejects(mixedSubmit(bond,'buy',1,'last_bond'),/다음 턴/);
  checks.push('bond/coin pending buys and sells; next-turn exact prices; fractions; cancellation; idempotence; coin universe; stock holiday coexistence; missing daily price; final turn guard');

  // A future daily-price sale cannot finance a purchase at that day's stock open.
  const phaseSid=crypto.randomUUID();
  await client.query(`INSERT INTO game_sessions(id,difficulty,start_date,current_turn,cash,initial_cash,debt,debt_initial)
    VALUES($1,'normal',$2,3,0,1000,10000,10000)`,[phaseSid,dates[0]]);
  for(const [i,date] of dates.entries())await client.query('INSERT INTO game_turns VALUES($1,$2,$3)',[phaseSid,i+1,date]);
  await client.query('INSERT INTO holdings(session_id,asset_id,quantity,avg_price) VALUES($1,$2,1,100)',[phaseSid,coin]);
  await orders.submitOrder(phaseSid,{assetId:coin,tradeType:'sell',quantity:1,orderKey:'legacy_coin_sell'}); // selling an old holding outside the universe is permitted.
  await assert.rejects(orders.submitOrder(phaseSid,{assetId:a,tradeType:'buy',quantity:1,orderKey:'early_buy'}),/예산/);
  await client.query(`INSERT INTO market_orders(session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget)
    VALUES($1,'player','old_early_buy',$2,'buy',3,$3,1,200,200)`,[phaseSid,a,dates[2]]);
  const phase={id:phaseSid,current_turn:4,cash:0};
  const phaseFills=await orders.settlePendingOrders(client,phase,dates[3],true);
  assert.equal(phaseFills[0].assetType,'stock');assert.equal(phaseFills[0].reason,'insufficient_cash');
  assert.equal(phaseFills[1].assetType,'coin');assert.equal(phaseFills[1].status,'filled');assert.equal(phase.cash,100);
  checks.push('stock open precedes daily-price sales; no future-sale financing; legacy coin holdings can be sold');

  // Real data/model and the full game turn orchestration; no modal read needed.
  Math.random=()=>0.999999;
  const started=await game.startGame('normal');
  const realSid=started.sessionId;
  const q0=(await client.query("SELECT * FROM market_orders WHERE session_id=$1 AND owner='quant'",[realSid])).rows;
  assert.equal(q0.length,10);assert.ok(q0.every(o=>o.status==='pending'));
  const first=q0[0];
  await orders.submitOrder(realSid,{assetId:first.asset_id,tradeType:'buy',quantity:Number(first.quantity),orderKey:'same_as_quant'});
  const realQuery=client.query.bind(client);
  client.query=(sql,...args)=>{
   if(sql.includes('INSERT INTO trades'))throw Error('injected execution failure');
   return realQuery(sql,...args);
  };
  await assert.rejects(turns.advanceTurn(realSid),/injected/);
  client.query=realQuery;
  assert.equal((await game.getSession(realSid)).current_turn,1);
  assert.equal((await orders.listOrders(realSid))[0].status,'pending');
  assert.equal((await client.query('SELECT * FROM holdings WHERE session_id=$1',[realSid])).rowCount,0);
  const next=await turns.advanceTurn(realSid);
  assert.equal(next.turnNumber,2);
  const playerFill=next.orderResults[0];
  const quantFill=(await client.query("SELECT * FROM market_orders WHERE session_id=$1 AND owner='quant' AND order_key=$2",[realSid,first.order_key])).rows[0];
  assert.equal(playerFill.price,Number(quantFill.execution_price));
  assert.equal(playerFill.filledQuantity,Number(quantFill.filled_quantity));
  assert.equal(playerFill.amount,Number(quantFill.amount));
  const q1=await quant.getQuantPortfolio(realSid);
  assert.equal(q1.executionRule,'next_market_open');assert.equal(q1.holdings.length,10);
  assert.deepEqual(q1,await quant.getQuantPortfolio(realSid));
  await assert.rejects(turns.getTurnData(realSid,3),/진행하지 않은/);
  checks.push('game start persists quant pending; full turn rollback; automatic quant execution without modal; identical player/quant fills; repeat-read invariance; future-turn block');
  const terminal=await game.getSession(realSid);terminal.debt=0;
  await game.evaluateEndCondition(client,terminal);
  assert.equal((await client.query("SELECT * FROM market_orders WHERE session_id=$1 AND status='pending'",[realSid])).rowCount,0);
  assert.equal((await quant.getQuantPortfolio(realSid)).pendingOrders.length,0);
  checks.push('terminal cancels both actors pending orders and displays none');
  console.log(JSON.stringify({status:'passed',checks,fixtures:'rolled back',example:{decision:first.decision_date,execution:quantFill.execution_date,open:playerFill.price,quantity:playerFill.filledQuantity}},null,2));
 }finally{
  Math.random=originalRandom;
  await client.query('ROLLBACK');client.release();await realDb.pool.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
