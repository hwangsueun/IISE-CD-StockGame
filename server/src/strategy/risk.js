const { runScript } = require('./nativeModels');
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const park = b => b?.high > b?.low && b.low > 0 ? Math.log(Math.sqrt(Math.log(b.high/b.low)**2/(4*Math.log(2)))) : null;
function panel(data, ids, cutoff, years) {
  const from = new Date(`${cutoff}T00:00:00Z`); from.setUTCFullYear(from.getUTCFullYear()-years);
  let previous = null, rows = [];
  for (const [date, frame] of data.frames) {
    if (date >= cutoff) break;
    const bars=ids.map(id=>frame.bars.get(id));
    const complete=bars.every(b=>b?.close>0);
    if (complete && previous && date>=from.toISOString().slice(0,10)) rows.push({date, returns:bars.map((b,i)=>Math.log(b.close/previous[i].close)*100),logVol:bars.map(park)});
    else if (!complete) rows=[];
    previous=complete?bars:null;
  }
  return rows;
}
function fit(config,data,cutoff) {
  if ((!config.riskModel || ['none','historical'].includes(config.riskModel)) && !config.stressTest) return null;
  const ids=config.riskAssets;
  if(ids.some(id=>!data.assets.has(id))) throw Error('위험 분석 대상으로 지정한 종목이 없습니다.');
  let rows=panel(data,ids,cutoff,config.trainYears);
  if(['har','vhar','sparseVhar'].includes(config.riskModel)) {
    const lastInvalid=rows.findLastIndex(r=>r.logVol.some(v=>!Number.isFinite(v)));
    rows=rows.slice(lastInvalid+1);
  } else rows=rows.map(r=>({...r,logVol:r.logVol.map(v=>Number.isFinite(v)?v:0)})); // Unused by return-only GARCH.
  const model=runScript('fit_risk.py',{config,rows,ids});
  return {...model,availableFrom:cutoff,trainingHash:require('./engine').hash(rows)};
}
function runtime(model,data) {
  if(!model) return null;
  const forecasts=new Map(), history=[...model.lastLogVol], gs=model.garch?.map(g=>({...g}));
  let ewma=model.ewma && structuredClone(model.ewma), q=model.dcc && structuredClone(model.dcc.nextQ);
  const correlation=matrix=>matrix.map((row,i)=>row.map((x,j)=>x/Math.sqrt(matrix[i][i]*matrix[j][j])));
  const covariance=(r,v)=>r.map((row,i)=>row.map((x,j)=>x*Math.sqrt(v[i]*v[j])));
  let previous, garchGap = false;
  for(const [date,frame] of data.frames) {
    const bars=model.ids.map(id=>frame.bars.get(id));
    if(date<model.availableFrom){previous=bars.every(b=>b?.close>0)?bars:null;continue;}
    if(!bars.every(b=>b?.close>0) || !previous) {garchGap = true; previous=bars.every(b=>b?.close>0)?bars:null; history.length=0; forecasts.set(date,{vols:[],reason:'공통 가격 관측이 끊겨 위험 예측을 보류합니다.'});continue;}
    const returns=bars.map((b,i)=>Math.log(b.close/previous[i].close)*100);
    if(gs && !garchGap) {
      const z=gs.map((g,i)=>(returns[i]-g.mu)/Math.sqrt(g.nextVariance));
      if(q) q=q.map((row,i)=>row.map((x,j)=>(1-model.dcc.alpha-model.dcc.beta)*model.dcc.qbar[i][j]+model.dcc.alpha*z[i]*z[j]+model.dcc.beta*x));
      gs.forEach((g,i)=>{const e=returns[i]-g.mu;g.nextVariance=g.omega+g.alpha*e*e+g.beta*g.nextVariance;});
    }
    if(ewma && !garchGap) {
      const e=returns.map((r,i)=>r-ewma.mu[i]);
      ewma.nextCovariance=ewma.nextCovariance.map((row,i)=>row.map((x,j)=>ewma.decay*x+(1-ewma.decay)*e[i]*e[j]));
    }
    const logVol=bars.map(park);
    if(logVol.every(Number.isFinite)){history.push(logVol);if(history.length>22)history.shift();}else history.length=0;
    let vols=[], cov=null, corr=null;
    if(['ccc','dcc'].includes(model.method) && !garchGap) {
      corr=q?correlation(q):model.correlation; cov=covariance(corr,gs.map(g=>g.nextVariance));
    } else if(model.method==='ewma' && !garchGap) {cov=structuredClone(ewma.nextCovariance);corr=correlation(cov);}
    if(cov) vols=cov.map((row,i)=>Math.sqrt(row[i]*252));
    else if(model.method==='garch' && !garchGap) vols=gs.map(g=>Math.sqrt(g.nextVariance*252));
    else if(model.regressions && history.length>=model.long) {
      const x=[...history.at(-1),...model.ids.map((_,i)=>mean(history.slice(-model.short).map(v=>v[i]))),...model.ids.map((_,i)=>mean(history.slice(-model.long).map(v=>v[i])))];
      vols=model.regressions.map(m=>Math.exp(m.intercept+m.columns.reduce((s,j,k)=>s+x[j]*m.coefficients[k],0))*Math.sqrt(252)*100);
    }
    forecasts.set(date,{vols,covariance:cov,correlation:corr,garch:garchGap ? null : gs?.map(g=>({...g})),history:history.length}); previous=bars;
  }
  return {...model,forecasts};
}
function forecast(config,frame,risk,chosen,exposure=1) {
  if(!chosen.length)return {annualVol:0,assetVols:[]};
  let assetVols;
  if(config.riskModel==='historical') assetVols=chosen.map(r=>({id:r.id,vol:r.values.vol20}));
  else {const prediction=risk?.forecasts?.get(frame.date);assetVols=chosen.map(r=>({id:r.id,vol:prediction?.vols[risk.ids.indexOf(r.id)]}));}
  if(assetVols.some(r=>!Number.isFinite(r.vol)))return {annualVol:null,reason:'지정한 종목의 위험 예측 자료가 부족합니다.',assetVols};
  const weights=chosen.map(r=>config.allocation==='inverseVol'?1/Math.max(r.values.vol20,.1):1),sum=weights.reduce((a,b)=>a+b,0);
  // Weighted marginal volatilities provide a conservative upper bound; no guessed correlation.
  const prediction=risk?.forecasts?.get(frame.date), cov=prediction?.covariance;
  const portfolioWeights=cov?weights.map(w=>Math.min(config.maxWeight/100,exposure*w/sum)):null;
  const annualVol=cov?Math.sqrt(Math.max(0,chosen.reduce((s,a,i)=>s+chosen.reduce((v,b,j)=>
    v+portfolioWeights[i]*portfolioWeights[j]*cov[risk.ids.indexOf(a.id)][risk.ids.indexOf(b.id)],0),0))*252):
    assetVols.reduce((s,r,i)=>s+r.vol*weights[i]/sum,0);
  return {annualVol,assetVols,aggregation:cov?'portfolio covariance':'weighted marginal volatility upper bound',
    portfolioWeights,correlation:prediction?.correlation,ids:risk?.ids,model:config.riskModel};
}
function random(seed) {let s=seed>>>0;return ()=>{s=(1664525*s+1013904223)>>>0;return (s+.5)/4294967296;};}
function stress(config,risk,date,decision,capital) {
  if(!config.stressTest)return null;
  const spec=risk?.stress, current=risk?.forecasts?.get(date);
  if(!spec || !current?.garch)return {available:false,reason:'이 날짜의 공동 손실 실험 자료가 부족합니다.'};
  if(spec.tailIndex<=1)return {available:false,reason:'추정 꼬리 지수가 1 이하라 평균 꼬리손실을 안정적으로 제시할 수 없습니다.'};
  const weights=risk.ids.map(id=>decision.rows.find(r=>r.id===id)?.targetWeight||0), exposure=weights.reduce((a,b)=>a+b,0);
  if(exposure===0)return {available:false,reason:'목표 포트폴리오가 전액 현금입니다.'};
  const result={};
  for(const method of ['gaussian','mrv']) {
    const rng=random(spec.seed), losses=[];
    const normal=()=>Math.sqrt(-2*Math.log(rng()))*Math.cos(2*Math.PI*rng());
    for(let path=0;path<spec.paths;path++) {
      const g=current.garch.map(v=>({...v})), growth=weights.map(()=>1);
      for(let day=0;day<config.stressHorizon;day++) {
        let z;
        if(method==='gaussian'){const u=g.map(normal);z=spec.cholesky.map(row=>row.reduce((s,c,i)=>s+c*u[i],0));}
        else if(rng()<spec.tailProbability){const direction=spec.directions[Math.floor(rng()*spec.directions.length)],radial=spec.threshold*Math.pow(rng(),-1/spec.tailIndex);z=direction.map(v=>v*radial);}
        else z=spec.center[Math.floor(rng()*spec.center.length)];
        g.forEach((p,i)=>{const e=Math.sqrt(p.nextVariance)*z[i], r=(p.mu+e)/100;growth[i]*=Math.exp(r);p.nextVariance=p.omega+p.alpha*e*e+p.beta*p.nextVariance;});
      }
      const total=1-exposure+growth.reduce((s,v,i)=>s+weights[i]*v,0);
      if(!Number.isFinite(total))return {available:false,reason:'극단 시나리오가 수치 범위를 벗어났습니다. 이 추정으로 손실 규모를 제시할 수 없습니다.'};
      losses.push(1-total);
    }
    losses.sort((a,b)=>a-b);
    const tail=losses.slice(Math.floor(.95*losses.length)),var95=Math.max(0,tail[0]),es95=Math.max(0,mean(tail));
    result[method]={var95,es95,varAmount:var95*capital,esAmount:es95*capital,lossFrequency:losses.filter(x=>x>0).length/losses.length};
  }
  return {available:true,...result,horizon:config.stressHorizon,paths:spec.paths,tailIndex:spec.tailIndex,tailCount:spec.tailCount,
    sampleCount:risk.sampleCount,seed:spec.seed,exposure,weights:risk.ids.map((id,i)=>({id,weight:weights[i]})),
    note:'현재 목표 비중으로 매수한 뒤 보유하는 모의실험입니다. 수수료·리밸런싱·빚 상환은 포함하지 않습니다. 추정 확률은 실제 미래 확률이 아닙니다.',
    method:spec.method};
}
module.exports={fit,runtime,forecast,stress,panel};
