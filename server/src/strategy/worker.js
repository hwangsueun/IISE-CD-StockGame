const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const crypto = require('node:crypto');
const engine = require('./engine');
const C = require('../config/constants');
const riskEngine = require('./risk');
const { replayQuant, validateArtifact } = require('../services/quantReplay');

function compareSaved(input) {
  const observing = input.comparisonPeriod === 'observe';
  const versions = input.versions;
  const commonDate = versions.map(v => v.savedDate).sort().at(-1);
  const commonTurn = Math.max(...versions.map(v => v.savedTurn));
  const reports = versions.map((version, index) => {
    // Frozen models keep the exact history used when they were saved. Only the
    // evaluation start moves to the latest save so every portfolio starts equal.
    const sourceFrom = observing ? version.sourceFrom : input.sourceFrom;
    const source = { ...input, config: version.config,
      prices: input.prices.filter(p => p.trade_date >= sourceFrom),
      benchmark: input.benchmark.filter(p => p.trade_date >= sourceFrom) };
    try {
      if (observing && engine.sourceHash(source, version.savedDate) !== version.sourceHash) {
        throw Error('저장 당시의 가격 데이터가 달라졌습니다.');
      }
      const report = execute({ ...source, mode: observing ? 'observe' : 'practice',
        model: observing ? version.model : null, savedDate: commonDate,
        expectedSourceHash: observing ? engine.sourceHash(source, commonDate) : null });
      return { ...report, versionId: version.id, savedTurn: version.savedTurn, variantLabel: `${index + 1}. ${version.config.name}` };
    } catch (error) {
      throw Error(`${version.config.name}: ${error.message}`);
    }
  });
  const first = reports[0];
  if (reports.some(r => r.from !== first.from || r.to !== first.to || r.turnCount !== first.turnCount)) {
    throw Error('모델들의 비교 기간을 맞출 수 없습니다.');
  }
  return { kind: 'compare', comparison: 'custom', comparisonPeriod: input.comparisonPeriod,
    config: { ...first.config, name: `${versions.length}개 모델 비교` },
    from: first.from, to: first.to, turnCount: first.turnCount, initialCash: input.initialCash,
    feeBps: input.feeBps, commonStartTurn: observing ? commonTurn : null,
    comparedModels: versions.map(v => ({ id: v.id, name: v.config.name, savedTurn: v.savedTurn })), reports };
}

