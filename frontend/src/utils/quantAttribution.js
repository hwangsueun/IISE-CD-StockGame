export function summarizeContributions(features) {
  const sorted = [...features].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.name.localeCompare(b.name));
  const positive = sorted.filter(f => f.contribution > 0), negative = sorted.filter(f => f.contribution < 0);
  return { sorted, positive: positive.slice(0, 5), negative: negative.slice(0, 5),
    positiveTotal: positive.reduce((s, f) => s + f.contribution, 0),
    negativeTotal: negative.reduce((s, f) => s + f.contribution, 0) };
}

/** Compare the selected stock's largest contributions using the exact same evaluation model. */
export function compareContributions(primary, secondary, limit = 5) {
  const identity = ['decisionDate', 'signalDate', 'modelVersion', 'modelId', 'modelSha256', 'artifactSha256'];
  if (!primary || !secondary || identity.some(key => !primary[key] || primary[key] !== secondary[key])) {
    return { comparable: false, reason: '평가일이나 모델이 달라 함께 비교할 수 없어요. 분석을 다시 불러와 주세요.', rows: [] };
  }
  const other = new Map(secondary.features.map(feature => [feature.name, feature]));
  if (primary.features.length !== secondary.features.length || primary.features.some(feature => !other.has(feature.name))) {
    return { comparable: false, reason: '두 종목의 지표 자료가 일치하지 않아요. 분석을 다시 불러와 주세요.', rows: [] };
  }
  return {
    comparable: true,
    reason: null,
    rows: summarizeContributions(primary.features).sorted.filter(feature => feature.contribution !== 0).slice(0, limit)
      .map(feature => ({ name: feature.name, primary: feature, secondary: other.get(feature.name) })),
  };
}
export function contributionPoints(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%p`;
}

export function indicatorValue(value) {
  if (!Number.isFinite(value)) return { text: '자료 없음', exact: undefined, rounded: false };
  const rounded = Number(value.toPrecision(7)) !== value;
  return {
    text: `${rounded ? '약 ' : ''}${value.toLocaleString('ko-KR', { maximumSignificantDigits: 7 })}`,
    exact: String(value),
    rounded,
  };
}
