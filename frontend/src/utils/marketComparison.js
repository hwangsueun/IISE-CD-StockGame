export function percentagePoints(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10000) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%p`;
}
