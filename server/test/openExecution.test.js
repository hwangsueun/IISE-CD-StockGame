const test=require('node:test');
const assert=require('node:assert/strict');
const {fillOpenOrder}=require('../src/services/executionService');
const {replayQuant,validateArtifact}=require('../src/services/quantReplay');

function fixture(){
 const dates=['2020-01-02','2020-01-03','2020-01-06'];
 return {initialCash:1000,totalTurns:240,assets:[{asset_id:'A',masked_name:'A',is_active:true},{asset_id:'B',masked_name:'B',is_active:true}],
  turns:dates.map((d,i)=>({turn_number:i+1,trade_date:d})),
  prices:dates.flatMap(d=>['A','B'].map(id=>({asset_id:id,trade_date:d,open_price:100,close_price:100}))),
  artifact:{schema_version:3,strategy:'topk_dropout',execution:'next_market_open',label_price:'open',rebalance_turns:1,n_drop:1,top_k:1,
   label_horizon:{unit:'market_sessions',value:1},models:[{id:'m',available_from:'2019-01-01',trained_through:'2018-12-31'}],
   sessions:Object.fromEntries(dates.map(d=>[d,{signal_date:d,model_id:'m',ranking:[['A',2,100],['B',1,100]]}]))}};
}

test('close-t creates pending orders and never same-day holdings',()=>{
 const x=fixture();x.turns=x.turns.slice(0,1);
 validateArtifact(x.artifact);
 const r=replayQuant(x);
 assert.equal(r.trades.length,0);assert.equal(r.holdings.length,0);assert.equal(r.cash,1000);
 assert.equal(r.pendingOrders[0].quantity,10);assert.equal(r.pendingOrders[0].decisionDate,'2020-01-02');
});
test('both actors use identical open fill; gap up clips quantity within prior cash budget; close only values holdings',()=>{
 const x=fixture();x.turns=x.turns.slice(0,2);
 const bar=x.prices.find(p=>p.asset_id==='A'&&p.trade_date==='2020-01-03');bar.open_price=125;bar.close_price=200;
 x.artifact.sessions['2020-01-03'].ranking[0][2]=200;
 const r=replayQuant(x);
 const player=fillOpenOrder({side:'buy',quantity:10,cashBudget:1000},{openPrice:125,cash:1000});
 assert.equal(r.trades[0].quantity,player.filledQuantity);assert.equal(r.trades[0].price,125);
 assert.equal(r.holdings[0].avgPrice,125);assert.equal(r.totalAsset,1600);assert.equal(r.orders[0].status,'partial');
});
test('future prices cannot alter a pending decision; execution-day close cannot alter its open fill',()=>{
 const x=fixture(),prefix={...x,turns:x.turns.slice(0,1)};
 const r=replayQuant(prefix);
 x.prices.filter(p=>p.trade_date>'2020-01-02').forEach(p=>{p.open_price=900;p.close_price=999;});
 assert.deepEqual(replayQuant(prefix),r);
 const before=fillOpenOrder(r.pendingOrders[0],{openPrice:900,cash:1000});
 assert.equal(before.filledQuantity,1);
});
test('holiday defers a queued order; missing individual open rejects without using close as fill',()=>{
 const x=fixture();x.prices=x.prices.filter(p=>p.trade_date!=='2020-01-03');
 let r=replayQuant({...x,turns:x.turns.slice(0,2)});assert.equal(r.trades.length,0);assert.equal(r.pendingOrders.length,1);
 r=replayQuant(x);assert.equal(r.trades[0].turn,3);assert.equal(r.trades[0].decisionTurn,1);
 x.prices.find(p=>p.asset_id==='A'&&p.trade_date==='2020-01-06').open_price=null;
 r=replayQuant(x);assert.equal(r.trades.length,0);assert.equal(r.orders[0].status,'rejected');assert.equal(r.cash,1000);
});
test('rank changes after close queue a replacement for the next open, at most one held name',()=>{
 const x=fixture();x.artifact.sessions['2020-01-03'].ranking=[['B',3,100],['A',1,100]];
 const middle=replayQuant({...x,turns:x.turns.slice(0,2)});
 assert.equal(middle.holdings[0].assetId,'A');
 assert.deepEqual(middle.pendingOrders.map(o=>[o.side,o.assetId]),[['sell','A'],['buy','B']]);
 const r=replayQuant(x);assert.equal(r.holdings[0].assetId,'B');
 assert.deepEqual(r.trades.filter(t=>t.turn===3).map(t=>t.side),['sell','buy']);
 assert.deepEqual(r,replayQuant(x));
});
test('last turn fills prior orders but cannot queue an order beyond game end',()=>{
 const x=fixture();x.totalTurns=2;x.turns=x.turns.slice(0,2);
 const r=replayQuant(x);assert.equal(r.trades.length,1);assert.equal(r.pendingOrders.length,0);
});
test('a stock above the available allocation creates no zero-share order',()=>{
 const x=fixture();x.initialCash=50;x.turns=x.turns.slice(0,1);
 const r=replayQuant(x);assert.equal(r.pendingOrders.length,0);assert.equal(r.cash,50);
});
