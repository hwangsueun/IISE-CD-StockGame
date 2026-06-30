// 표시용 포맷 유틸 (게임 로직 아님 — 단순 표현)

export function won(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

export function num(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('ko-KR');
}

// 변동률(소수) → +1.23% 형태, 한국식 색상 클래스 동반
export function rate(value) {
  if (value == null || Number.isNaN(value)) return { text: '-', cls: 'dim' };
  const pct = (value * 100).toFixed(2);
  const sign = value > 0 ? '+' : '';
  const cls = value > 0 ? 'up' : value < 0 ? 'down' : 'dim';
  return { text: `${sign}${pct}%`, cls };
}
