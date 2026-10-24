const test=require('node:test'),assert=require('node:assert/strict');
require('dotenv').config();
const E=require('../src/strategy/engine'),R=require('../src/strategy/risk'),L=require('../src/strategy/labels'),N=require('../src/strategy/nativeModels');
const {template}=require('../src/strategy/catalog'),{execute}=require('../src/strategy/worker');
function fixture(){
 const dates=E.weekdays('2015-01-02','2020-12-31').slice(0,1000),prices=[],benchmark=[],assets=Array.from({length:6},(_,i)=>({asset_id:`S${i}`,masked_name:`종목${i}`,is_active:true}));
 let seed=27;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return(seed+.5)/4294967296;},closes=assets.map((_,i)=>100+i*30);
 for(let d=0;d<dates.length;d++){const shared=(rand()-.5)*.03;benchmark.push({trade_date:dates[d],value:1000+d*.3+Math.sin(d/12)*20});
  for(let i=0;i<assets.length;i++){const open=closes[i]*Math.exp((rand()-.5)*.006);closes[i]*=Math.exp(shared+(rand()-.5)*.035+.0001);const close=closes[i];
   prices.push({asset_id:`S${i}`,trade_date:dates[d],open_price:open,close_price:close,high_price:Math.max(open,close)*(1+.005+rand()*.01),low_price:Math.min(open,close)*(1-.005-rand()*.01),adjusted_volume:1000+rand()*1000,amount:1e8+rand()*1e8});}}
 return{dates,prices,assets,benchmark,asOf:dates.at(-1),initialCash:30000000,feeBps:10};
}
const input=fixture(),data=E.buildFrames(input),config=(patch={})=>({...template('volatility-label'),trainYears:3,ensembleTrees:50,minLeaf:10,...patch});
test('matured labels, exact round-trip cost and explicit neutral exclusion',()=>{
 const c=config(),cutoff=input.dates[650],prepared=E.trainingSet(c,data,cutoff,20),future=structuredClone(input);
 for(const p of future.prices)if(p.trade_date>=cutoff){p.open_price*=3;p.close_price*=2;}
 assert.deepEqual(E.trainingSet(c,E.buildFrames(future),cutoff,20),prepared);assert.ok(prepared.metadata.trainedThrough<cutoff);
 assert.equal(prepared.metadata.labelSpec.cost,1.002/.998-1);assert.ok(prepared.metadata.labelSpec.counts.every(n=>n>=20));
 const tails=E.trainingSet({...c,target:'tails'},data,cutoff,20);assert.equal(tails.metadata.labelSpec.conditional,true);assert.ok(tails.metadata.labelSpec.excluded>0);assert.equal(L.label(0,tails.metadata.labelSpec),null);
});
test('historical standardization is causal; old price hashes ignore added OHLC fields',()=>{
 const date=input.dates[400];assert.ok(Number.isFinite(data.frames.get(date).rows[0].zscores.return20));
 const past=[...data.frames.values()].filter(f=>f.date<date).slice(-60).map(f=>f.rows.find(r=>r.id==='S0').values.return20);const mean=past.reduce((s,x)=>s+x,0)/60,sd=Math.sqrt(past.reduce((s,x)=>s+(x-mean)**2,0)/59);assert.ok(Math.abs(data.frames.get(date).rows[0].zscores.return20-(data.frames.get(date).rows[0].values.return20-mean)/sd)<1e-8);
 const truncated=E.buildFrames({...input,prices:input.prices.filter(p=>p.trade_date<=date),benchmark:input.benchmark.filter(p=>p.trade_date<=date)});assert.deepEqual(truncated.frames.get(date),data.frames.get(date));
 const old={...input,config:{researchVersion:0}},stripped={...old,prices:old.prices.map(({high_price,low_price,...p})=>p)};
 assert.equal(E.sourceHash(old,date),E.sourceHash(stripped,date));assert.notEqual(E.sourceHash({...input,config:{researchVersion:1}},date),E.sourceHash(stripped,date));
});
test('library classifications preserve probabilities and explanations; raw and zscore inputs work',{timeout:90000},async t=>{
 if(!(await N.capabilities()).xgboost.available)return t.skip('native libraries unavailable');
 for(const method of ['randomForest','lightgbm','xgboost'])for(const target of ['binary','threeClass','tails']){
  const m=E.train(config({method,target}),data,input.dates[650],null,10),p=E.predict(data.frames.get(input.dates[700]).rows[0],m);
  assert.ok(Math.abs(p.probabilities.reduce((a,b)=>a+b,0)-1)<1e-8);assert.ok(p.probabilities.every(v=>v>=0&&v<=1));assert.ok(Math.abs(p.intercept+p.contributions.reduce((s,c)=>s+c.value,0)-p.margin)<1e-8);
 }
 for(const representation of ['raw','zscore']){const m=E.train(config({representation}),data,input.dates[650],null,10);assert.ok(Number.isFinite(E.predict(data.frames.get(input.dates[700]).rows[0],m).score));}
});
test('entry and exit thresholds preserve holdings in the hold band',()=>{
 const frame=data.frames.get(input.dates[700]),c=config({method:'ridge',target:'return',tradePolicy:'probability',entryProbability:.65,exitProbability:.4,topK:2,entryCeiling:null}),m={method:'ridge',keys:['return20'],intercept:.55,coefficients:[0]},held=new Map([['S0',{quantity:1}]]);
 assert.equal(E.selection(c,frame,new Map(),m).rows.length,0);assert.deepEqual(E.selection(c,frame,held,m).rows.map(r=>r.id),['S0']);assert.equal(E.selection(c,frame,held,{...m,intercept:.3}).rows.length,0);
});
test('HAR, VHAR, sparse VHAR, GARCH and joint tails are frozen before evaluation',{timeout:90000},()=>{
 const cutoff=input.dates[700],changed=structuredClone(input);for(const p of changed.prices)if(p.trade_date>=cutoff){p.high_price*=2;p.open_price*=2;p.close_price*=2;p.low_price*=2;}
 const changedData=E.buildFrames(changed);
 for(const riskModel of ['har','vhar','sparseVhar','garch']){
  const c={...template(),riskModel,riskAssets:['S0','S1','S2'],trainYears:3,riskLagMode:'auto',stressTest:riskModel==='garch'},m=R.fit(c,data,cutoff);
  assert.deepEqual(m,R.fit(c,changedData,cutoff));assert.ok(m.trainedThrough<cutoff);assert.ok(m.sampleCount>=200);
  const runtime=R.runtime(m,data),frame=data.frames.get(input.dates[720]),decision=E.selection(c,frame,new Map(),null,runtime);assert.ok(Number.isFinite(decision.riskForecast.annualVol));assert.ok(decision.exposure<=c.exposure/100);
  if(c.stressTest){const interrupted=structuredClone(data);interrupted.frames.get(input.dates[710]).bars.delete('S0');assert.equal(R.runtime(m,interrupted).forecasts.get(frame.date).garch,null);const result=R.stress(c,runtime,frame.date,decision,input.initialCash);assert.equal(result.available,true);assert.ok(result.mrv.es95>=result.mrv.var95);assert.ok(result.gaussian.es95>=result.gaussian.var95);assert.deepEqual(result,R.stress(c,runtime,frame.date,decision,input.initialCash));}
 }
});
test('risk and label comparisons match capital, dates, costs and fixed signal',{timeout:90000},()=>{
 const riskConfig={...template('learning'),riskModel:'har',riskAssets:['S0','S1','S2'],comparison:'risk',trainYears:3},risk=execute({...input,config:riskConfig,mode:'compare'});
 assert.equal(risk.reports.length,2);assert.deepEqual(risk.reports[0].model,risk.reports[1].model);assert.deepEqual(risk.reports[0].config.riskAssets,risk.reports[1].config.riskAssets);
 const labels=execute({...input,config:config({comparison:'labels'}),mode:'compare'});
 for(const r of [...risk.reports,...labels.reports]){assert.equal(r.initialCash,input.initialCash);assert.equal(r.feeBps,input.feeBps);assert.equal(r.turnCount,240);assert.equal(r.chart[0].own,0);assert.ok(Number.isFinite(r.own.returnRate));}
 assert.ok(labels.reports.every(r=>r.calibration.count>0));
});
test('missing risk history fails explicitly',()=>{
 const c={...template(),riskModel:'har',riskAssets:['S0','S1'],trainYears:3};assert.throws(()=>R.fit(c,data,input.dates[100]),/최소 200/);assert.throws(()=>R.fit({...c,stressTest:true},data,input.dates[250]),/최소 300/);
});

