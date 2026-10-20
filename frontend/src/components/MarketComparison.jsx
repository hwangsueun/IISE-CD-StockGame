import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { signed, won, changeClass, relativeYearDate } from '../utils/format';
import { percentagePoints } from '../utils/marketComparison';

function useComparison() {
  const sessionId = useGameStore(s => s.sessionId);
  const turn = useGameStore(s => s.turn);
  const state = useGameStore(s => s.state);
  const [result, setResult] = useState({ data: null, error: '' });
  useEffect(() => {
    let active = true;
    setResult({ data: null, error: '' });
    if (sessionId) api.getMarketComparison(sessionId)
      .then(data => { if (active) setResult({ data, error: '' }); })
      .catch(() => { if (active) setResult({ data: null, error: '성과를 불러오지 못했어요. 창을 다시 열어 주세요.' }); });
    return () => { active = false; };
  }, [sessionId, turn, state]);
  return result;
}

export function MarketComparisonBadge() {
  const { data } = useComparison();
  const openModal = useGameStore(s => s.openModal);
  const rate = data?.summary?.benchmarks.find(b => b.code === 'kospi')?.excessReturn;
  return <button type="button" className="market-performance-badge" onClick={() => openModal('portfolio')}
    title="게임 시작일부터의 투자 수익률을 시장과 비교합니다">
    <span>내 투자 {signed(data?.summary?.playerReturn)}</span>
    <b className={changeClass(rate)}>코스피 대비 {percentagePoints(rate)}</b><span aria-hidden="true">↗</span>
  </button>;
}

function ReturnChart({ points, code, name }) {
  const values = points.flatMap(p => [p.playerReturn, p.benchmarks.find(b => b.code === code)?.returnRate])
    .filter(Number.isFinite);
  if (points.length < 2 || !values.length) return <p className="dash-empty">다음 날부터 수익률 추이를 볼 수 있어요.</p>;
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = Math.max((max - min) * 0.12, 0.005), low = min - pad, high = max + pad;
  const x = turn => 52 + (turn - 1) / Math.max(1, points.at(-1).turn - 1) * 580;
  const y = value => 170 - (value - low) / (high - low) * 145;
  const line = getter => points.map(p => Number.isFinite(getter(p))
    ? `${x(p.turn)},${y(getter(p))}` : null);
  const paths = values => {
    const result = []; let segment = [];
    for (const value of values) {
      if (value === null) { if (segment.length) result.push(segment.join(' ')); segment = []; }
      else segment.push(value);
    }
    if (segment.length) result.push(segment.join(' '));
    return result;
  };
  return <div className="comparison-chart">
    <div className="comparison-legend"><span>● 내 투자</span><span>● {name}</span><small>게임 시작일부터 누적</small></div>
    <svg viewBox="0 0 650 195" role="img" aria-label={`게임 시작일부터 내 투자와 ${name} 수익률 추이`}>
      {[low, 0, high].map((v, i) => <g key={i}>
        <line x1="52" x2="632" y1={y(v)} y2={y(v)} stroke="#493223" strokeDasharray="4 4" />
        <text x="45" y={y(v) + 4} textAnchor="end">{(v * 100).toFixed(1)}%</text>
      </g>)}
      {paths(line(p => p.playerReturn)).map((d, i) => <polyline key={`p${i}`} points={d} fill="none" stroke="#f5c542" strokeWidth="2.5" />)}
      {paths(line(p => p.benchmarks.find(b => b.code === code)?.returnRate)).map((d, i) => <polyline key={`b${i}`} points={d} fill="none" stroke="#80b8eb" strokeWidth="2" />)}
      <text x="52" y="190">1일차</text><text x="632" y="190" textAnchor="end">{points.at(-1).turn}일차</text>
    </svg>
  </div>;
}

