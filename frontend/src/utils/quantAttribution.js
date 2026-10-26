export function summarizeContributions(features) {
  const sorted = [...features].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.name.localeCompare(b.name));
  const positive = sorted.filter(f => f.contribution > 0), negative = sorted.filter(f => f.contribution < 0);
  return { sorted, positive: positive.slice(0, 5), negative: negative.slice(0, 5),
    positiveTotal: positive.reduce((s, f) => s + f.contribution, 0),
    negativeTotal: negative.reduce((s, f) => s + f.contribution, 0) };
}
export function contributionPoints(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%p`;
}
