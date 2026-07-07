// 공용 표기 유틸
export const won = (v) =>
  v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`;

export const pct = (v, digits = 2) =>
  v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`;

/** 등락 부호/색상 클래스 */
export const changeClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
export const signed = (v, digits = 2) =>
  v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
