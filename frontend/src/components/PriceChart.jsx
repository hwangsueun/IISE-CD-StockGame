// 경량 SVG 라인 차트 + 기술적 지표 오버레이 (미팅5 §1)
// 지표: 이동평균(5/10/60/120), 볼린저밴드(20, 2σ), RSI(14)
// TODO(frontend): 디자인 확정 시 캔들차트/거래량 바 추가
import { movingAverage, bollingerBands, rsi } from '../utils/chartIndicators';

const MA_STYLES = { 5: '#e8a33d', 10: '#4caf7d', 60: '#b57edc', 120: '#8a8f98' };

export default function PriceChart({ series, overlays = {}, width = 560, height = 220 }) {
  if (!series || series.length < 2) return <div className="chart-empty">차트 데이터 없음</div>;

  const prices = series.map((p) => p.price ?? p.value);
  const layers = []; // {values, color, dash?}

  if (overlays.ma) {
    for (const w of overlays.ma) {
      layers.push({ values: movingAverage(prices, w), color: MA_STYLES[w] || '#666' });
    }
  }
  if (overlays.bollinger) {
    const bb = bollingerBands(prices);
    layers.push({ values: bb.upper, color: '#5a6acf', dash: '4 3' });
    layers.push({ values: bb.lower, color: '#5a6acf', dash: '4 3' });
  }

  // y 스케일은 가격+오버레이 전체 범위 기준
  const all = [...prices, ...layers.flatMap((l) => l.values.filter((v) => v !== null))];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 8;
  const x = (i) => pad + (i / (prices.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const pathOf = (values) => {
    let d = '';
    values.forEach((v, i) => {
      if (v === null) return;
      d += `${d === '' ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };

  const rising = prices[prices.length - 1] >= prices[0];
  const rsiValues = overlays.rsi ? rsi(prices) : null;
  const lastRsi = rsiValues ? rsiValues[rsiValues.length - 1] : null;

  return (
    <div>
      <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} width="100%">
        {layers.map((l, i) => (
          <path key={i} d={pathOf(l.values)} fill="none" stroke={l.color}
                strokeWidth="1" strokeDasharray={l.dash} opacity="0.9" />
        ))}
        <path d={pathOf(prices)} fill="none" stroke={rising ? '#e2504c' : '#3b6fd4'} strokeWidth="2" />
        <text x={pad} y={12} className="chart-label">{max.toLocaleString('ko-KR')}</text>
        <text x={pad} y={height - 2} className="chart-label">{min.toLocaleString('ko-KR')}</text>
      </svg>
      {lastRsi !== null && (
        <p className="rsi-label">
          RSI(14): <b className={lastRsi >= 70 ? 'up' : lastRsi <= 30 ? 'down' : ''}>{lastRsi?.toFixed(1) ?? '-'}</b>
          {lastRsi >= 70 ? ' (과열)' : lastRsi <= 30 ? ' (침체)' : ''}
        </p>
      )}
    </div>
  );
}
