// 경량 SVG 차트 — 라인/캔들 + 기술적 지표 오버레이 (미팅5 §1)
//
// 캔들은 서버가 주·월 단위로 집계한 OHLC를 그대로 그린다. indicatorSeries에는 상장 이후
// 전체 이력을 받고, 그 전체에서 지표를 계산한 뒤 visibleStart부터 화면 길이만큼 자른다.
// 따라서 확대·축소해도 같은 날짜의 MA/볼린저/RSI 값은 바뀌지 않는다.
import {
  movingAverage, bollingerBands, rsi, exponentialMovingAverage, macd,
  rateOfChange, disparity, rollingVolatility, onBalanceVolume,
} from '../utils/chartIndicators';
import { relativeYearDate } from '../utils/format';
import ChartIndicatorPanel from './ChartIndicatorPanel';

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

const priceOf = (point) => Number(point?.price ?? point?.close ?? point?.value);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const maColor = (window, index) => MA_STYLES[window] || MA_PALETTE[index % MA_PALETTE.length];

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
  if (overlays.ema) {
    const period = overlays.ema.period || 20;
    layers.push({
      key: 'ema', label: `EMA ${period}${barUnitLabel}봉`,
      values: clipToVisible(exponentialMovingAverage(fullPrices, period)), color: '#65cbb8',
    });
  }
  if (overlays.bollinger) {
    const period = overlays.bollinger.period || 20;
    const multiplier = overlays.bollinger.multiplier || 2;
    const bb = bollingerBands(fullPrices, period, multiplier);
    layers.push({
      key: 'bb-upper',
      label: `볼린저 ${period}${barUnitLabel}봉 · ${multiplier}배`,
      values: clipToVisible(bb.upper),
      color: BB_COLOR,
      dash: '4 3',
    });
    layers.push({
      key: 'bb-mid', values: clipToVisible(bb.mid), color: BB_COLOR, dash: '2 3',
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
  const legendItems = layers.filter((layer) => layer.label);
  const panels = [];
  const addLine = (key, title, values, options = {}) => panels.push({
    key, title, lines: [{ label: title, values: clipToVisible(values), color: '#e8a33d' }], ...options,
  });
  if (overlays.rsi) {
    const period = overlays.rsi.period || 14;
    addLine('rsi', `RSI · ${period}${barUnitLabel}봉`, rsi(fullPrices, period), {
      guides: [30, 70], bounds: [0, 100], description: '70과 30은 상승·하락 쏠림을 살펴보는 기준선입니다.',
    });
  }
  if (overlays.macd) {
    const { fast = 12, slow = 26, signal = 9 } = overlays.macd;
    const values = macd(fullPrices, fast, slow, signal);
    panels.push({
      key: 'macd', title: `MACD · ${fast}/${slow}/${signal}${barUnitLabel}봉`, guides: [0],
      lines: [
        { label: 'MACD', values: clipToVisible(values.line), color: '#e8a33d' },
        { label: '신호선', values: clipToVisible(values.signal), color: '#65a6e8' },
      ],
      bars: { label: '두 선의 차이', values: clipToVisible(values.histogram) },
      description: 'MACD는 짧은 평균선에서 긴 평균선을 뺀 값입니다. 막대는 MACD와 신호선의 간격입니다.',
    });
  }
  if (overlays.roc) {
    const period = overlays.roc.period || 10;
    addLine('roc', `가격 변화율 · ${period}${barUnitLabel}봉`, rateOfChange(fullPrices, period), {
      guides: [0], suffix: '%', description: `${period}개 봉 전 가격과 비교한 변화율입니다.`,
    });
  }
  if (overlays.disparity) {
    const period = overlays.disparity.period || 20;
    addLine('disparity', `이격도 · ${period}${barUnitLabel}봉`, disparity(fullPrices, period), {
      guides: [100], description: '100이면 평균 가격과 같습니다. 105이면 평균보다 5% 높습니다.',
    });
  }
  if (overlays.volatility) {
    const period = overlays.volatility.period || 20;
    addLine('volatility', `변동성 · ${period}${barUnitLabel}봉`, rollingVolatility(fullPrices, period), {
      guides: [0], suffix: '%', description: '봉별 로그수익률의 표준편차입니다. 값이 클수록 변동이 불규칙했습니다. 연간 수치로 환산하지 않습니다.',
    });
  }
  const history = hasValidFullHistory ? indicatorSeries : series;
  const volumes = history.map((point) => finite(point.volume) && Number(point.volume) >= 0 ? Number(point.volume) : null);
  if (overlays.volume) {
    const period = overlays.volume.period || 20;
    const colors = fullPrices.map((price, i) => i === 0 || price >= fullPrices[i - 1] ? UP : DOWN);
    panels.push({
      key: 'volume', title: '거래량', guides: [0], suffix: '주',
      lines: [{ label: `${period}${barUnitLabel}봉 평균`, values: clipToVisible(movingAverage(volumes, period)), color: '#e8a33d' }],
      bars: { label: '거래량', values: clipToVisible(volumes), colors: clipToVisible(colors) },
      description: '실제 거래된 주식 수입니다. 주봉·월봉은 해당 기간의 거래량을 합산합니다.',
      unavailable: '이 구간의 거래량 기록이 없습니다.',
    });
  }
  if (overlays.obv) {
    addLine('obv', '누적 거래량 · OBV', onBalanceVolume(fullPrices, volumes), {
      suffix: '주', description: '상승한 봉의 거래량은 더하고 하락한 봉의 거래량은 뺍니다. 같은 가격이면 유지합니다.',
      unavailable: 'OBV 계산에 필요한 연속된 거래량 기록이 없습니다.',
    });
  }

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
      {layers.some((layer) => !layer.values.some(finite)) && (
        <p className="indicator-unavailable">일부 평균선은 계산에 필요한 과거 기록이 부족합니다.</p>
      )}
      {panels.map(({ key, ...panel }) => (
        <ChartIndicatorPanel key={key} {...panel} width={width} count={series.length} />
      ))}
    </div>
  );
}
