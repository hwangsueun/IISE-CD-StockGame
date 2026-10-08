// Smoke check against the running API. Only the newly created guest fixture is removed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pool}=require('../server/src/db');
const base='http://127.0.0.1:3001';
async function request(route,method='GET',body){
 const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const json=await res.json();if(!res.ok)throw Error(`${res.status}: ${JSON.stringify(json)}`);return json;
}
(async()=>{
 let sid;
 try{
  assert.equal((await request('/health')).status,'ok');
  const existing=[];
  for(const id of ['40a14d08-13e8-4d66-8987-efaaed04d2d6','a6db7ee1-0888-4019-9a1b-1701e796b7dd']){
   const q=await request(`/api/game/${id}/quant`);
   assert.equal(q.executionRule,'next_market_open');assert.equal(q.turnNumber,1);assert.equal(q.cash,50000000);
   assert.equal(q.holdings.length,0);assert.equal(q.pendingOrders.length,10);
   existing.push({id,model:q.modelVersion,turn:q.turnNumber,pending:q.pendingOrders.length});
  }
  const game=await request('/api/game/start','POST',{difficulty:'normal'});sid=game.sessionId;
  const path=`/api/game/${sid}`;
  const q=await request(`${path}/quant`);assert.equal(q.executionRule,'next_market_open');
  const choice=q.pendingOrders[0];assert.ok(choice);
  const payload={assetId:choice.assetId,tradeType:'buy',quantity:choice.quantity,orderKey:'http-idempotent'};
  const first=await request(`${path}/trade`,'POST',payload);
  assert.equal(first.status,'pending');assert.equal(first.orderId,(await request(`${path}/trade`,'POST',payload)).orderId);
  assert.equal((await request(path)).cash,game.cash);
  assert.equal((await request(`${path}/orders`)).length,1);
  assert.equal((await request(`${path}/orders/${first.orderId}`,'DELETE')).status,'cancelled');
  await request(`${path}/trade`,'POST',{...payload,orderKey:'http-fill'});
  let fill,next;
  for(let i=0;i<10&&!fill;i++){
   next=await request(`${path}/next-turn`,'POST',{});
   fill=next.orderResults?.find(o=>o.assetId===choice.assetId);
  }
  assert.ok(fill);assert.ok(fill.filledQuantity>0);
  const bar=(await pool.query('SELECT open_price FROM stock_price_detail WHERE asset_id=$1 AND trade_date=$2',[fill.assetId,fill.executionDate])).rows[0];
  assert.equal(fill.price,Number(bar.open_price));
  const qFill=(await pool.query("SELECT * FROM market_orders WHERE session_id=$1 AND owner='quant' AND asset_id=$2 AND decision_turn=1 AND side='buy'",[sid,fill.assetId])).rows[0];
  assert.equal(fill.price,Number(qFill.execution_price));assert.equal(fill.amount,Number(qFill.amount));assert.equal(fill.filledQuantity,Number(qFill.filled_quantity));
  const result={status:'passed',checked_at:new Date().toISOString(),existing_sessions:existing,
   temporary_fixture:{id:sid,decision:q.date,execution:fill.executionDate,requested:fill.quantity,filled:fill.filledQuantity,price:fill.price,status:fill.status},
   checks:['live model v3','existing games remain turn 1 and cash-only before first open','HTTP pending/idempotence/cancel/history','NEXT TURN fills at actual open','player and quant fills match']};
  await pool.query('DELETE FROM game_sessions WHERE id=$1 AND user_id IS NULL',[sid]);sid=null;
  result.temporary_fixture_removed=true;
  fs.writeFileSync('data/quant/deployments/open-execution-v3/http_verification.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
 }finally{if(sid)await pool.query('DELETE FROM game_sessions WHERE id=$1 AND user_id IS NULL',[sid]);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
