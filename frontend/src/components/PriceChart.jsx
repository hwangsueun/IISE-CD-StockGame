// 경량 SVG 라인 차트 (외부 라이브러리 없이) — 종목 상세/지표 차트 공용
// TODO(frontend): 디자인 확정 시 캔들차트/거래량 바 추가
export default function PriceChart({ series, width = 560, height = 220 }) {
  if (!series || series.length < 2) return <div className="chart-empty">차트 데이터 없음</div>;

  const values = series.map((p) => p.price ?? p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 8;

  const x = (i) => pad + (i / (series.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const rising = values[values.length - 1] >= values[0];

  return (
    <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} width="100%">
      <path d={path} fill="none" stroke={rising ? '#e2504c' : '#3b6fd4'} strokeWidth="2" />
      <text x={pad} y={12} className="chart-label">{max.toLocaleString('ko-KR')}</text>
      <text x={pad} y={height - 2} className="chart-label">{min.toLocaleString('ko-KR')}</text>
    </svg>
  );
}
