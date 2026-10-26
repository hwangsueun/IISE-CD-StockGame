const TURNS_PER_MONTH = 20;
const TOTAL_TURNS = 240;

export const hasReachedEndingDeadline = turns => Number(turns) >= TOTAL_TURNS;

/** The game uses 20 turns per month; preserve partial months in early endings. */
export function gameDuration(turns) {
  const days = Math.max(1, Math.floor(Number(turns) || 1));
  if (days === TOTAL_TURNS) return '1년';
  const months = Math.floor(days / TURNS_PER_MONTH);
  const remaining = days % TURNS_PER_MONTH;
  return [months ? `${months}개월` : '', remaining ? `${remaining}일` : ''].filter(Boolean).join(' ');
}
