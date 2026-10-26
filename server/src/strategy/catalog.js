// Public research references describe ideas, not replicated or certified returns.
const features = [];
for (const n of [5, 20, 60, 120, 240]) features.push({ id: `return${n}`, name: `${n}거래일 수익률`, unit: '%', group: '추세', formula: `(오늘 종가 / ${n}거래일 전 종가 − 1) × 100`, lookback: n + 1 });
for (const n of [60, 120, 240]) features.push({ id: `skip${n}`, name: `최근 20일 제외 · ${n}일 수익률`, unit: '%', group: '추세', formula: `(20거래일 전 종가 / ${n + 20}거래일 전 종가 − 1) × 100`, lookback: n + 21 });
for (const n of [20, 60]) features.push({ id: `vol${n}`, name: `${n}일 수익률 변동성`, unit: '%/년', group: '위험', formula: `최근 ${n}개 일간 수익률의 표본 표준편차 × √252 × 100`, lookback: n + 1 });
for (const n of [20, 60, 120, 200]) features.push({ id: `ma${n}`, name: `${n}일 평균 대비 가격`, unit: '%', group: '가격 위치', formula: `(오늘 종가 / 최근 ${n}거래일 평균 종가 − 1) × 100`, lookback: n });
features.push(
  { id: 'volume20', name: '평소 대비 거래량', unit: '배', group: '거래', formula: '오늘 수정 거래량 / 직전 20거래일 평균 수정 거래량', lookback: 21 },
  { id: 'amount20', name: '20일 평균 거래대금', unit: '억원', group: '거래', formula: '최근 20거래일 실제 거래대금 평균 / 1억', lookback: 20 },
  { id: 'position60', name: '60일 가격 범위 안의 위치', unit: '%', group: '가격 위치', formula: '(종가 − 60일 최저 종가) / (60일 최고 종가 − 최저 종가) × 100', lookback: 60 },
  { id: 'riskMomentum', name: '변동성으로 조정한 중기 추세', unit: '점', group: '추세', formula: '최근 20일을 제외한 120일 수익률 / 60일 연율 변동성', lookback: 141 },
);
for (const n of [1, 5, 20]) features.push({ id: `parkinson${n}`, name: `${n}일 고가·저가 변동성`, unit: '%/년', group: '위험', formula: '일별 ln(고가/저가)² / (4 ln 2)의 기간 평균에 제곱근 · 연율 환산', lookback: n });
const base = { ...require('./researchConfig').defaults, researchVersion: 1, schemaVersion: 1, name: '나의 투자 전략', hypothesis: '', referenceId: null, method: 'score',
  terms: [{ feature: 'return60', weight: 1 }], conditions: [], conditionMode: 'all', topK: 10,
  rebalanceTurns: 20, exposure: 80, maxWeight: 20, allocation: 'equal', marketMA: 0,
  targetVol: 0, rankBuffer: 0, entryCeiling: null, horizon: 20, trainYears: 2, ridgePenalty: 0.1, treeDepth: 3,
  ensembleTrees: 100, ensembleDepth: 5, minLeaf: 30, learningRate: 0.05 };
