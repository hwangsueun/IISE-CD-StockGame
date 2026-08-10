// 경량 SVG 차트 — 라인/캔들 + 기술적 지표 오버레이 (미팅5 §1)
// 지표: 이동평균(5/10/60/120), 볼린저밴드(20, 2σ), RSI(14)
//
// 캔들은 서버가 interval>=2로 집계해 준 봉을 그대로 그린다(pricingService.getPriceSeries).
// 원천에 OHLC가 없어 종가를 N거래일씩 리샘플링한 것이라 **장중 고저가 반영되지 않는다**
// — 실제 캔들보다 꼬리가 짧다. interval=1이면 봉 하나에 점 하나뿐이라 캔들이 성립하지
// 않으므로 라인으로 그린다(series에 open/close가 없으면 자동으로 라인 모드).
import { movingAverage, bollingerBands, rsi } from '../utils/chartIndicators';

const MA_STYLES = { 5: '#e8a33d', 10: '#4caf7d', 60: '#b57edc', 120: '#8a8f98' };
const UP = '#e2504c';   // 상승 (종가 >= 시가)
const DOWN = '#3b6fd4'; // 하락

export default function PriceChart({ series, overlays = {}, width = 560, height = 220 }) {
  if (!series || series.length < 2) return <div className="chart-empty">차트 데이터 없음</div>;

  // 서버가 OHLC를 보내주면 캔들, 아니면 라인
  const isCandle = series[0] && series[0].open !== undefined && series[0].close !== undefined;
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

  // y 스케일은 가격+오버레이 전체 범위 기준. 캔들이면 고가·저가까지 포함해야 꼬리가 안 잘린다
  const all = [
    ...prices,
    ...(isCandle ? series.flatMap((p) => [p.high, p.low]) : []),
    ...layers.flatMap((l) => l.values.filter((v) => v !== null)),
  ];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 8;
  const x = (i) => pad + (i / (prices.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  // 봉 너비: 슬롯의 62%를 몸통으로 쓰고 최소 1.5px는 확보한다(봉이 많으면 실선처럼 보임)
  const slot = (width - pad * 2) / Math.max(1, prices.length);
  const bodyW = Math.max(1.5, slot * 0.62);
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
        {isCandle
          ? series.map((b, i) => {
              const up = b.close >= b.open;
              const c = up ? UP : DOWN;
              const cx = x(i);
              const yo = y(b.open);
              const yc = y(b.close);
              const top = Math.min(yo, yc);
              // 시가==종가면 몸통 높이가 0이라 안 보인다 — 최소 1px 확보(도지 표현)
              const h = Math.max(1, Math.abs(yc - yo));
              return (
                <g key={b.date}>
                  <line x1={cx} y1={y(b.high)} x2={cx} y2={y(b.low)} stroke={c} strokeWidth="1" />
                  <rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={c} />
                  <title>
                    {`${b.from ?? b.date} ~ ${b.date} (${b.days ?? '-'}거래일)\n`}
                    {`시 ${b.open.toLocaleString('ko-KR')}  고 ${b.high.toLocaleString('ko-KR')}\n`}
                    {`저 ${b.low.toLocaleString('ko-KR')}  종 ${b.close.toLocaleString('ko-KR')}`}
                    {b.changeRate != null ? `\n${(b.changeRate * 100).toFixed(2)}%` : ''}
                  </title>
                </g>
              );
            })
          : <path d={pathOf(prices)} fill="none" stroke={rising ? UP : DOWN} strokeWidth="2" />}
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