export default function MarketComparison() {
  const { data, error } = useComparison();
  const [code, setCode] = useState('kospi');
  const [unit, setUnit] = useState('day');
  const benchmark = data?.summary?.benchmarks.find(b => b.code === code);
  const name = code === 'kospi' ? '코스피' : '코스닥';
  return <section className="dash-performance market-comparison" aria-label="시장 대비 내 투자">
    <div className="dash-unit-head">
      <h4 className="dash-h">시장 대비 내 투자</h4>
      <div className="dash-unit-tabs" aria-label="비교 시장">
        {['kospi', 'kosdaq'].map(key => <button type="button" key={key} className={code === key ? 'active' : ''}
          aria-pressed={code === key} onClick={() => setCode(key)}>{key === 'kospi' ? '코스피' : '코스닥'}</button>)}
      </div>
    </div>
    {!data ? <p className={error ? 'dash-error' : 'dash-empty'}>{error || '투자 성과를 계산하는 중…'}</p> : <>
      <p className="comparison-period">{relativeYearDate(data.fromDate, data.toDate)} → {relativeYearDate(data.toDate, data.toDate)} · {data.currentTurn}일차까지</p>
      {data.timingEstimated && <p className="dash-empty">이전 저장 기록에 일부 이벤트의 처리 시각이 없어 해당 구간은 발생일 기준으로 추정했어요.</p>}
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="k">내 투자 수익률</span><b className={`v ${changeClass(data.summary.playerReturn)}`}>{signed(data.summary.playerReturn)}</b></div>
        <div className="dash-kpi"><span className="k">{name} 수익률</span><b className={`v ${changeClass(benchmark?.returnRate)}`}>{signed(benchmark?.returnRate)}</b></div>
        <div className="dash-kpi hero"><span className="k">시장과의 차이</span><b className={`v ${changeClass(benchmark?.excessReturn)}`}>{percentagePoints(benchmark?.excessReturn)}</b></div>
      </div>
      {data.reason && <p className="dash-empty">{data.reason === 'nonpositive_capital'
        ? '투자 자산이 0원 이하가 된 구간이 있어 수익률을 계산할 수 없어요.'
        : '투자 기록이나 가격이 부족해 내 수익률을 계산할 수 없어요.'}</p>}
      {!benchmark?.startDate || !benchmark?.endDate ? <p className="dash-empty">이 기간의 시장 지수 자료가 부족해요.</p>
        : (benchmark.startDate !== data.fromDate || benchmark.endDate !== data.toDate) &&
          <p className="dash-empty">지수는 최근 개장일 기록을 사용해요: {relativeYearDate(benchmark.startDate, data.toDate)} → {relativeYearDate(benchmark.endDate, data.toDate)}</p>}
      <ReturnChart points={data.points} code={code} name={name} />
      <details className="comparison-help"><summary>어떻게 비교하나요?</summary>
        <p>현금과 보유 주식을 합친 투자 계좌의 성과예요. 부업 수입·월급·상금·생활비·상환금은 투자 손익에서 빼요. 돈이 들어오거나 나갈 때마다 그때까지의 수익률을 이어 계산해요.</p>
        <p>실제 매매 비용과 급등주 투자 손익은 반영해요. 코스피·코스닥은 같은 기간의 지수 변화예요. 지수에는 매매 비용이 없어요. 현금을 보유한 비중도 내 성과에 영향을 줘요.</p>
        <p>내 수익률이 5%이고 시장이 3%라면 차이는 +2%p예요. 게임 시작 자금이 달라도 같은 방식으로 비교해요.</p>
      </details>
      <div className="dash-unit-head"><h4 className="dash-h">기간별 비교</h4>
        <div className="dash-unit-tabs" aria-label="성과 조회 기간">
          {[['day','일'],['week','주'],['month','월'],['all','전체']].map(([key,label]) => <button type="button"
            key={key} className={unit === key ? 'active' : ''} aria-pressed={unit === key} onClick={() => setUnit(key)}>{label}</button>)}
        </div>
      </div>
      <div className="dash-period-scroll"><table className="data-table dash-period-table">
        <thead><tr><th>기간</th><th>투자 손익</th><th>내 수익률</th><th>{name}</th><th>시장과 차이</th></tr></thead>
        <tbody>{data.periods[unit].map((p, i) => {
          const market = p.benchmarks.find(b => b.code === code);
          return <tr key={i}><td>{p.label}</td><td className={changeClass(p.netAmount)}>{won(p.netAmount)}</td>
            <td className={changeClass(p.playerReturn)}>{signed(p.playerReturn)}</td>
            <td className={changeClass(market?.returnRate)}>{signed(market?.returnRate)}</td>
            <td className={changeClass(market?.excessReturn)}>{percentagePoints(market?.excessReturn)}</td></tr>;
        })}</tbody>
      </table></div>
    </>}
  </section>;
}
