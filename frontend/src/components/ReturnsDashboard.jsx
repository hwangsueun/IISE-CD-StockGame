// 포트폴리오 대시보드: 자산군별 구성 파이 + 전체 플레이 기간의 일/주/월 단위 성과
// 2026-08-13: 팀원 브랜치(agent/backend-portfolio-surge) 디자인으로 전면 교체
// (구 버전: 라인차트+KPI+종목별 랭킹 — git log로 확인 가능)
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { won, pct, signed, changeClass } from '../utils/format';

const UNIT_TABS = [
  { key: 'day', label: '일', performanceLabel: '일별 성과' },
  { key: 'week', label: '주', performanceLabel: '주별 성과' },
  { key: 'month', label: '월', performanceLabel: '월별 성과' },
  { key: 'all', label: '전체', performanceLabel: '누적 성과' },
];
const TYPE_LABEL = { all: '전체', stock: '주식', bond: '채권', coin: '코인' };
const BASE_COLORS = {
  cash: '#9a8d7d', stock: '#e2504c', bond: '#4f7ed8', coin: '#e8a33d',
};
const HOLDING_COLORS = ['#e2504c', '#4f7ed8', '#e8a33d', '#7bb36a', '#b56bd4', '#d97945', '#55a9a5', '#d86d91'];

const signedWon = (value) => {
  if (value === null || value === undefined) return '-';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('ko-KR')}원`;
};

function chartRows(allocation, assetType) {
  if (allocation.length <= 8) return allocation;
  const visible = allocation.slice(0, 7);
  const rest = allocation.slice(7).reduce((sum, row) => sum + row.value, 0);
  const total = visible.reduce((sum, row) => sum + row.value, rest);
  return [
    ...visible.map((row) => ({ ...row, weight: total ? row.value / total : 0 })),
    { key: `${assetType}-other`, label: `기타 ${allocation.length - 7}종`, value: rest, weight: total ? rest / total : 0 },
  ];
}

function DonutChart({ allocation, assetType, currentValue }) {
  const rows = useMemo(() => chartRows(allocation, assetType), [allocation, assetType]);
  let offset = 0;

  return (
    <div className="dash-pie-grid">
      <div className="dash-donut" role="img" aria-label={`${TYPE_LABEL[assetType]} 자산 구성 파이차트`}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="dash-donut-track" cx="60" cy="60" r="46" pathLength="100" />
          {rows.map((row, index) => {
            const size = row.weight * 100;
            const start = offset;
            offset += size;
            return (
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
            );
          })}
        </svg>
        <div className="dash-donut-center">
          <span>{TYPE_LABEL[assetType]} 평가액</span>
          <b>{won(currentValue)}</b>
        </div>
      </div>

      <ul className="dash-pie-legend">
        {rows.map((row, index) => (
          <li key={row.key}>
            <i style={{ background: BASE_COLORS[row.key] || HOLDING_COLORS[index % HOLDING_COLORS.length] }} />
            <span className="name" title={row.label}>{row.label}</span>
            <b>{pct(row.weight, 1)}</b>
            <span>{won(row.value)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="empty">현재 보유한 {TYPE_LABEL[assetType]} 자산이 없다.</li>}
      </ul>
    </div>
  );
}

function PeriodTable({ periods, unit }) {
  if (!periods.length) {
    return <p className="dash-empty">아직 성과 기록이 없다.</p>;
  }
  return (
    <div className="dash-period-scroll">
      <table className="data-table dash-period-table">
        <thead>
          <tr><th>기간</th><th>마감 평가액</th><th>손익</th><th>수익률</th></tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={`${unit}-${period.index}-${period.fromTurn}`}>
              <td>{period.label}</td>
              <td>{won(period.endValue)}</td>
              <td className={changeClass(period.netAmount)}>{signedWon(period.netAmount)}</td>
              <td className={changeClass(period.returnRate)}>{signed(period.returnRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReturnsDashboard({ sessionId, assetType }) {
  const [unit, setUnit] = useState('day');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDashboard(null);
    setError('');
    api.getPortfolioDashboard(sessionId, unit, assetType)
      .then((result) => { if (active) setDashboard(result); })
      .catch((err) => { if (active) setError(err.message || '대시보드를 불러오지 못했다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId, unit, assetType]);

  const summary = dashboard?.summary;
  const unitMeta = UNIT_TABS.find((item) => item.key === unit);

  return (
    <div className="dash">
      <section className="dash-pie-card">
        <h4 className="dash-h">{TYPE_LABEL[assetType]} 포트폴리오 구성 <small>현재 평가액 기준</small></h4>
        {dashboard ? (
          <DonutChart
            allocation={dashboard.allocation}
            assetType={assetType}
            currentValue={dashboard.currentValue}
          />
        ) : !loading && error ? (
          <p className="dash-error">{error}</p>
        ) : <p className="dash-empty">구성을 불러오는 중…</p>}
      </section>

      <section className="dash-performance">
        <div className="dash-unit-head">
          <div>
            <h4 className="dash-h">운용 성과</h4>
          </div>
          <div className="dash-unit-tabs" role="tablist" aria-label="성과 조회 기간">
            {UNIT_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={unit === item.key}
                className={unit === item.key ? 'active' : ''}
                onClick={() => setUnit(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {summary && (
          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="k">현재 평가액</span>
              <b className="v">{won(dashboard.currentValue)}</b>
            </div>
            <div className="dash-kpi hero">
              <span className="k">누적 손익</span>
              <b className={`v ${changeClass(summary.netAmount)}`}>{signedWon(summary.netAmount)}</b>
              <span className="sub">입출금 제외</span>
            </div>
            <div className="dash-kpi">
              <span className="k">누적 수익률</span>
              <b className={`v ${changeClass(summary.returnRate)}`}>{signed(summary.returnRate)}</b>
            </div>
          </div>
        )}

        <div className="dash-period-head">
          <h4>{unitMeta?.performanceLabel}</h4>
        </div>
        {loading && <p className="dash-empty">성과를 계산하는 중…</p>}
        {!loading && !error && dashboard && <PeriodTable periods={dashboard.periods} unit={unit} />}
      </section>
    </div>
  );
}
