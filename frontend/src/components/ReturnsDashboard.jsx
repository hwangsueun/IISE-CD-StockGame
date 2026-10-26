// 현금과 개별 보유 종목 구성 + 전체 플레이 기간의 일/주/월 단위 성과
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { won, pct } from '../utils/format';
import MarketComparison from './MarketComparison';

const BASE_COLORS = {
  cash: '#9a8d7d',
};
const HOLDING_COLORS = ['#e2504c', '#4f7ed8', '#e8a33d', '#7bb36a', '#b56bd4', '#d97945', '#55a9a5', '#d86d91'];

function DonutChart({ allocation, currentValue }) {
  const rows = allocation;
  let offset = 0;

  return (
    <div className="dash-pie-grid">
      <div className="dash-donut" role="img" aria-label="현금과 보유 주식 종목별 비중">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="dash-donut-track" cx="60" cy="60" r="46" pathLength="100" />
          {rows.map((row, index) => {
            const size = row.weight * 100;
            const start = offset;
            offset += size;
            return size > 0 ? (
              <circle
                key={row.key}
                className="dash-donut-segment"
                cx="60" cy="60" r="46" pathLength="100"
                stroke={BASE_COLORS[row.key] || HOLDING_COLORS[index % HOLDING_COLORS.length]}
                strokeDasharray={`${size} ${100 - size}`}
                strokeDashoffset={-start}
              >
                <title>{row.label} {pct(row.weight, 1)} · {won(row.value)}</title>
              </circle>
            ) : null;
          })}
        </svg>
        <div className="dash-donut-center">
          <span>현금 + 보유 주식</span>
          <b>{won(currentValue)}</b>
        </div>
      </div>

      <ul className="dash-pie-legend" aria-label="현금과 종목별 평가액">
        {rows.map((row, index) => (
          <li key={row.key}>
            <i style={{ background: BASE_COLORS[row.key] || HOLDING_COLORS[index % HOLDING_COLORS.length] }} />
            <span className="name" title={row.label}>{row.label}</span>
            <b>{pct(row.weight, 1)}</b>
            <span>{won(row.value)}</span>
          </li>
        ))}
        {rows.every((row) => row.key === 'cash') && <li className="empty">보유한 주식이 없습니다.</li>}
      </ul>
    </div>
  );
}

export default function ReturnsDashboard({ sessionId }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDashboard(null);
    setError('');
    api.getPortfolioDashboard(sessionId, 'all', 'all')
      .then((result) => { if (active) setDashboard(result); })
      .catch((err) => { if (active) setError(err.message || '대시보드를 불러오지 못했다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  return (
    <div className="dash">
      <MarketComparison />
      <section className="dash-pie-card">
        <h4 className="dash-h">포트폴리오 구성 <small>현금과 종목별 비중</small></h4>
        {dashboard ? (
          <DonutChart
            allocation={dashboard.allocation}
            currentValue={dashboard.currentValue}
          />
        ) : !loading && error ? (
          <p className="dash-error">{error}</p>
        ) : <p className="dash-empty">구성을 불러오는 중…</p>}
      </section>


    </div>
  );
}
