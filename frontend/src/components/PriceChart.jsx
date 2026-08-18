// 경량 SVG 차트 — 라인/캔들 + 기술적 지표 오버레이 (미팅5 §1)
//
// 캔들은 서버가 주·월 단위로 집계한 OHLC를 그대로 그린다. indicatorSeries에는 상장 이후
// 전체 이력을 받고, 그 전체에서 지표를 계산한 뒤 visibleStart부터 화면 길이만큼 자른다.
// 따라서 확대·축소해도 같은 날짜의 MA/볼린저/RSI 값은 바뀌지 않는다.
import { movingAverage, bollingerBands, rsi } from '../utils/chartIndicators';
import { relativeYearDate } from '../utils/format';

const MA_STYLES = {
  5: '#e8a33d',
  10: '#4caf7d',
  20: '#e56b9f',
  60: '#b57edc',
  120: '#8a8f98',
};
const MA_PALETTE = ['#e8a33d', '#4caf7d', '#e56b9f', '#b57edc', '#65a6e8', '#d4c05d', '#d97a55'];
const UP = '#e2504c';
const DOWN = '#3b6fd4';
const BB_COLOR = '#7183ef';
const RSI_COLOR = '#e8a33d';

const priceOf = (point) => Number(point?.price ?? point?.close ?? point?.value);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const maColor = (window, index) => MA_STYLES[window] || MA_PALETTE[index % MA_PALETTE.length];

function lastFinite(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (finite(values[index])) return Number(values[index]);
  }
  return null;
}

