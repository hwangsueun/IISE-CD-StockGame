// Offline audit. Shared game planner, execution, rounding and cash-flow accounting.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const C = require('../../server/src/config/constants');
const {planOrders} = require('../../server/src/services/quantOpenReplay');
const {replayQuant} = require('../../server/src/services/quantReplay');
const {quoteTradeAmount, fillOpenOrder} = require('../../server/src/services/executionService');
const {investmentReturn, applyFlow} = require('../../server/src/services/challengePerformance');

const out = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Usage: node run_user_feasibility.cjs EXPERIMENT_DIR');
if (fs.existsSync(path.join(out,'results.json'))) throw Error('Results already exist; never overwrite a completed run.');
const read = name => JSON.parse(fs.readFileSync(path.join(out,name)));
const write = (name,value) => fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const input = read('input.json'), plan = read('plan.json'), protectedFiles = read('input_hashes.json');
const assets = new Map(input.assets.map(a=>[a.asset_id,a]));
const ids = input.assets.map(a=>a.asset_id);
const market = new Map(input.market.map((d,i)=>[d.date,{...d,index:i,
  bars:new Map(d.bars.map(([j,open,close])=>[ids[j],{open,close}])),
  eligible:d.eligible.map(j=>ids[j])}]));
const signalRanks = new Map();
for(const [name,days] of Object.entries(input.signals)){
  signalRanks.set(name,days.map((scores,i)=>scores.map((score,j)=>[ids[j],score])
    .filter(([,score])=>Number.isFinite(score)).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .map(([id,score])=>[id,score,market.get(input.market[i].date).bars.get(id)?.close])));
}
const empty = {bars:new Map(),eligible:[],gate:false,index:-1};
const median = xs => {const a=[...xs].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const active = (id,date,bars) => {
  const a=assets.get(id),p=bars.get(id);
  return a&&a.is_active!==false&&p?.open>0&&p?.close>0&&
    (!a.listed_from||date>=a.listed_from)&&(!a.listed_to||date<=a.listed_to);
};
function sellOrder(id,holdings,bars,turn,date,reason){
  return {assetId:id,side:'sell',quantity:holdings.get(id).quantity,
    decisionTurn:turn,decisionDate:date,cashBudget:0,reason};
}
function simulate(config,window,fee=0,initialCash=50000000,cashflow=false,trace=false){
  C.TRADE_FEE_RATE=fee; // Only this standalone process; never changes a game service.
  const holdings=new Map(),lastPrices=new Map();
  let cash=initialCash,pending=[],trades=0,rejected=0,partial=0,turnover=0,exposure=0;
  let twr={reference_asset:initialCash,performance_factor:1,invalid_period:false};
  let debt=cashflow?C.DEBT_BY_DIFFICULTY.normal:0,flows=0,missed=0,paid=0,peak=1,mdd=0;
  const due=Math.ceil(C.DEBT_BY_DIFFICULTY.normal/C.REPAYMENT_MONTHS);
  const months=[],history=[],events=[];
  let priorMonth=1,lastLevel=1;
  const value=()=>cash+[...holdings].reduce((s,[id,h])=>s+h.quantity*(lastPrices.get(id)||h.avgPrice),0);
  const flow=amount=>{
    const next=applyFlow(twr,value(),amount);
    twr={reference_asset:next.reference,performance_factor:next.factor,invalid_period:next.invalid};
    cash+=amount;flows+=amount;
  };
  for(let i=0;i<window.dates.length;i++){
    const turn=i+1,date=window.dates[i],day=market.get(date)||empty,bars=day.bars;
    for(const [id,h] of holdings){
      if(assets.get(id)?.listed_to&&date>assets.get(id).listed_to){
        const price=lastPrices.get(id)||h.avgPrice;
        cash+=quoteTradeAmount('sell',price,h.quantity);holdings.delete(id);trades++;
      }
    }
    if(bars.size&&pending.length){
      const before=value();
      for(const order of pending.sort((a,b)=>Number(a.side==='buy')-Number(b.side==='buy')||a.assetId.localeCompare(b.assetId))){
        assert(order.decisionTurn<turn,'Same-turn close-to-open leakage');
        const h=holdings.get(order.assetId),a=assets.get(order.assetId);
        const listed=a&&(!a.listed_from||date>=a.listed_from)&&(!a.listed_to||date<=a.listed_to);
        const fill=fillOpenOrder(order,{openPrice:listed?bars.get(order.assetId)?.open:NaN,
          cash,heldQuantity:h?.quantity||0,avgPrice:h?.avgPrice||0});
        if(fill.status==='rejected')rejected++;
        if(fill.status==='partial')partial++;
        if(fill.filledQuantity){
          const quantity=(h?.quantity||0)+(order.side==='buy'?fill.filledQuantity:-fill.filledQuantity);
          assert(quantity>=0&&Number.isSafeInteger(quantity));
          if(quantity===0)holdings.delete(order.assetId);
          else holdings.set(order.assetId,{quantity,avgPrice:order.side==='buy'?
            ((h?.quantity||0)*(h?.avgPrice||0)+fill.filledQuantity*fill.price)/quantity:h.avgPrice});
          cash+=order.side==='buy'?-fill.amount:fill.amount;
          assert(cash>=0,'Negative cash');
          trades++;turnover+=fill.amount/Math.max(before,1)/2;
          if(trace)events.push({turn,date,side:order.side,assetId:order.assetId,quantity:fill.filledQuantity,
            price:fill.price,amount:fill.amount,decisionTurn:order.decisionTurn});
        }
      }
      pending=[];
    }
    for(const [id,p] of bars)if(p.close>0)lastPrices.set(id,p.close);
    if(cashflow&&turn>1&&turn%20===1)flow(C.MONTHLY_SALARY-C.LIVING_COST_DEFAULT);
    // Month-end returns are captured before repayment, just as challenge scoring.
    let rate=investmentReturn(twr,value());
    // A withdrawal that exhausts the account makes TWR undefined, not -100%.
    lastLevel=rate===null?null:1+rate;
    if(lastLevel!==null){peak=Math.max(peak,lastLevel);mdd=Math.min(mdd,lastLevel/peak-1);}
    if(turn%20===0){
      months.push(priorMonth>0&&lastLevel!==null?lastLevel/priorMonth-1:null);priorMonth=lastLevel;
      if(cashflow&&debt>0){
        const required=Math.min(debt,due),payment=Math.min(cash,required);
        if(payment<required)missed++;
        flow(-payment);debt-=payment;paid+=payment;
      }
    }
    const totalAsset=value();
    exposure+=totalAsset>0?(totalAsset-cash)/totalAsset:0;
    if(trace)history.push({turn,date,totalAsset,cash,twr:lastLevel===null?null:lastLevel-1});
    if(!bars.size||turn===window.dates.length)continue;
    const reserve=cashflow?Math.min(debt,due):0;
    const availableCash=cash-reserve;
    const ranking=config.signal?signalRanks.get(config.signal)[day.index]:[];
    if(cashflow&&debt>0&&cash<reserve&&(20-turn%20)%20<=3){
      let estimated=cash;
      const scores=new Map(ranking.map(([id,s])=>[id,s]));
      const held=[...holdings.keys()].sort((a,b)=>(scores.get(a)??-Infinity)-(scores.get(b)??-Infinity)||a.localeCompare(b));
      pending=[];
      for(const id of held){
        if(estimated>=reserve)break;
        if(!active(id,date,bars))continue;
        pending.push(sellOrder(id,holdings,bars,turn,date,'repayment_reserve'));
        estimated+=quoteTradeAmount('sell',bars.get(id).close,holdings.get(id).quantity);
      }
    }else if(config.gate&&!day.gate){
      pending=[...holdings.keys()].filter(id=>active(id,date,bars)).map(id=>sellOrder(id,holdings,bars,turn,date,'market_gate'));
    }else if(config.kind==='hold'){
      const equal=day.eligible.map(id=>[id,0,bars.get(id)?.close]);
      pending=planOrders({ranking:equal,holdings,cash:availableCash,bars,assets,topK:ids.length,nDrop:1,turn,date});
    }else if(config.kind!=='cash'&&(turn-1)%(config.interval||1)===0){
      pending=planOrders({ranking,holdings,cash:availableCash,bars,assets,topK:10,nDrop:config.nDrop,turn,date});
    }
  }
  const actual=window.dates.map(d=>market.get(d)).filter(d=>d?.indexOpen>0&&d?.indexClose>0);
  const benchmarkReturn=actual.length>1?actual.at(-1).indexClose/actual[1].indexOpen-1:null;
  const result={strategy:config.id,kind:config.kind,signal:config.signal||null,policy:config.policy||null,
    window:window.id,year:window.year,cohort:window.cohort,primary:window.primary,start:window.dates[0],end:window.dates.at(-1),
    initialCash,fee,cashflow,netReturn:lastLevel===null||twr.invalid_period?null:lastLevel-1,
    mdd:twr.invalid_period?null:mdd,trades,rejectedOrders:rejected,partialOrders:partial,
    turnover,averageExposure:exposure/window.dates.length,finalAsset:value(),cash,investmentPnl:value()-initialCash-flows,
    netExternalFlows:flows,remainingDebt:debt,paidDebt:paid,missedPayments:missed,monthlyReturns:months,
    kospiReturn:benchmarkReturn,invalidPerformance:twr.invalid_period};
  if(trace){result.history=history;result.events=events;}
  return result;
}

const sourceChecks={runner_sha256:hash(__filename),plan_sha256:hash(path.join(out,'plan.json')),
  input_sha256:hash(path.join(out,'input.json')),
  execution_sha256:hash(path.resolve(__dirname,'../../server/src/services/executionService.js')),
  planner_sha256:hash(path.resolve(__dirname,'../../server/src/services/quantOpenReplay.js'))};
write('run_sources.json',sourceChecks);
write('STATUS.json',{status:'running',phase:'execution_parity',scope:plan.scope});
const savedInputPath=Object.keys(protectedFiles).find(p=>p.endsWith('/backtest_input.json'));
const savedInput=JSON.parse(fs.readFileSync(savedInputPath));
const savedResult=JSON.parse(fs.readFileSync(path.join(path.dirname(savedInputPath),'backtest.json')));
C.TRADE_FEE_RATE=0;
const replayed=replayQuant({...savedInput,artifact:savedInput.strategies.frozen_alpha158});
assert.equal(replayed.totalAsset,savedResult.results.frozen_alpha158.final_asset);
assert.equal(replayed.cash,savedResult.results.frozen_alpha158.cash);
assert.equal(replayed.trades.length,savedResult.results.frozen_alpha158.trades);
const quantArtifact=JSON.parse(fs.readFileSync(path.join(path.dirname(savedInputPath),'signals.json')));
const quantConfig=input.controls.find(c=>c.id==='quant_daily');
const parity=[];
for(const year of [2014,2020,2023])for(const fee of [0,.001])for(const initialCash of [10000000,50000000]){
  const window=input.windows.find(w=>w.primary&&w.year===year);
  const prices=window.dates.flatMap(date=>[...(market.get(date)?.bars||[])].map(([id,p])=>({
    asset_id:id,trade_date:date,open_price:p.open,close_price:p.close})));
  C.TRADE_FEE_RATE=fee;
  const runtime=replayQuant({turns:window.dates.map((d,i)=>({turn_number:i+1,trade_date:d})),prices,
    assets:input.assets,artifact:quantArtifact,initialCash,totalTurns:240});
  const offline=simulate(quantConfig,window,fee,initialCash,false,true);
  assert.deepEqual(offline.history.map(h=>[h.totalAsset,h.cash]),runtime.history.map(h=>[h.totalAsset,h.cash]));
  assert.equal(offline.trades,runtime.trades.length);
  parity.push({year,fee,initialCash,matchedTurns:runtime.history.length});
}
// Mutate only future market bars: all earlier trades and valuations must remain identical.
const fixture=input.windows.find(w=>w.primary&&w.year===2020);
const originalTrace=simulate(quantConfig,fixture,0,50000000,false,true);
const tail=fixture.dates.slice(120).filter(d=>market.has(d)).map(d=>[d,market.get(d)]);
for(const [date,day] of tail)market.set(date,{...day,bars:new Map([...day.bars].map(([id,p])=>[id,{open:p.open*2,close:p.close*2}]))});
const changedTrace=simulate(quantConfig,fixture,0,50000000,false,true);
for(const [date,day] of tail)market.set(date,day);
assert.deepEqual(originalTrace.history.slice(0,120),changedTrace.history.slice(0,120));
assert.deepEqual(originalTrace.events.filter(e=>e.turn<=120),changedTrace.events.filter(e=>e.turn<=120));
write('execution_checks.json',{saved_frozen_baseline_exact_replay:true,parity,
  future_price_perturbation_preserves_prior_history:true,assert_nonnegative_cash_and_integer_positions:true});
console.log('Exact saved baseline and 12 runtime parity scenarios passed.');

const results=[],cache=new Map();
function run(config,window,fee,capital=50000000,cashflow=false){
  const key=JSON.stringify([config.id,window.id,fee,capital,cashflow]);
  if(cache.has(key))return cache.get(key);
  const r=simulate(config,window,fee,capital,cashflow);cache.set(key,r);results.push(r);return r;
}
for(const config of input.candidates)for(const window of input.windows.filter(w=>w.primary&&w.cohort==='development'))
  run(config,window,.001);
const leaderboard=input.candidates.map(config=>{
  const r=results.filter(r=>r.strategy===config.id&&r.primary&&r.cohort==='development'&&r.fee===.001);
  return {config,medianReturn:median(r.map(r=>r.netReturn)),medianMdd:median(r.map(r=>r.mdd))};
}).sort((a,b)=>b.medianReturn-a.medianReturn||b.medianMdd-a.medianMdd||a.config.id.localeCompare(b.config.id));
const selected=leaderboard.slice(0,2).map(r=>r.config);
if(fs.existsSync(path.join(out,'selection.json')))
  assert.deepEqual(selected,read('selection.json').selected,'A retry must not change locked selections');
write('selection.json',{rule:plan.selection.top_two,development_leaderboard:leaderboard,selected,
  locked_before_evaluation_at:new Date().toISOString()});
console.log('Development-only selection locked:',selected.map(c=>c.id).join(', '));
write('STATUS.json',{status:'running',phase:'bounded_comparisons',selected:selected.map(c=>c.id),scope:plan.scope});
for(const config of [...input.candidates,...input.controls]){
  for(const window of input.windows)for(const fee of [0,.001])run(config,window,fee);
  console.log('Evaluated',config.id);
}
const neighbors=[];
for(const config of selected){
  for(const signal of plan.robustness.neighbors_of_selected_only[config.signal]){
    const neighbor={...config,id:`${config.id}__neighbor_${signal}`,signal,kind:'neighbor'};
    neighbors.push(neighbor);
    for(const window of input.windows)run(neighbor,window,.001);
  }
  for(const window of input.windows.filter(w=>w.primary)){
    for(const capital of plan.cost_and_capital.selected_capital_checks)run(config,window,.001,capital);
    run(config,window,.002);
    for(const fee of [0,.001])run(config,window,fee,50000000,true);
  }
}
const traces=[];
for(const config of selected)for(const window of input.windows.filter(w=>w.primary&&w.year>=2019))
  traces.push(simulate(config,window,.001,50000000,false,true));
// Cash-only external flows must never masquerade as investment return.
const flowControl=simulate({id:'flow_control',kind:'cash'},fixture,0,100000000,true,true);
assert(Math.abs(flowControl.netReturn)<1e-12);
assert(Math.abs(flowControl.investmentPnl)<1e-6);
const exhaustedControl=simulate({id:'exhausted_flow_control',kind:'cash'},fixture,0,50000000,true,true);
assert.equal(exhaustedControl.netReturn,null);
assert.equal(exhaustedControl.invalidPerformance,true);
assert(Math.abs(exhaustedControl.investmentPnl)<1e-6);
for(const [file,sha] of Object.entries(protectedFiles))assert.equal(hash(file),sha,'Protected input changed: '+file);
write('results.json',{scope:plan.scope,rows:results,selected,neighbors});
write('selected_traces.json',traces);
write('cashflow_control.json',flowControl);
write('exhausted_cashflow_control.json',exhaustedControl);
write('final_checks.json',{protected_inputs_unchanged:true,cash_only_twr_zero:true,cash_only_investment_pnl_zero:true,
  account_exhausted_by_withdrawals_is_undefined_not_investment_loss:true,
  result_rows:results.length,source_checks:sourceChecks,completed_at:new Date().toISOString()});
write('STATUS.json',{status:'running',phase:'comparisons_complete_report_pending',scope:plan.scope,
  result_rows:results.length,selected:selected.map(c=>c.id)});
console.log(JSON.stringify({rows:results.length,selected:selected.map(c=>c.id),checks:'passed'}));
