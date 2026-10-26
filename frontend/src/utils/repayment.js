const WEEKDAY_LABELS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** 상환 방문은 해당 턴을 마친 뒤 다음 평일에 일어난다. 게임 날짜는 YYYY-MM-DD 형식이다. */
export function repaymentVisitWeekday(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return '';
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) return '';

  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return WEEKDAY_LABELS[date.getUTCDay()];
}
