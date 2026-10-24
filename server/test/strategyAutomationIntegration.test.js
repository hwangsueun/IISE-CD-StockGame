const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('real account automation: ownership, pending orders, next-open execution, constraints and disabling',{
 skip:process.env.USER_STRATEGY_INTEGRATION!=='1',timeout:120000,
},async t=>{
 require('dotenv').config();assert.equal(new URL(process.env.DATABASE_URL).pathname,'/antsurvival_challenge_20261019');
 const db=require('../src/db'),S=require('../src/services/userStrategyService'),A=require('../src/services/strategyAutomation'),O=require('../src/services/orderService'),E=require('../src/strategy/engine');
 const dates=E.weekdays('2020-01-02','2021-02-01').slice(0,240),ids=[];
 t.after(async()=>{for(const id of ids)await db.query('DELETE FROM game_sessions WHERE id=$1',[id]);await db.pool.end();});
 async function create(cash){const {rows:[s]}=await db.query(`INSERT INTO game_sessions(difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost,stress,trust) VALUES('normal',$1,$2,$2,100000000,100000000,800000,0,100) RETURNING *`,[dates[0],cash]);ids.push(s.id);await require('../src/services/turnSelector').createGameTurns(db,s.id,dates);return s;}
 const s=await create(10000000),other=await create(50000000);
 const {rows:panel}=await db.query(`SELECT p.asset_id FROM asset_prices p JOIN assets a USING(asset_id) WHERE p.trade_date BETWEEN '2016-01-01' AND '2020-01-02' AND a.asset_type='stock' AND a.is_active=TRUE GROUP BY p.asset_id HAVING COUNT(*)>950 ORDER BY p.asset_id LIMIT 3`);
 const config={...require('../src/strategy/catalog').template('hypothesis-axis'),riskModel:'dcc',riskAssets:panel.map(r=>r.asset_id),trainYears:3,rebalanceTurns:1};
 const version=await S.save(s.id,{config,requestKey:randomUUID()});
 await assert.rejects(A.configure(other.id,{enabled:true,versionId:version.id}),/이 게임/);
 await A.configure(s.id,{enabled:true,versionId:version.id});
 assert.equal((await S.workspace(s.id)).automation.enabled,true);
 async function sync(){return db.withTransaction(async c=>{const {rows:[current]}=await c.query('SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE',[s.id]);return A.sync(c,current);});}
 const observed=await S.observe(s.id,version.id);
 const first=await sync();assert.ok(first.orderCount>0);
 const pending=await O.listOrders(s.id);assert.ok(pending.every(o=>o.strategyVersionId===version.id));assert.ok(pending.reduce((v,o)=>v+o.cashBudget,0)<=Number(s.cash));
 assert.equal(await sync(),null);assert.equal((await O.listOrders(s.id)).length,pending.length);
 // A manual order is independently retained when automatic orders are disabled.
 const {rows:[asset]}=await db.query(`SELECT p.asset_id,p.close_price FROM asset_prices p JOIN assets a USING(asset_id) WHERE p.trade_date=$1 AND a.asset_type='stock' AND p.asset_id<>ALL($2::text[]) LIMIT 1`,[dates[0],pending.map(o=>o.assetId)]);
 await db.query(`INSERT INTO market_orders(session_id,owner,order_key,asset_id,side,decision_turn,decision_date,quantity,reference_price,cash_budget) VALUES($1,'player','manual-test',$2,'buy',1,$3,1,$4,$4)`,[s.id,asset.asset_id,dates[0],asset.close_price]);
 const before=await db.query('SELECT cash FROM game_sessions WHERE id=$1',[s.id]);
 await A.configure(s.id,{enabled:false});assert.equal((await A.state(s.id)).enabled,false);
 const stopped=await O.listOrders(s.id);assert.ok(stopped.filter(o=>o.strategyVersionId).every(o=>o.status==='cancelled'));const manual=stopped.find(o=>!o.strategyVersionId);assert.equal(manual.status,'pending');
 assert.deepEqual((await db.query('SELECT cash FROM game_sessions WHERE id=$1',[s.id])).rows,before.rows);
 await O.cancelOrder(s.id,manual.orderId);
 // Resume at a fresh turn, then use the actual turn orchestrator and settlement.
 await db.query('UPDATE game_sessions SET current_turn=2 WHERE id=$1',[s.id]);
 await A.configure(s.id,{enabled:true,versionId:version.id});
 const result=await require('../src/services/turnService').advanceTurn(s.id);
 assert.equal(result.turnNumber,3);assert.ok(result.modelAutomation.orderCount>0);assert.ok(result.orderResults.some(o=>o.strategyVersionId===version.id && o.filledQuantity>0));
 const later=await S.observe(s.id,version.id);assert.deepEqual(later.model,observed.model);assert.deepEqual(later.riskModel,observed.riskModel);
 const {rows:held}=await db.query('SELECT * FROM holdings WHERE session_id=$1',[s.id]);assert.ok(held.length>0);assert.ok(held.every(h=>Number.isInteger(Number(h.quantity))));assert.ok(result.state.cash>=0);
 await A.configure(s.id,{enabled:false});assert.deepEqual((await db.query('SELECT * FROM holdings WHERE session_id=$1',[s.id])).rows,held);
 await A.configure(s.id,{enabled:true,versionId:version.id});
 await db.query('UPDATE game_sessions SET side_job_turn=current_turn WHERE id=$1',[s.id]);
 assert.equal((await sync()).pauseCode,'side_job');
 await db.query('UPDATE game_sessions SET current_turn=4,side_job_turn=0,action_locked_until_turn=5 WHERE id=$1',[s.id]);
 assert.equal((await sync()).pauseCode,'hospitalized');
 await db.query('UPDATE game_sessions SET current_turn=6,action_locked_until_turn=0 WHERE id=$1',[s.id]);
 const bad=await S.save(s.id,{config,requestKey:randomUUID()});await A.configure(s.id,{enabled:true,versionId:bad.id});
 await db.query("UPDATE user_strategy_versions SET source_hash='test-mismatch' WHERE id=$1",[bad.id]);
 const rejected=await sync();assert.equal(rejected.status,'error');assert.match(rejected.reason,/가격 자료/);
 assert.equal((await O.listOrders(s.id)).filter(o=>o.status==='pending').length,0);
 await db.withTransaction(c=>O.cancelAtEnd(c,s.id));assert.equal((await A.state(s.id)).enabled,false);
 assert.equal((await A.state(other.id)).enabled,false);
 console.log('Independent test sessions: automatic orders settled; cancellation, manual orders, ownership, locked turns and stale source checks passed.');
});
