const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const compact = (value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });

/** 가격과 단위가 다른 지표는 각각의 축으로 그린다. null은 선으로 연결하지 않는다. */
export default function ChartIndicatorPanel({
  title, description, lines = [], bars, guides = [], bounds, width, count, suffix = '',
  unavailable = '계산에 필요한 과거 기록이 부족합니다.',
}) {
  const height = 100;
  const pad = 8;
  const all = [...lines.flatMap((line) => line.values), ...(bars?.values || [])].filter(finite);
  const domain = [...all, ...guides, ...(bars ? [0] : [])];
  const low = domain.length ? Math.min(...domain) : 0;
  const high = domain.length ? Math.max(...domain) : 1;
  const min = bounds?.[0] ?? (low === high ? low - 1 : low);
  const max = bounds?.[1] ?? (low === high ? high + 1 : high);
  const span = max - min || 1;
  const x = (i) => pad + i / Math.max(1, count - 1) * (width - pad * 2);
  const y = (value) => height - pad - (value - min) / span * (height - pad * 2);
  const barWidth = Math.max(0.5, (width - 2 * pad) / count * 0.65);
  const pathOf = (values) => {
    let drawing = false;
    return values.map((value, i) => {
      if (!finite(value)) { drawing = false; return ''; }
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command}${x(i).toFixed(2)},${y(value).toFixed(2)}`;
    }).join('');
  };
  return (
    <section className="chart-indicator-panel" aria-label={title}>
      <div className="chart-indicator-head">
        <b>{title}</b>
        <div className="chart-legend">
          {[...(bars ? [bars] : []), ...lines].map((line) => (
            <span key={line.label}>
              <i style={{ backgroundColor: line.color || '#8a8f98' }} />
              {line.label} {finite(line.values.at(-1)) ? `${compact(line.values.at(-1))}${suffix}` : '—'}
            </span>
          ))}
        </div>
      </div>
      {all.length > 0 ? (
        <svg className="indicator-chart" viewBox={`0 0 ${width} ${height}`} width="100%"
          role="img" aria-label={`${title} 차트`}>
          {guides.map((guide) => (
            <g key={guide}>
              <line className="rsi-guide" x1={pad} x2={width - pad} y1={y(guide)} y2={y(guide)} />
              <text className="rsi-axis-label" x={pad + 2} y={y(guide) - 2}>{guide}{suffix}</text>
            </g>
          ))}
          {bars?.values.map((value, i) => finite(value) && (
            <rect key={i} x={x(i) - barWidth / 2} y={Math.min(y(0), y(value))}
              width={barWidth} height={Math.abs(y(value) - y(0))}
              fill={bars.colors?.[i] || (value >= 0 ? '#e2504c' : '#3b6fd4')} opacity="0.7">
              <title>{bars.label} {compact(value)}{suffix}</title>
            </rect>
          ))}
          {lines.map((line) => (
            <path key={line.label} d={pathOf(line.values)} fill="none" stroke={line.color} strokeWidth="1.5" />
          ))}
          <text x={width - pad} y={12} textAnchor="end" className="chart-label">{compact(max)}{suffix}</text>
          <text x={width - pad} y={height - 2} textAnchor="end" className="chart-label">{compact(min)}{suffix}</text>
        </svg>
      ) : <p className="indicator-unavailable">{unavailable}</p>}
      <p className="chart-indicator-description">{description}</p>
      {all.length > 0 && [...lines, ...(bars ? [bars] : [])].some((line) => !finite(line.values.at(-1)))
        && <p className="indicator-unavailable">일부 값은 기록 부족으로 표시하지 못했습니다.</p>}
    </section>
  );
}
