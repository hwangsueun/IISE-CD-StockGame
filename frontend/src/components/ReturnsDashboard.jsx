// 수익률 대시보드 (포트폴리오 §10)
// 구성: ① KPI 타일(단일 헤드라인 수치) ② 수익률 추이 라인차트(단일 측정치·0% 기준선·호버)
//       ③ 자산군 성과 ④ 종목별 수익률 랭킹(0 기준 발산 막대)
// 색 규칙: 손익은 발산형(한국 증시 관례 — 이익=빨강 / 손실=파랑, 중립=회색).
//          자산군은 기존 게임 팔레트를 그대로 쓰되 색에만 의존하지 않도록 항상 라벨을 붙인다.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { won, pct, signed, changeClass } from '../utils/format';

const TYPE_LABEL = { cash: '현금', stock: '주식', bond: '채권', coin: '코인' };
const TYPE_COLOR = { cash: '#8a8f98', stock: '#e2504c', bond: '#3b6fd4', coin: '#e8a33d' };
const GAIN = '#e2504c';
const LOSS = '#3b6fd4';
const FLAT = '#8a8f98';
const pnlColor = (v) => (v > 0 ? GAIN : v < 0 ? LOSS : FLAT);

/** 수익률 추이 라인차트 — 단일 시리즈(축 1개), 0% 기준선, 크로스헤어 + 툴팁 */
function ReturnTrendChart({ points, width = 620, height = 190 }) {
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) {
    return <p className="dash-empty">아직 추이를 그릴 기록이 없다. 하루가 지나면 쌓인다.</p>;
  }

  const rates = points.map((p) => p.returnRate);
  const rawMin = Math.min(...rates, 0);
  const rawMax = Math.max(...rates, 0);
  const padRange = (rawMax - rawMin) * 0.15 || 0.01;
  const min = rawMin - padRange;
  const max = rawMax + padRange;
  const span = max - min || 1;

  const padL = 46, padR = 12, padT = 12, padB = 20;
  const x = (i) => padL + (i / (points.length - 1)) * (width - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (height - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.returnRate).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(min).toFixed(1)}L${x(0).toFixed(1)},${y(min).toFixed(1)}Z`;

  const last = points[points.length - 1];
  const stroke = pnlColor(last.returnRate);
  const zeroY = y(0);

  // 마우스 x -> 가장 가까운 데이터 포인트
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const ratio = (px - padL) / (width - padL - padR);
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    setHover(i);
  };

  const hp = hover === null ? null : points[hover];

  return (
    <div className="dash-chart-wrap">
      <svg
        className="dash-chart" viewBox={`0 0 ${width} ${height}`} width="100%"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`수익률 추이: ${points.length}일, 현재 ${signed(last.returnRate)}`}
      >
        {/* 0% 기준선(본전) — 손익 발산의 중립 기준 */}
        <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY}
              stroke="#5a3624" strokeWidth="1" strokeDasharray="3 3" />
        <text x={4} y={zeroY + 3} className="dash-axis">0%</text>
        <text x={4} y={y(max) + 9} className="dash-axis">{signed(max, 1)}</text>
        <text x={4} y={y(min) - 2} className="dash-axis">{signed(min, 1)}</text>

        <path d={area} fill={stroke} opacity="0.13" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

        {/* 마지막 지점만 선택적 직접 라벨 (모든 점에 숫자를 찍지 않는다) */}
        <circle cx={x(points.length - 1)} cy={y(last.returnRate)} r="4" fill={stroke}
                stroke="#0c0704" strokeWidth="2" />

        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB}
                  stroke="#c9a888" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={x(hover)} cy={y(hp.returnRate)} r="5" fill={stroke}
                    stroke="#0c0704" strokeWidth="2" />
          </g>
        )}
        <text x={padL} y={height - 6} className="dash-axis">{points[0].turn}일</text>
        <text x={width - padR} y={height - 6} className="dash-axis" textAnchor="end">{last.turn}일</text>
      </svg>

      <div className="dash-tip" aria-live="polite">
        {hp ? (
          <>
            <b>{hp.turn}일차</b>
            <span>총자산 {won(hp.totalAsset)}</span>
            <span className={changeClass(hp.returnRate)}>수익률 {signed(hp.returnRate)}</span>
          </>
        ) : (
          <span className="muted">그래프에 마우스를 올리면 그날 수치를 볼 수 있다.</span>
        )}
      </div>
    </div>
  );
}

/** 종목별 수익률 랭킹 — 0 기준 좌(손실)/우(이익) 발산 막대 + 직접 라벨 */
function HoldingRanking({ holdings }) {
  if (!holdings.length) return <p className="dash-empty">보유 중인 종목이 없다.</p>;
  const sorted = [...holdings].sort((a, b) => b.returnRate - a.returnRate);
  const maxAbs = Math.max(...sorted.map((h) => Math.abs(h.returnRate)), 0.01);

  return (
    <ul className="dash-rank">
      {sorted.map((h) => {
        const w = (Math.abs(h.returnRate) / maxAbs) * 50; // 중앙 기준 편측 최대 50%
        const gain = h.returnRate >= 0;
        return (
          <li key={h.assetId}>
            <span className="nm" title={h.name}>{h.name}</span>
            <span className="bar">
              <i className="zero" />
              <i
                className={`fill ${gain ? 'gain' : 'loss'}`}
                style={{ width: `${w}%`, [gain ? 'left' : 'right']: '50%' }}
              />
            </span>
            <span className={`val ${changeClass(h.returnRate)}`}>{signed(h.returnRate)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ReturnsDashboard({ sessionId, pf }) {
  const [history, setHistory] = useState(null);
  const [pnl, setPnl] = useState(null);

  useEffect(() => {
    api.getPortfolioHistory(sessionId).then(setHistory).catch(console.error);
    api.getRealizedPnl(sessionId, 'all').then(setPnl).catch(console.error);
  }, [sessionId]);

  const initial = history?.initialCapital ?? 0;
  const totalReturn = initial > 0 ? (pf.totalAsset - initial) / initial : 0;

  // 자산군별 평가손익 (보유 종목 집계)
  const byType = {};
  for (const h of pf.holdings) {
    byType[h.assetType] = byType[h.assetType] || { value: 0, pnl: 0, count: 0 };
    byType[h.assetType].value += h.value;
    byType[h.assetType].pnl += h.unrealizedPnl;
    byType[h.assetType].count += 1;
  }

  return (
    <div className="dash">
      {/* ① KPI 타일 — 차트가 아니라 단일 헤드라인 수치 */}
      <div className="dash-kpis">
        <div className="dash-kpi hero">
          <span className="k">총 수익률</span>
          <b className={`v ${changeClass(totalReturn)}`}>{signed(totalReturn)}</b>
          <span className="sub">초기자본 {won(initial)} 대비</span>
        </div>
        <div className="dash-kpi">
          <span className="k">평가손익</span>
          <b className={`v ${changeClass(pf.unrealizedPnl)}`}>{won(pf.unrealizedPnl)}</b>
          <span className="sub">보유 중 미실현</span>
        </div>
        <div className="dash-kpi">
          <span className="k">실현손익</span>
          <b className={`v ${changeClass(pnl?.totalPnl ?? 0)}`}>{pnl ? won(pnl.totalPnl) : '-'}</b>
          <span className="sub">누적 {pnl?.tradeCount ?? 0}회 거래</span>
        </div>
        <div className="dash-kpi">
          <span className="k">순자산</span>
          <b className="v">{won(pf.netAsset)}</b>
          <span className="sub">빚 {won(pf.debt)} 차감</span>
        </div>
      </div>

      {/* ② 수익률 추이 */}
      <section className="dash-sec">
        <h4 className="dash-h">수익률 추이 <small>초기자본 대비 · 0%가 본전</small></h4>
        {history ? <ReturnTrendChart points={history.points} /> : <p className="dash-empty">불러오는 중…</p>}
      </section>

      {/* ③ 자산군 성과 */}
      <section className="dash-sec">
        <h4 className="dash-h">자산군 성과</h4>
        <ul className="dash-types">
          {['stock', 'bond', 'coin', 'cash'].map((t) => {
            const w = pf.weights[t] ?? 0;
            const d = byType[t];
            return (
              <li key={t}>
                <span className="lg"><i style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]}</span>
                <span className="wt">{pct(w, 1)}</span>
                <span className="amt">{t === 'cash' ? won(pf.cash) : won(d?.value ?? 0)}</span>
                <span className={`pl ${d ? changeClass(d.pnl) : ''}`}>
                  {t === 'cash' ? '—' : d ? won(d.pnl) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ④ 종목별 수익률 랭킹 */}
      <section className="dash-sec">
        <h4 className="dash-h">종목별 수익률 <small>이익 ▶ 빨강 · 손실 ◀ 파랑</small></h4>
        <HoldingRanking holdings={pf.holdings} />
      </section>
    </div>
  );
}
