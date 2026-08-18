// 공용 표기 유틸
export const won = (v) =>
  v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`;

export const pct = (v, digits = 2) =>
  v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`;

/** 등락 부호/색상 클래스 */
export const changeClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
export const signed = (v, digits = 2) =>
  v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

const yearFrom = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getUTCFullYear();
  }
  const match = /^(\d{4})(?:$|[-/.])/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 2999 ? year : null;
};

/** 게임의 현재 날짜/연도 기준 YYYY -> 'n년 전/후' (같은 해는 '올해') */
export const relativeYearLabel = (value, referenceDateOrYear) => {
  const year = yearFrom(value);
  const referenceYear = yearFrom(referenceDateOrYear);
  if (year === null || referenceYear === null) return '연도 미상';
  const yearsAgo = referenceYear - year;
  if (yearsAgo === 0) return '올해';
  return yearsAgo > 0 ? `${yearsAgo}년 전` : `${Math.abs(yearsAgo)}년 후`;
};

/** 'YYYY-MM-DD' -> '게임의 현재 연도 기준 n년 전/후 MM/DD' */
export const relativeYearDate = (value, referenceDateOrYear) => {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(iso);
  if (!match) return '날짜 미상';
  const monthDay = `${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
  const yearLabel = relativeYearLabel(match[1], referenceDateOrYear);
  return yearLabel === '올해' ? monthDay : `${yearLabel} ${monthDay}`;
};

/** 만기 같은 YYYY[-MM[-DD]] 표시만 상대 연도로 바꾸고, '3년' 같은 기간값은 보존한다. */
export const relativeDateValue = (value, referenceDateOrYear) => {
  if (value === null || value === undefined || value === '') return '-';
  const text = String(value).trim();
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text)) return relativeYearDate(text, referenceDateOrYear);
  const yearMonth = /^(\d{4})[-/.](\d{1,2})$/.exec(text);
  if (yearMonth) {
    const month = `${yearMonth[2].padStart(2, '0')}월`;
    const yearLabel = relativeYearLabel(yearMonth[1], referenceDateOrYear);
    return yearLabel === '올해' ? month : `${yearLabel} ${month}`;
  }
  if (/^\d{4}$/.test(text)) return relativeYearLabel(text, referenceDateOrYear);
  return text;
};