export default function PriceChart({
  series,
  indicatorSeries = series,
  visibleStart = 0,
  overlays = {},
  barUnitLabel = '일',
  referenceDate,
  width = 560,
  height = 220,
}) {
  if (!series || series.length === 0) {
    return <div className="chart-empty">차트 데이터 없음</div>;
  }
  if (series.length < 2) {
    return <div className="chart-empty">차트를 그리려면 봉이 2개 이상 필요합니다. (현재 1개)</div>;
  }

  const prices = series.map(priceOf);
  if (prices.some((value) => !finite(value))) {
    return <div className="chart-empty">가격 데이터 형식을 확인할 수 없습니다.</div>;
  }

  // 전달된 전체 이력이 유효하지 않으면 현재 화면 구간만으로 안전하게 폴백한다.
  const candidateFullPrices = Array.isArray(indicatorSeries) ? indicatorSeries.map(priceOf) : [];
  const hasValidFullHistory = candidateFullPrices.length >= series.length
    && candidateFullPrices.every(finite);
  const fullPrices = hasValidFullHistory ? candidateFullPrices : prices;
  const maxStart = Math.max(0, fullPrices.length - series.length);
  const safeVisibleStart = hasValidFullHistory
    ? Math.min(maxStart, Math.max(0, Number(visibleStart) || 0))
    : 0;
  const clipToVisible = (values) => values.slice(safeVisibleStart, safeVisibleStart + series.length);

  // 서버가 OHLC를 보내주면 캔들, 아니면 라인. mock의 close-only 응답은 라인이다.
  const isCandle = series.every((point) => ['open', 'high', 'low', 'close'].every((key) => finite(point?.[key])));
  const maWindows = Array.isArray(overlays.ma)
    ? [...new Set(overlays.ma.filter((window) => Number.isInteger(window) && window >= 2))]
    : [];
  const layers = [];

  maWindows.forEach((window, index) => {
    layers.push({
      key: `ma-${window}`,
      label: `MA ${window}${barUnitLabel}봉`,
      values: clipToVisible(movingAverage(fullPrices, window)),
      color: maColor(window, index),
    });
  });
  if (overlays.bollinger) {
    const bb = bollingerBands(fullPrices);
    layers.push({
      key: 'bb-upper',
      label: `볼린저(20${barUnitLabel}봉)`,
      values: clipToVisible(bb.upper),
      color: BB_COLOR,
      dash: '4 3',
    });
    layers.push({
      key: 'bb-lower',
      values: clipToVisible(bb.lower),
      color: BB_COLOR,
      dash: '4 3',
    });
  }

  // y 스케일은 가격+현재 화면에 보이는 오버레이 기준. 캔들이면 고가·저가도 포함한다.
  const all = [
    ...prices,
    ...(isCandle ? series.flatMap((point) => [Number(point.high), Number(point.low)]) : []),
    ...layers.flatMap((layer) => layer.values.filter(finite).map(Number)),
  ].filter(finite);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 8;
  const x = (index) => pad + (index / (prices.length - 1)) * (width - pad * 2);
  const y = (value) => height - pad - ((Number(value) - min) / span) * (height - pad * 2);

  // 봉 너비: 슬롯의 62%를 몸통으로 쓰고 최소 1.5px는 확보한다.
  const slot = (width - pad * 2) / Math.max(1, prices.length);
  const bodyW = Math.max(1.5, slot * 0.62);
  const pathOf = (values, yScale = y) => {
    let path = '';
    let drawing = false;
    values.forEach((value, index) => {
      if (!finite(value)) {
        drawing = false;
        return;
      }
      path += `${drawing ? 'L' : 'M'}${x(index).toFixed(1)},${yScale(Number(value)).toFixed(1)}`;
      drawing = true;
    });
    return path;
  };

  const rising = prices[prices.length - 1] >= prices[0];
  const fullRsi = overlays.rsi ? rsi(fullPrices) : null;
  const rsiValues = fullRsi ? clipToVisible(fullRsi) : [];
  const latestRsi = lastFinite(rsiValues);
  const legendItems = [
    ...layers.filter((layer) => layer.label),
    ...(overlays.rsi ? [{ key: 'rsi', label: `RSI(14${barUnitLabel}봉)`, color: RSI_COLOR }] : []),
  ];

  const rsiHeight = 76;
  const rsiPadY = 8;
  const rsiY = (value) => rsiPadY + ((100 - value) / 100) * (rsiHeight - rsiPadY * 2);

  return (
    <div className="chart-stack">
      {legendItems.length > 0 && (
        <div className="chart-legend" aria-label="활성 차트 지표 범례">
          {legendItems.map((item) => (
            <span key={item.key}>
              <i style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
      )}
      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`${barUnitLabel}봉 가격 차트`}
      >
        {layers.map((layer) => (
          <path
            key={layer.key}
            d={pathOf(layer.values)}
            fill="none"
            stroke={layer.color}
            strokeWidth="1"
            strokeDasharray={layer.dash}
            opacity="0.9"
          />
        ))}
        {isCandle
          ? series.map((bar, index) => {
              const open = Number(bar.open);
              const close = Number(bar.close);
              const high = Number(bar.high);
              const low = Number(bar.low);
              const up = close >= open;
              const color = up ? UP : DOWN;
              const cx = x(index);
              const yo = y(open);
              const yc = y(close);
              const top = Math.min(yo, yc);
              const candleHeight = Math.max(1, Math.abs(yc - yo));
              return (
                <g key={`${bar.date}-${index}`}>
                  <line x1={cx} y1={y(high)} x2={cx} y2={y(low)} stroke={color} strokeWidth="1" />
                  <rect x={cx - bodyW / 2} y={top} width={bodyW} height={candleHeight} fill={color} />
                  <title>
                    {`${relativeYearDate(bar.from ?? bar.date, referenceDate)} ~ ${relativeYearDate(bar.date, referenceDate)} (${bar.days ?? '-'}거래일)\n`}
                    {`시 ${open.toLocaleString('ko-KR')}  고 ${high.toLocaleString('ko-KR')}\n`}
                    {`저 ${low.toLocaleString('ko-KR')}  종 ${close.toLocaleString('ko-KR')}`}
                    {bar.changeRate != null ? `\n${(Number(bar.changeRate) * 100).toFixed(2)}%` : ''}
                  </title>
                </g>
              );
            })
          : <path d={pathOf(prices)} fill="none" stroke={rising ? UP : DOWN} strokeWidth="2" />}
        <text x={pad} y={12} className="chart-label">{max.toLocaleString('ko-KR')}</text>
        <text x={pad} y={height - 2} className="chart-label">{min.toLocaleString('ko-KR')}</text>
      </svg>
      {overlays.rsi && (
        <div className="rsi-panel">
          <svg
            className="rsi-chart"
            viewBox={`0 0 ${width} ${rsiHeight}`}
            width="100%"
            role="img"
            aria-label={`현재 표시 구간의 RSI 14 ${barUnitLabel}봉 차트, 기준선 30과 70`}
          >
            {[70, 30].map((guide) => (
              <g key={guide}>
                <line className="rsi-guide" x1={pad} x2={width - pad} y1={rsiY(guide)} y2={rsiY(guide)} />
                <text className="rsi-axis-label" x={pad + 2} y={rsiY(guide) - 2}>{guide}</text>
              </g>
            ))}
            <path className="rsi-line" d={pathOf(rsiValues, rsiY)} fill="none" stroke={RSI_COLOR} strokeWidth="1.5" />
          </svg>
          <p className="rsi-label">
            RSI(14{barUnitLabel}봉):{' '}
            {latestRsi === null ? (
              <b>계산 대기</b>
            ) : (
              <b className={latestRsi >= 70 ? 'up' : latestRsi <= 30 ? 'down' : ''}>{latestRsi.toFixed(1)}</b>
            )}
            {latestRsi !== null && (latestRsi >= 70 ? ' (과열)' : latestRsi <= 30 ? ' (침체)' : '')}
          </p>
        </div>
      )}
    </div>
  );
}
