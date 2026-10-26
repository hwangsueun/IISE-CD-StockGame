// Version 0 is the original workshop. Saved versions retain that data contract.
const defaults = {
  researchVersion: 0, target: 'return', labelRule: 'fixed', labelThreshold: 1, labelSigma: .2,
  representation: 'rank', tradePolicy: 'rank', entryProbability: .65, exitProbability: .4,
  riskModel: 'none', riskAssets: [], riskTarget: 15, riskShort: 5, riskLong: 22,
  riskLagMode: 'fixed', stressTest: false, stressHorizon: 20, comparison: 'models',
  covarianceDecay: .94, reduction: 'none', components: 2,
};
function validate(c) {
  const choice = (k, values) => { if (!values.includes(c[k])) throw Error(`${k} 선택을 확인해 주세요.`); };
  const range = (k, lo, hi) => { if (!Number.isFinite(c[k]) || c[k] < lo || c[k] > hi) throw Error(`${k} 범위를 확인해 주세요.`); };
  choice('researchVersion', [0, 1]); choice('target', ['return', 'binary', 'threeClass', 'tails']);
  choice('labelRule', ['fixed', 'sigma']); range('labelThreshold', 0, 20); range('labelSigma', .1, 2);
  choice('representation', ['rank', 'raw', 'zscore']); choice('tradePolicy', ['rank', 'probability']);
  range('entryProbability', .5, .95); range('exitProbability', .05, .5);
  if (c.exitProbability >= c.entryProbability) throw Error('청산 기준은 진입 기준보다 낮아야 합니다.');
  choice('riskModel', ['none', 'historical', 'garch', 'har', 'vhar', 'sparseVhar', 'ewma', 'ccc', 'dcc']);
  choice('covarianceDecay', [.9, .94, .97, .99]);
  choice('reduction', ['none', 'pca', 'anchoredPca']);
  choice('components', [1, 2, 3, 4, 5]);
  if (c.reduction !== 'none' && (!['ridge','tree','randomForest','lightgbm','xgboost'].includes(c.method) ||
      c.terms.length <= c.components)) throw Error('차원 축소에는 학습 모델과 축 개수보다 많은 지표가 필요합니다.');
  choice('riskLagMode', ['fixed', 'auto']); choice('riskShort', [4, 5, 7]); choice('riskLong', [17, 20, 22]);
  range('riskTarget', 5, 50); choice('stressHorizon', [1, 5, 20]); choice('comparison', ['models', 'labels', 'risk', 'reduction']);
  if (typeof c.stressTest !== 'boolean' || !Array.isArray(c.riskAssets) || c.riskAssets.length > 5 ||
      new Set(c.riskAssets).size !== c.riskAssets.length || c.riskAssets.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id)))
    throw Error('위험 분석 종목은 서로 다른 종목을 최대 5개 선택해 주세요.');
  if ((['garch', 'har', 'vhar', 'sparseVhar', 'ewma', 'ccc', 'dcc'].includes(c.riskModel) || c.stressTest) && c.riskAssets.length < 2)
    throw Error('학습형 위험 모델과 공동 손실 실험은 투자 대상 종목을 2~5개 지정해야 합니다.');
  if (c.target !== 'return' && !['randomForest', 'lightgbm', 'xgboost'].includes(c.method))
    throw Error('분류 목표에는 Random Forest·LightGBM·XGBoost를 선택해 주세요.');
  if (c.tradePolicy === 'probability' && c.target === 'return') throw Error('확률 기준 매매는 분류 목표에서 사용할 수 있습니다.');
  if (c.researchVersion === 0 && (c.target !== 'return' || c.representation !== 'rank' || c.riskModel !== 'none' || c.stressTest || c.riskAssets.length || c.reduction !== 'none'))
    throw Error('새 연구 설정은 새 버전으로 저장해 주세요.');
}
module.exports = { defaults, validate };