test('joint risk uses covariances, fixed fitting and observed updates',{timeout:90000},()=>{
 const cutoff=input.dates[700],future=structuredClone(input);for(const p of future.prices)if(p.trade_date>=cutoff)p.close_price*=2;
 for(const riskModel of ['ewma','ccc','dcc']){
  const c={...template(),riskModel,riskAssets:['S0','S1','S2'],trainYears:3},m=R.fit(c,data,cutoff);
  assert.deepEqual(m,R.fit(c,E.buildFrames(future),cutoff));
  const rt=R.runtime(m,data),frame=data.frames.get(input.dates[720]),forecast=rt.forecasts.get(frame.date);
  assert.ok(forecast.covariance);assert.ok(forecast.correlation.every((r,i)=>Math.abs(r[i]-1)<1e-10));
  const decision=E.selection(c,frame,new Map(),null,rt),chosen=decision.rows;
  const w=chosen.map(()=>Math.min(c.maxWeight/100,c.exposure/100/chosen.length)),expected=Math.sqrt(252*chosen.reduce((a,x,i)=>a+chosen.reduce((b,y,j)=>b+w[i]*w[j]*forecast.covariance[m.ids.indexOf(x.id)][m.ids.indexOf(y.id)],0),0));
  assert.ok(Math.abs(expected-decision.riskForecast.annualVol)<1e-9);
  const limited=E.selection({...c,riskTarget:1},frame,new Map(),null,rt),actual=Math.sqrt(252*limited.rows.reduce((a,x)=>a+limited.rows.reduce((b,y)=>b+x.targetWeight*y.targetWeight*forecast.covariance[m.ids.indexOf(x.id)][m.ids.indexOf(y.id)],0),0));assert.ok(actual<=1+1e-8);
  assert.ok(expected<=decision.riskForecast.assetVols.reduce((s,a)=>s+a.vol,0)/chosen.length+1e-8);
  const truncated=E.buildFrames({...input,prices:input.prices.filter(p=>p.trade_date<=frame.date),benchmark:input.benchmark.filter(p=>p.trade_date<=frame.date)});
  assert.deepEqual(forecast,R.runtime(m,truncated).forecasts.get(frame.date));
  if(riskModel==='ccc')assert.deepEqual(rt.forecasts.get(input.dates[710]).correlation,forecast.correlation);
  const gap=structuredClone(data);gap.frames.get(input.dates[710]).bars.delete('S0');assert.equal(R.runtime(m,gap).forecasts.get(frame.date).covariance,null);
 }
});
test('hypothesis PCA preserves the chosen axis and frozen transforms for all learners',{timeout:90000},()=>{
 const c={...template('hypothesis-axis'),trainYears:3,ensembleTrees:50,minLeaf:10},cutoff=input.dates[700];
 const prepared=E.trainingSet(c,data,cutoff),changed=structuredClone(input);
 for(const p of changed.prices)if(p.trade_date>=cutoff)p.close_price*=3;
 assert.deepEqual(prepared,E.trainingSet(c,E.buildFrames(changed),cutoff));
 for(const reduction of ['pca','anchoredPca'])for(const method of ['ridge','tree','randomForest','lightgbm','xgboost']){
  const m=E.train({...c,reduction,method},data,cutoff,prepared),t=m.transform;
  assert.equal(t.axes.length,2); assert.equal(t.inputKeys.length,4);
  const dot=t.axes[0].reduce((s,v,j)=>s+v*t.axes[1][j],0);assert.ok(Math.abs(dot)<1e-8);
  assert.ok(t.explained.reduce((a,b)=>a+b,0)<=1+1e-8);
  if(reduction==='anchoredPca'){const norm=Math.sqrt(c.terms.reduce((s,v)=>s+v.weight**2,0));c.terms.forEach((v,i)=>assert.ok(Math.abs(t.axes[0][i]-v.weight/norm)<1e-10));}
  const row=data.frames.get(input.dates[720]).rows[0],prediction=E.predict(row,m);
  const x=t.inputKeys.map(k=>row.ranks[k]/100-.5),axis=require('../src/strategy/reduction').project(x,t),values=Object.fromEntries(m.keys.map((k,i)=>[k,axis[i]]));
  assert.equal(prediction.score,E.predict({values,ranks:{}},{...m,transform:null}).score);assert.ok(Number.isFinite(prediction.score));
  assert.ok(Math.abs(prediction.intercept+prediction.contributions.reduce((s,c)=>s+c.value,0)-prediction.score)<1e-6);
 }
 const classifier=E.train({...c,method:'xgboost',target:'threeClass'},data,cutoff,null,10);assert.ok(E.predict(data.frames.get(input.dates[720]).rows[0],classifier).probabilities.every(Number.isFinite));
 const report=execute({...input,config:{...c,comparison:'reduction'},mode:'compare'});
 assert.equal(report.reports.length,3);assert.deepEqual(report.reports.map(r=>r.model.trainingHash),Array(3).fill(report.reports[0].model.trainingHash));
 assert.throws(()=>E.validateConfig({...c,components:4}),/차원 축소/);
});