function execute(input) {
  if (input.mode === 'compareSaved') return compareSaved(input);
  const config = engine.validateConfig(input.config), data = engine.buildFrames(input);
  // Each worker has its own module state. Cost stress cannot change the running game's fee rate.
  C.TRADE_FEE_RATE = input.feeBps / 10000;
  const availableDates = [...data.frames.keys()].filter(d => d <= input.asOf);
  if (!availableDates.length) throw Error('이 시점의 주가 데이터가 없습니다.');
  const sourceHash = engine.sourceHash(input, input.mode === 'observe' ? input.savedDate : input.asOf);
  if (input.mode === 'observe' && sourceHash !== input.expectedSourceHash) throw Error('저장 당시의 가격 데이터와 달라 관찰 결과를 재계산할 수 없습니다.');
  if(input.mode==='automate') {
    if(engine.sourceHash(input,input.savedDate)!==input.expectedSourceHash)throw Error('저장 당시의 가격 자료가 변경되어 자동 투자를 보류했습니다.');
    const frame=data.frames.get(input.asOf);
    if(!frame)return {orders:[],reason:'휴장일이라 자동 주문을 기다립니다.'};
    const signal=input.model?.artifactVersion===2?input.model.signal:input.model;
    const risk=riskEngine.runtime(input.model?.artifactVersion===2?input.model.risk:null,data);
    const holdings=new Map(input.holdings.map(h=>[h.asset_id,{quantity:Number(h.quantity),avgPrice:Number(h.avg_price)}]));
    const decision=engine.selection(config,frame,holdings,signal,risk);
    const due=input.turn>=input.nextReview;
    const prices=new Map(); for(const f of data.frames.values())for(const [id,b]of f.bars)if(b.close>0)prices.set(id,b.close);
    const orders=due || (decision.exposure===0 && holdings.size)?engine.targetOrders(decision,holdings,input.cash,prices,frame,input.turn):[];
    return {orders,decision,nextReview:due?input.turn+config.rebalanceTurns:input.nextReview};
  }
  function fitBundle(c, cutoff, prepared) {
    const signal = engine.train(c, data, cutoff, prepared, input.feeBps), risk = riskEngine.fit(c, data, cutoff);
    return { artifactVersion: 2, signal, risk };
  }
  if (input.mode === 'save') {
    const bundle = fitBundle(config, input.asOf);
    return { model: bundle, sourceHash, decision: engine.selection(config, data.frames.get(availableDates.at(-1)), new Map(), bundle.signal, riskEngine.runtime(bundle.risk, data)) };
  }
  let dates;
  if (input.mode === 'observe') dates = engine.weekdays(input.savedDate, input.asOf);
  else dates = engine.weekdays(availableDates[Math.min(60, availableDates.length - 1)], input.asOf).slice(-240);
  if (input.mode !== 'observe' && dates.length < 20) throw Error('과거 연습에 필요한 가격 이력이 부족합니다. 게임을 조금 더 진행해 주세요.');
  const equal = engine.replay(config, data, dates, input.initialCash, null, { equalHold: true });
  let rival = null, rivalNote = '이 기간의 alpha158 데이터가 없습니다.';
  if (input.quantFile) {
    const raw = fs.readFileSync(input.quantFile);
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    if (input.quantSha !== sha) throw Error('기존 alpha158 파일이 변경되었습니다. 다시 시도해 주세요.');
    const artifact = JSON.parse(raw); validateArtifact(artifact);
    if (artifact.schema_version === 3 && dates.filter(d => data.frames.has(d)).every(d => artifact.sessions[d])) {
      const replay = replayQuant({ turns: dates.map((d, i) => ({ turn_number: i + 1, trade_date: d })), prices: input.prices,
        assets: input.assets, artifact, initialCash: input.initialCash, totalTurns: dates.length });
      let peak = input.initialCash, mdd = 0;
      for (const row of replay.history) { peak = Math.max(peak, row.totalAsset); mdd = Math.min(mdd, row.totalAsset / peak - 1); }
      rival = { returnRate: replay.returnRate, maxDrawdown: mdd, tradeCount: replay.trades.length, history: replay.history }; rivalNote = '';
    }
  }
  const indexStart = [...data.frames.values()].filter(f => f.date <= dates[0] && f.market.value > 0).at(-1)?.market.value;
  const indexHistory = []; let lastIndex = indexStart;
  for (const date of dates) { const value = data.frames.get(date)?.market.value; if (value > 0) lastIndex = value; indexHistory.push(indexStart > 0 && lastIndex > 0 ? lastIndex / indexStart - 1 : null); }
  const summary = result => ({ returnRate: result.returnRate, maxDrawdown: result.maxDrawdown, tradeCount: result.tradeCount });
  function reportFor(config, bundle) {
  const model = bundle?.artifactVersion === 2 ? bundle.signal : bundle;
  const riskModel = bundle?.artifactVersion === 2 ? bundle.risk : null, risk = riskEngine.runtime(riskModel, data);
  const own = engine.replay(config, data, dates, input.initialCash, model, { endGame: input.mode === 'observe' && input.ended, risk });
  return { kind: input.mode, config, from: dates[0], to: dates.at(-1), turnCount: dates.length,
    initialCash: input.initialCash, feeBps: input.feeBps, sourceHash, model,
    riskModel: riskModel && { method: riskModel.method, trainedFrom: riskModel.trainedFrom, trainedThrough: riskModel.trainedThrough, sampleCount: riskModel.sampleCount, trainingHash: riskModel.trainingHash, short: riskModel.short, long: riskModel.long, lagCandidates: riskModel.lagCandidates, lagSelection: riskModel.lagSelection, coefficientCount: riskModel.coefficientCount, ids: riskModel.ids,
      decay:riskModel.ewma?.decay,dcc:riskModel.dcc && {alpha:riskModel.dcc.alpha,beta:riskModel.dcc.beta},correlationShrinkage:riskModel.correlationShrinkage },
    calibration: require('./labels').evaluate(model, data, dates, engine.predict),
    stress: riskEngine.stress(config, risk, own.decision?.date, own.decision, input.initialCash),
    own: summary(own), equal: summary(equal), rival: rival && summary(rival), rivalNote,
    benchmarkReturn: indexHistory.at(-1), monthly: engine.monthly(own.history, input.initialCash, rival?.history),
    chart: own.history.map((r, i) => ({ turn: r.turn, own: r.returnRate, equal: equal.history[i].returnRate, rival: rival?.history[i]?.returnRate ?? null, benchmark: indexHistory[i] })),
    decision: own.decision, holdings: own.holdings, cash: own.cash, totalAsset: own.totalAsset,
    pendingOrders: own.orders.filter(o => o.status === 'pending').map(o => ({ ...o, name: data.assets.get(o.assetId)?.masked_name || '이름 미등록' })),
    limitations: [input.mode !== 'observe' ? '이미 공개된 과거를 반복해 보는 연습입니다. 새로운 기간에서의 검증이 아닙니다.' : '저장한 규칙과 학습값을 고정해 저장 이후의 성과를 관찰합니다. 실제 계좌 수익이 아닙니다.',
      '주식과 현금만 사용합니다. 월급·생활비·상환·상금은 포함하지 않습니다.',
      '코스피는 종가 기준 참고지수입니다. 직접 매수하는 자산이 아니며 배당은 포함하지 않습니다.',
      '수록 종목과 수정주가의 한계가 있습니다. 과거 성과는 이후 수익을 보장하지 않습니다.'],
  };
  }
  if (input.mode === 'compare') {
    let reports, training = null;
    if(config.comparison==='reduction') {
      if(!['ridge','tree','randomForest','lightgbm','xgboost'].includes(config.method) || config.terms.length<=config.components)
        throw Error('차원 축소 비교에는 학습 모델과 축 개수보다 많은 지표가 필요합니다.');
      const prepared=engine.trainingSet(config,data,dates[0],input.feeBps), risk=riskEngine.fit(config,data,dates[0]);
      reports=['none','pca','anchoredPca'].map(reduction=>{
        const c={...config,reduction}, report=reportFor(c,{artifactVersion:2,signal:engine.train(c,data,dates[0],prepared),risk});
        report.variantLabel={none:'원래 지표',pca:'PCA',anchoredPca:'내 가설을 유지한 PCA'}[reduction];return report;
      });
    } else if (config.comparison === 'risk') {
      if (config.riskModel === 'none') throw Error('비교할 위험 모델을 먼저 선택해 주세요.');
      const bundle = fitBundle(config, dates[0]);
      const off = { ...config, riskModel: 'none', stressTest: false };
      reports = [reportFor(off, { ...bundle, risk: null }), reportFor(config, bundle)];
      reports[0].variantLabel = '위험 조절 없음'; reports[1].variantLabel = '위험 조절 적용';
    } else if (config.comparison === 'labels') {
      if (!['randomForest','lightgbm','xgboost'].includes(config.method)) throw Error('라벨 비교는 분류 가능한 학습 모델에서 실행해 주세요.');
      const risk = riskEngine.fit(config, data, dates[0]);
      reports = ['binary','threeClass','tails'].map(target => {
        const c = { ...config, target };
        const report = reportFor(c, { artifactVersion: 2, signal: engine.train(c, data, dates[0], null, input.feeBps), risk });
        report.variantLabel = { binary: '상승 / 비상승', threeClass: '하락 / 중립 / 상승', tails: '중립 제외' }[target]; return report;
      });
    } else {
      if (!config.terms.length) throw Error('학습 모델에 공통으로 넣을 지표를 하나 이상 선택해 주세요.');
      const prepared = engine.trainingSet(config, data, dates[0], input.feeBps), risk = riskEngine.fit(config, data, dates[0]);
      training = prepared.metadata;
      const methods = config.target !== 'return' ? ['randomForest','lightgbm','xgboost'] : config.researchVersion ? ['ridge','randomForest','lightgbm','xgboost'] : ['ridge','randomForest','lightgbm'];
      reports = methods.map(method => {
        const c = { ...config, method };
        return reportFor(c, { artifactVersion: 2, signal: engine.train(c, data, dates[0], prepared), risk });
      });
    }
    return { kind: 'compare', comparison: config.comparison, config, from: dates[0], to: dates.at(-1), turnCount: dates.length,
      initialCash: input.initialCash, feeBps: input.feeBps, sourceHash, training, reports };
  }
  return reportFor(config, input.mode === 'observe' ? input.model : fitBundle(config, dates[0]));
}
if (parentPort) { try { parentPort.postMessage({ result: execute(workerData) }); } catch (error) { parentPort.postMessage({ error: error.message }); } }
module.exports = { execute };
