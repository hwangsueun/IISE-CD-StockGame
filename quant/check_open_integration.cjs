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
  await assert.rejects(submit('BOND_KTB3Y','buy',1,'bond'),/시가/);
  assert.equal((await client.query('SELECT * FROM holdings WHERE session_id=$1',[sid])).rowCount,0);
  assert.equal((await client.query('SELECT * FROM trades WHERE session_id=$1',[sid])).rowCount,0);
  const cancelled=await orders.cancelOrder(sid,queued.orderId);assert.equal(cancelled.status,'cancelled');
  await assert.rejects(orders.cancelOrder(sid,queued.orderId),/대기 주문/);
  await submit(a,'buy',8,'fill');await submit(c,'buy',2,'missing_open');
  checks.push('pending cash/holdings unchanged; idempotence; oversubscription; bond block; cancellation');
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