const references = [
  { id: 'momentum', title: '꾸준히 오른 종목 찾기', type: '지수 방법론', author: 'MSCI Momentum Indexes', year: '2025',
    url: 'https://www.msci.com/indexes/documents/methodology/2_MSCI_Momentum_Indexes_Methodology_20250417.pdf',
    hypothesis: '여러 기간에 걸친 상승 흐름이 이어질 수 있다.', original: '최근 1개월을 제외한 6·12개월 수익률을 변동성으로 조정합니다. 기존 종목을 유지하는 순위 완충 규칙도 사용합니다.',
    adaptation: '게임의 120·240거래일 수익률과 60일 변동성을 사용합니다. 원문의 기간·가중 방식과 다릅니다.', risk: '추세가 갑자기 반전하거나 시장 전체가 하락하면 손실이 커질 수 있습니다.',
    question: '최근 급등을 제외하거나 종목 교체를 줄이면 결과가 달라질까?',
    recipe: { terms: [{ feature: 'skip120', weight: 1 }, { feature: 'skip240', weight: 1 }, { feature: 'vol60', weight: -1 }], rankBuffer: 5 } },
  { id: 'trend', title: '추세가 약해지면 현금으로', type: '연구', author: 'Meb Faber · Tactical Asset Allocation', year: '2007 / 2017 회고',
    url: 'https://mebfaber.com/2017/12/13/episode-86-quantitative-approach-tactical-asset-allocation/',
    hypothesis: '가격이 오르는 흐름에서는 투자하고 떨어지는 흐름에서는 현금을 늘린다.', original: '월말 가격과 10개월 이동평균을 비교해 자산과 현금 사이를 전환합니다.',
    adaptation: '코스피의 200거래일 평균을 투자 조건으로 사용합니다. 주식은 60일 추세 순위로 고릅니다. 원 연구의 자산배분을 그대로 재현하지 않습니다.', risk: '횡보장에서는 잦은 매매로 비용이 늘 수 있습니다. 급반등 초기에는 현금을 보유한 탓에 뒤처질 수 있습니다.',
    question: '현금을 늘린 효과와 종목 선정 효과는 각각 얼마나 될까?', recipe: { marketMA: 200 } },
  { id: 'reversal', title: '상승 종목의 잠깐의 조정', type: '연구 데이터에서 착안', author: 'Kenneth French · Short-Term Reversal', year: '월별 포트폴리오',
    url: 'https://mba.tuck.dartmouth.edu/pages/faculty/Ken.french/Data_Library/det_10_port_form_pr_1_0.html',
    hypothesis: '중기 상승 종목의 단기 하락이 되돌려질 수 있다.', original: '직전 1개월 수익률에 따라 미국 주식을 나누어 이후 포트폴리오 수익률을 관찰합니다.',
    adaptation: '60일 상승 조건과 최근 5일 하락 조건을 결합한 주식 매수 전략입니다. 원본의 1개월 반전 포트폴리오와 다릅니다.', risk: '일시적 조정으로 보였던 하락이 장기 하락으로 이어질 수 있습니다. 거래비용의 영향을 확인하세요.',
    question: '상승 조건을 추가하는 것이 무조건 하락 종목을 사는 것보다 나을까?',
    recipe: { terms: [{ feature: 'return5', weight: -1 }], conditions: [{ feature: 'return60', measure: 'raw', op: 'gte', value: 0 }, { feature: 'return5', measure: 'raw', op: 'lte', value: 0 }], rebalanceTurns: 5 } },
  { id: 'volatility', title: '불안한 시장에서는 적게 투자', type: '연구', author: 'Moreira & Muir · Volatility-Managed Portfolios', year: '2017',
    url: 'https://www.anderson.ucla.edu/documents/areas/adm/Volatility%20Managed%20Portfolios.pdf',
    hypothesis: '위험이 높아질 때 투자 규모를 줄인다.', original: '예상 분산에 반비례하도록 위험 노출을 조절하는 포트폴리오를 연구합니다.',
    adaptation: '목표 변동성 / 코스피 20일 연율 변동성으로 투자 비중 상한을 낮춥니다. 차입 없이 최대 100%이며 원문의 역분산 운용과 다릅니다.', risk: '위험이 낮았던 직후의 충격은 막지 못할 수 있습니다. 상승장에서는 수익이 줄어들 수도 있습니다.',
    question: '같은 종목을 보유하면서 비중만 바꾸면 손실과 수익은 어떻게 변할까?', recipe: { targetVol: 15, allocation: 'inverseVol' } },
  { id: 'timing', title: '살 종목과 살 시점을 따로 판단', type: '연구', author: 'Israelov & Katz · AQR', year: '2011',
    url: 'https://www.aqr.com/Insights/Research/Journal-Article/To-Trade-or-Not-to-Trade-Informed-Trading-With-Short-Term-Signals-for-LongTerm-Investors',
    hypothesis: '장기적으로 선호하는 종목도 단기 신호를 보고 진입을 늦출 수 있다.', original: '단기 신호를 장기 포트폴리오의 매매 결정에 활용하는 방법을 제안합니다.',
    adaptation: '최근 5일 상승률이 기준을 넘으면 신규 진입을 보류합니다. 원문의 최적화 알고리즘은 사용하지 않습니다.', risk: '계속 오르는 종목을 놓칠 수 있습니다. 매수를 늦춘다고 비용이 항상 줄어들지는 않습니다.',
    question: '진입을 기다려 얻은 가격 이점이 놓친 수익보다 큰가?', recipe: { entryCeiling: 10, rebalanceTurns: 5 } },
  { id: 'learning', title: '지표의 조합을 데이터에서 학습', type: '연구', author: 'Gu, Kelly & Xiu · Empirical Asset Pricing via Machine Learning', year: '2020',
    url: 'https://www.nber.org/papers/w25398',
    hypothesis: '가격의 흐름과 흔들림·거래량을 함께 보고 이후에 올랐던 종목의 특징을 배운다.', original: '선형·트리·신경망 등 여러 방법을 비교하고 지표 간 비선형 관계의 기여를 분석합니다.',
    adaptation: '선택한 가격·거래량 지표의 당일 종목 간 순위를 선형 회귀나 트리 앙상블에 투입합니다. 연습 시작 전에 학습을 끝내고 평가 중에는 고정합니다.', risk: '학습 기간의 관계가 다음 기간에 유지되지 않을 수 있습니다. 학습 점수는 상승 확률이 아닙니다.',
    question: '동일한 지표와 매매 규칙에서 선형 모델과 조건 분기 모델은 얼마나 다른가?',
    recipe: { method: 'ridge', terms: ['return5', 'return20', 'return60', 'vol20', 'volume20', 'ma20'].map(feature => ({ feature, weight: 1 })) } },

];
references.push(
  { id: 'volatility-label', title: '의미 있는 움직임을 구분하기', type: '논문에서 착안', author: 'N-기간 변동성 데이터 라벨링을 활용한 XGBoost 트레이딩 시스템 개발', year: '2021',
    url: 'https://doi.org/10.7465/jkdi.2021.32.5.1049', hypothesis: '작은 움직임과 거래할 만한 움직임을 구분하면 진입 판단이 달라질 수 있다.',
    original: 'N일 수익률의 평균과 표준편차로 중립 구간을 만들고 이를 제외한 상승·하락 사례로 XGBoost를 학습합니다.',
    adaptation: '중립을 포함한 3분류와 중립을 제외한 2분류를 비교합니다. 학습 구간에서만 경계를 계산합니다. 양쪽 거래는 게임의 다음 시가 체결 규칙을 따릅니다.',
    risk: '중립 제외 모델의 출력은 극단 사례 안에서의 조건부 확률입니다. 모든 날의 상승 확률로 해석할 수 없습니다.',
    question: '같은 입력과 모델에서 중립을 포함할 때와 제외할 때 어떤 차이가 날까?',
    recipe: { method: 'xgboost', target: 'threeClass', labelRule: 'sigma', horizon: 5, tradePolicy: 'probability', rebalanceTurns: 1,
      terms: ['return5','return20','vol20','volume20','ma20'].map(feature => ({feature,weight:1})) } },
  { id: 'volatility-memory', title: '크게 흔들린 가격은 내일도 불안할까', type: '논문에서 착안', author: '고차원 VHAR 모형에서의 시차 구조 선택', year: '2026',
    url: 'https://doi.org/10.7465/jkdi.2026.37.5.877', hypothesis: '어제와 최근 며칠·몇 주의 움직임을 함께 보고 불안한 흐름이 이어질지 살펴본다.',
    original: '고가·저가 기반 변동성을 활용하고 VHAR 및 적응형 Lasso로 시차 구조와 종목 간 관계를 추정합니다.',
    adaptation: '2~5개 종목을 지정해 HAR·VHAR·Sparse VHAR를 학습합니다. 자동 시차는 학습 자료의 마지막 20%로 비교한 뒤 전체 학습 자료에 다시 적합합니다.',
    risk: '선택된 시차는 다음 기간의 최적 시차를 보장하지 않습니다. 모든 종목에 같은 시차를 적용합니다.',
    question: '수익 모델을 고정하고 위험 조절만 더하면 성과와 낙폭은 어떻게 달라질까?',
    recipe: { riskModel: 'har', riskLagMode: 'auto', comparison: 'risk', terms:[{feature:'return20',weight:1}] } },
  { id: 'joint-tail', title: '여러 종목이 함께 급락한다면', type: '논문에서 착안', author: '다변량 정칙변동을 기반한 주식가격 모의', year: '2023',
    url: 'https://doi.org/10.7465/jkdi.2023.34.3.365', hypothesis: '여러 종목을 샀어도 한꺼번에 떨어질 수 있다. 이런 상황에서 얼마나 잃을지 살펴본다.',
    original: 'CCC-GARCH 잔차의 크기와 방향을 나누어 다변량 정칙변동 꼬리를 추정하고 포트폴리오 손실을 모의합니다.',
    adaptation: 'GARCH 잔차에 Hill 꼬리 지수와 관측된 극단 방향을 사용합니다. 원문의 타원형 분포 우도 추정을 그대로 재현하지 않습니다. 정규 잔차 가정과 같은 비중으로 비교합니다.',
    risk: '최소 300개 공통 관측이 필요합니다. 표본 밖의 위기는 여전히 누락될 수 있습니다. 모의 빈도는 실제 미래 확률이 아닙니다.',
    question: '동일한 포트폴리오를 정규 잔차와 두꺼운 꼬리로 평가하면 손실 추정이 얼마나 달라질까?',
    recipe: { stressTest: true, trainYears: 3, riskModel: 'garch', terms:[{feature:'return20',weight:1}] } },
);
references.push(
  { id: 'joint-risk', title: '여러 종목을 샀는데 같이 떨어진다면', author: 'Kim · Yoon · Hwang', year: '2020',
    url: 'https://doi.org/10.5351/KJAS.2020.33.3.297', hypothesis: '종목들이 함께 오르내리는 정도를 보고 투자 금액을 줄일지 판단한다.',
    original: 'EWMA·CCC·DCC·BEKK로 장중 시간대별 변동성을 추정하고 함수형 변동성과 비교합니다.',
    adaptation: '선택한 종목들의 일별 수익률에 DCC를 적용합니다. 공동 위험은 포트폴리오의 비중과 공분산으로 계산합니다.',
    risk: '과거 상관관계와 다른 충격이 발생할 수 있습니다. 비중을 줄인 뒤 반등을 놓칠 수도 있습니다.',
    question: '같은 종목 선정에서 공동 위험을 반영하면 손실과 투자 비중이 어떻게 달라질까?',
    recipe: { riskModel: 'dcc', comparison: 'risk', trainYears: 3, terms:[{feature:'return20',weight:1}] } },
  { id: 'hypothesis-axis', title: '내 기준을 담아 지표 조합하기', author: 'Yoon · Han · Hwang', year: '2025',
    url: 'https://doi.org/10.5351/KJAS.2025.38.4.455', hypothesis: '내가 중요하게 보는 기준을 첫 요약값에 담고 나머지 정보의 조합을 데이터에서 찾는다.',
    original: '실현변동성을 첫 축으로 지정하고 장중 수익률 제곱의 나머지 패턴을 주성분으로 요약합니다.',
    adaptation: '선택한 일별 지표를 학습 자료로 표준화합니다. 사용자의 가중치로 첫 축을 정하고 나머지 직교 축을 학습합니다.',
    risk: '큰 변동을 설명하는 축이 미래 수익을 잘 예측하는 축이라는 보장은 없습니다.',
    question: '같은 지표와 모델에서 원래 입력·PCA·가설을 유지한 PCA는 어떤 차이가 날까?',
    recipe: { method:'ridge', reduction:'anchoredPca',components:2,comparison:'reduction',
      terms:[{feature:'return20',weight:1},{feature:'return60',weight:1},{feature:'vol20',weight:-1},{feature:'volume20',weight:.5}] } },
);
function template(id) {
  const ref = references.find(r => r.id === id);
  return { ...structuredClone(base), ...(ref?.recipe ? structuredClone(ref.recipe) : {}), referenceId: ref?.recipe ? id : null,
    name: ref?.recipe ? ref.title : base.name, hypothesis: ref?.recipe ? ref.hypothesis : '' };
}
module.exports = { features, references, template, base };
