// Read existing games; trade only in a new disposable guest fixture.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {pool}=require('../server/src/db');
const dataVersion='quant-v2-adjusted-2e6c8d6558fc-r2';
const output='data/quant/deployments/20261006-adjusted/live-verification.json';
async function request(route,method='GET',body){
 const r=await fetch('http://127.0.0.1:3001'+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const json=await r.json();if(!r.ok)throw Error(`${r.status} ${JSON.stringify(json)}`);return json;
}
(async()=>{
 let sid;
 try{
  assert.equal((await request('/health')).db,'up');
  const existing=(await pool.query('SELECT id,current_turn,cash FROM game_sessions ORDER BY id')).rows;
  const summaries=[];
  for(const s of existing){
   const q=await request(`/api/game/${s.id}/quant`);
   assert.equal(q.dataVersion,dataVersion);assert.ok(q.priceBasis.startsWith('adjusted'));assert.equal(q.executionRule,'next_market_open');
   assert.equal(q.turnNumber,s.current_turn);
   const state=await request(`/api/game/${s.id}`);assert.equal(state.cash,Number(s.cash));assert.equal(state.currentTurn,s.current_turn);
   summaries.push({id:s.id,turn:q.turnNumber,cash:state.cash,model:q.modelVersion,quantHoldings:q.holdings.length,pending:q.pendingOrders.length});
  }
  const example=await request('/api/assets/STOCK_035420?date=2018-04-27');
  const {rows:[bar]}=await pool.query("SELECT * FROM stock_price_detail WHERE asset_id='STOCK_035420' AND trade_date='2018-04-27'");
  assert.equal(example.price,Number(bar.close_price));assert.equal(example.price,143200);
  assert.ok(Math.abs(Number(example.info.priceDetail.adjustment_factor)-.2)<1e-10);
  const started=await request('/api/game/start','POST',{difficulty:'normal'});sid=started.sessionId;
  const route=`/api/game/${sid}`;const initial=await request(`${route}/quant`);assert.equal(initial.holdings.length,0);
  assert.equal(initial.dataVersion,dataVersion);
  const o=initial.pendingOrders.find(o=>o.quantity>=20)||initial.pendingOrders[0];assert.ok(o);
  const payload={assetId:o.assetId,tradeType:'buy',quantity:o.quantity,orderKey:'adjusted-http-check'};
  const queued=await request(`${route}/trade`,'POST',payload);assert.equal(queued.status,'pending');
  assert.equal((await request(`${route}/trade`,'POST',payload)).orderId,queued.orderId);
  assert.equal((await request(route)).cash,started.cash);
  let fill;
  for(let n=0;n<10&&!fill;n++)fill=(await request(`${route}/next-turn`,'POST',{})).orderResults?.find(r=>r.orderId===queued.orderId);
  assert.ok(fill&&fill.filledQuantity>0);
  const {rows:[actual]}=await pool.query('SELECT open_price FROM stock_price_detail WHERE asset_id=$1 AND trade_date=$2',[o.assetId,fill.executionDate]);
  assert.equal(fill.price,Number(actual.open_price));
  const {rows:[quant]}=await pool.query("SELECT * FROM market_orders WHERE session_id=$1 AND owner='quant' AND order_key=$2",[sid,o.orderKey]);
  assert.equal(fill.price,Number(quant.execution_price));assert.equal(fill.amount,Number(quant.amount));assert.equal(fill.filledQuantity,Number(quant.filled_quantity));
  const history=await request(`${route}/orders`);assert.equal(history[0].status,fill.status);
  await pool.query('DELETE FROM game_sessions WHERE id=$1 AND user_id IS NULL',[sid]);sid=null;
  const result={status:'passed',checked_at:new Date().toISOString(),dataVersion,existing_sessions:summaries,
   adjusted_price_example:{assetId:'STOCK_035420',date:'2018-04-27',close:example.price,factor:Number(bar.adjustment_factor)},
   fill:{decision:initial.date,execution:fill.executionDate,price:fill.price,quantity:fill.filledQuantity,amount:fill.amount},
   checks:['current model and adjusted price basis exposed','existing player cash and turn preserved','split-adjusted price served',
           'new game uses adjusted model','pending and idempotent requests','player/quant share next adjusted open','order history'],temporary_fixture_removed:true};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
 }finally{if(sid)await pool.query('DELETE FROM game_sessions WHERE id=$1 AND user_id IS NULL',[sid]);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
