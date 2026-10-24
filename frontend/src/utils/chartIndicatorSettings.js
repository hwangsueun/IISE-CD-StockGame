// 설정과 설명을 한곳에서 관리한다. 기간 단위는 현재 선택한 일/주/월봉이다.
export const INDICATOR_DEFAULTS = {
  ema: { enabled: false, period: 20 },
  bollinger: { enabled: false, period: 20, multiplier: 2 },
  rsi: { enabled: false, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  roc: { enabled: false, period: 10 },
  disparity: { enabled: false, period: 20 },
  volatility: { enabled: false, period: 20 },
  volume: { enabled: false, period: 20 },
  obv: { enabled: false },
};

const period = { key: 'period', label: '기간', min: 2, max: 240, step: 1 };
export const INDICATOR_GROUPS = [
  {
    label: '가격 위에 표시',
    items: [
      { key: 'ema', name: '최근 가격에 민감한 평균선 · EMA',
        help: '최근 가격에 더 큰 비중을 주는 평균선입니다.', fields: [period] },
      { key: 'bollinger', name: '가격의 변동 범위 · 볼린저 밴드',
        help: '최근 가격이 흔들린 폭을 보여줍니다. 폭이 넓을수록 변동이 컸습니다.',
        fields: [period, { key: 'multiplier', label: '밴드 폭', min: 0.5, max: 4, step: 0.5, suffix: '배' }] },
    ],
  },
  {
    label: '가격 아래에 표시',
    items: [
      { key: 'rsi', name: '상승과 하락의 힘 · RSI',
        help: '0~100으로 표시합니다. 70과 30 기준선으로 최근 상승·하락 쏠림을 살펴봅니다.', fields: [period] },
      { key: 'macd', name: '추세의 변화 · MACD',
        help: '짧은 평균선과 긴 평균선의 차이입니다. 신호선은 그 차이의 평균입니다. 막대는 두 선의 간격입니다.',
        fields: [
          { key: 'fast', label: '짧은 기간', min: 2, max: 239, step: 1 },
          { key: 'slow', label: '긴 기간', min: 3, max: 240, step: 1 },
          { key: 'signal', label: '신호 기간', min: 2, max: 120, step: 1 },
        ] },
      { key: 'roc', name: '기간 동안의 가격 변화 · ROC',
        help: '설정한 기간 전보다 가격이 몇 % 올랐거나 내렸는지 보여줍니다.', fields: [period] },
      { key: 'disparity', name: '평균 가격과의 거리 · 이격도',
        help: '100이면 평균과 같은 가격입니다. 105이면 평균보다 5% 높은 가격입니다.', fields: [period] },
      { key: 'volatility', name: '수익률이 흔들린 정도 · 변동성',
        help: '봉별 수익률의 들쭉날쭉한 정도입니다. 값이 클수록 가격 변화가 불규칙했습니다.', fields: [period] },
      { key: 'volume', name: '거래된 주식 수 · 거래량',
        help: '막대는 거래량입니다. 평균선과 비교해 거래가 평소보다 활발했는지 확인합니다.', fields: [{ ...period, label: '평균 기간' }] },
      { key: 'obv', name: '가격 방향에 따른 누적 거래량 · OBV',
        help: '가격이 오른 봉의 거래량은 더하고 내린 봉의 거래량은 뺍니다. 값 자체보다 흐름을 봅니다.', fields: [] },
    ],
  },
];
