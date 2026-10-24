// '너무 어려워요' 설명서: 나만의 투자 모델 만들기의 설정을 하나씩 설명하고,
// 예시 종목으로 값을 바꿔 보며 그 설정이 무엇을 바꾸는지 그림으로 보여 준다.
// 예시 숫자는 설명용이며 실제 시세·연습 결과와 무관하다. 적용 버튼만 실제 설정(update)을 바꾼다.
import { useMemo, useState } from 'react';
import { riskNames } from './QuantResearch';
import './ModelGuide.css';

// 설명용 예시 종목 (실제 종목·시세 아님)
const SAMPLE = [
  { id: 'A', r60: 42, vol: 48, r5: 3 }, { id: 'B', r60: 31, vol: 35, r5: -2 },
  { id: 'C', r60: 18, vol: 22, r5: 1 }, { id: 'D', r60: 12, vol: 30, r5: -5 },
  { id: 'E', r60: 7, vol: 18, r5: 0.5 }, { id: 'F', r60: 3, vol: 55, r5: 9 },
  { id: 'G', r60: -4, vol: 25, r5: -1 }, { id: 'H', r60: -10, vol: 40, r5: 4 },
  { id: 'I', r60: 25, vol: 60, r5: 14 }, { id: 'J', r60: -18, vol: 33, r5: -6 },
];
const CAPITAL = 5000; // 만 원
const GOLD = '#d7b874', GREEN = '#a5bd9b', BLUE = '#9cbce1', RED = '#e0a08a', MUTED = '#c7bda7', LINE = '#4a4a38';

// 같은 날 다른 종목과 비교한 위치 (0~100)
function percentile(key) {
  const sorted = [...SAMPLE].sort((a, b) => a[key] - b[key]);
  return Object.fromEntries(sorted.map((s, i) => [s.id, Math.round(i / (sorted.length - 1) * 100)]));
}
function series(seed, len, drift, wobble) {
  let s = seed >>> 0, v = 100;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  return Array.from({ length: len }, (_, i) => (v *= 1 + drift + wobble * rnd() + 0.012 * Math.sin(i / 17)));
}
const man = v => `${Math.round(v).toLocaleString('ko-KR')}만 원`;

function Seg({ value, options, onChange, label }) {
  return <div className="mg-seg" role="group" aria-label={label}>{options.map(([v, text]) =>
    <button type="button" key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}</div>;
}
function Slider({ label, value, min, max, step = 1, onChange, unit = '' }) {
  return <label className="mg-slider"><span>{label} <b>{value}{unit}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

/* ---------- 큰 그림: 모든 설정이 끼어드는 자리 ---------- */
const STAGES = ['전체 종목', '조건으로 거르기', '점수·예측으로 줄 세우기', '상위 몇 종목', '금액 나누기', '다음 날 시가에 주문'];
function Pipeline({ active }) {
  return <ol className="mg-pipe" aria-label="모델이 종목을 고르는 순서">{STAGES.map((s, i) =>
    <li key={s} className={active === i ? 'is-on' : active != null && Math.abs(active - i) > 0 ? 'is-dim' : ''}><span>{i + 1}</span>{s}</li>)}</ol>;
}

/* ---------- 판단 방법 ---------- */
const METHOD_DEMO = {
  conditions: { title: '조건 필터', lines: [['60일 수익률 ≥ 0%', '31% → 통과'], ['변동성 ≤ 40%', '35% → 통과']], result: '모든 조건 통과 → 후보에 남음', note: '점수 없이 기준을 통과했는지만 봅니다.' },
  score: { title: '가중치 점수', lines: [['60일 수익률 위치 89점 × 가중치 +1', '+89'], ['변동성 위치 56점 × 가중치 −1', '−56']], result: '내 점수 +33 → 점수 높은 순으로 줄 세움', note: '가중치를 내가 직접 정합니다.' },
  ridge: { title: 'Ridge 회귀', lines: [['60일 수익률 위치 89점 × 배운 값 +0.012', '+1.07%'], ['변동성 위치 56점 × 배운 값 −0.008', '−0.45%']], result: '예상 수익률 +0.62% → 높은 순으로 줄 세움', note: '가중치를 과거 자료가 정합니다.' },
  tree: { title: '결정트리', lines: [['질문 1 · 60일 수익률 위치 ≥ 70?', '예'], ['질문 2 · 변동성 위치 ≤ 60?', '예']], result: '도착한 칸의 과거 평균 → 예상 +0.9%', note: '질문을 따라 내려가 같은 조건의 과거 사례 평균을 씁니다.' },
  randomForest: { title: 'Random Forest', lines: [['나무 1의 예측', '+1.2%'], ['나무 2의 예측', '+0.4%'], ['나무 3의 예측', '+0.8%']], result: '평균 → 예상 +0.8%', note: '조금씩 다른 자료로 만든 나무 여러 개의 평균입니다.' },
  boost: { title: 'LightGBM · XGBoost', lines: [['처음 예측', '+0.3%'], ['1차 보완 (틀린 만큼 고치기)', '+0.4%'], ['2차 보완', '+0.1%']], result: '합계 → 예상 +0.8%', note: '앞 나무가 틀린 부분을 다음 나무가 차례로 고칩니다.' },
};
function MethodVisual({ method }) {
  const key = ['lightgbm', 'xgboost'].includes(method) ? 'boost' : method;
  const [pick, setPick] = useState(METHOD_DEMO[key] ? key : 'score');
  const d = METHOD_DEMO[pick];
  return <div className="mg-vis">
    <Seg label="판단 방법" value={pick} onChange={setPick} options={[['conditions', '조건'], ['score', '점수'], ['ridge', 'Ridge'], ['tree', '트리'], ['randomForest', '숲'], ['boost', '부스팅']]} />
    <p className="mg-cap">예시 종목 B (60일 수익률 31%, 변동성 35%)를 {d.title}(으)로 판단하면</p>
    <ol className="mg-calc">{d.lines.map(([a, b]) => <li key={a}><span>{a}</span><b>{b}</b></li>)}</ol>
    <p className="mg-result">{d.result}</p>
    <p className="mg-cap">{d.note}</p>
    <div className="mg-family"><span><i className="mine" />내가 규칙 작성: 조건 · 점수</span><span><i className="learn" />과거 자료로 학습: Ridge · 트리 · 숲 · 부스팅</span></div>
  </div>;
}

/* ---------- 예측 기간 ---------- */
function HorizonVisual({ value, setValue }) {
  const W = 520, x = d => 30 + d / 21 * (W - 60);
  return <div className="mg-vis">
    <Seg label="예측 기간" value={value} onChange={setValue} options={[[1, '1거래일'], [5, '5거래일'], [10, '10거래일'], [20, '20거래일']]} />
    <svg viewBox={`0 0 ${W} 110`} role="img" aria-label={`${value}거래일 뒤까지의 수익률을 맞힘`}>
      <line x1={x(0)} x2={x(21)} y1="60" y2="60" stroke={LINE} strokeWidth="2" />
      {Array.from({ length: 22 }, (_, d) => <line key={d} x1={x(d)} x2={x(d)} y1="55" y2="65" stroke={LINE} />)}
      <rect x={x(1)} y="44" width={x(1 + value) - x(1)} height="32" fill={GOLD} opacity=".22" />
      <circle cx={x(0)} cy="60" r="6" fill={MUTED} /><text x={x(0)} y="30" textAnchor="middle">오늘 종가</text><text x={x(0)} y="98" textAnchor="middle">판단</text>
      <circle cx={x(1)} cy="60" r="6" fill={GREEN} /><text x={x(1)} y="98" textAnchor="middle" fill={GREEN}>시가 매수</text>
      <circle cx={x(1 + value)} cy="60" r="6" fill={GOLD} /><text x={x(1 + value)} y="30" textAnchor="middle" fill={GOLD}>{value}거래일 뒤 시가</text>
    </svg>
    <p className="mg-result">"사고 나서 {value}거래일 뒤에 얼마나 올라 있을까?"를 맞히도록 배웁니다.</p>
    <p className="mg-cap">짧으면 며칠 사이의 반응을, 길면 꾸준한 흐름을 배웁니다. 점검 주기와 비슷하게 맞추면 해석하기 쉬워요.</p>
  </div>;
}

/* ---------- 학습 기간 ---------- */
function TrainVisual({ value, setValue }) {
  const W = 520, cell = (W - 40) / 4;
  return <div className="mg-vis">
    <Seg label="학습 기간" value={value} onChange={setValue} options={[[1, '1년'], [2, '2년'], [3, '3년']]} />
    <svg viewBox={`0 0 ${W} 96`} role="img" aria-label={`연습 시작 전 ${value}년 자료로 학습`}>
      {['3년 전', '2년 전', '1년 전', '연습 구간'].map((t, i) => {
        const learn = i < 3 && 3 - i <= value, test = i === 3;
        return <g key={t}><rect x={20 + i * cell} y="22" width={cell - 6} height="36" fill={test ? '#2d3a4a' : learn ? GOLD : '#26261d'} opacity={learn ? .8 : 1} stroke={LINE} />
          <text x={20 + i * cell + (cell - 6) / 2} y="45" textAnchor="middle" fill={learn ? '#1d1a12' : MUTED}>{t}</text></g>;
      })}
      <text x={20 + 3 * cell + (cell - 6) / 2} y="80" textAnchor="middle" fill={BLUE}>배우지 않고 시험만</text>
      <text x={20 + (3 - value) * cell + (value * cell - 6) / 2} y="80" textAnchor="middle" fill={GOLD}>여기서 배움</text>
    </svg>
    <p className="mg-result">연습을 시작하기 전 {value}년치 자료로 한 번 배우고, 연습 중에는 다시 배우지 않습니다.</p>
    <p className="mg-cap">시험 기간의 정답을 미리 보지 않게 하는 규칙이에요. 길게 배우면 여러 시장을 겪지만 오래된 패턴도 섞입니다.</p>
  </div>;
}

/* ---------- 맞힐 결과 ---------- */
const OUTCOMES = [-8.2, -5.1, -3.6, -2.4, -1.5, -0.8, -0.3, 0.2, 0.6, 1.1, 1.8, 2.7, 3.9, 5.2, 7.4, 9.1];
function TargetVisual() {
  const [mode, setMode] = useState('binary'), [t, setT] = useState(1);
  const W = 520, x = v => 20 + (v + 10) / 20 * (W - 40);
  const cls = v => mode === 'return' ? 'n' : mode === 'binary' ? (v > t ? 'u' : 'd') : Math.abs(v) <= t ? (mode === 'tails' ? 'x' : 'm') : v > 0 ? 'u' : 'd';
  const color = { n: GOLD, u: RED, d: BLUE, m: MUTED, x: '#3a3a2e' };
  const text = { return: '숫자 그대로(예: +2.7%)를 맞힙니다.', binary: `${t}%보다 오르면 '상승', 아니면 '비상승'으로 나눠 맞힙니다.`, threeClass: `±${t}% 안은 '큰 변화 없음', 그 밖은 상승·하락으로 나눕니다.`, tails: `±${t}% 안의 작은 움직임은 빼고, 크게 오른 것과 크게 내린 것만 구분합니다.` };
  return <div className="mg-vis">
    <Seg label="맞힐 결과" value={mode} onChange={setMode} options={[['return', '수익률'], ['binary', '상승 여부'], ['threeClass', '3가지'], ['tails', '큰 움직임만']]} />
    {mode !== 'return' && <Slider label="구분 기준" value={t} min={0} max={5} step={0.5} unit="%" onChange={setT} />}
    <svg viewBox={`0 0 ${W} 80`} role="img" aria-label="과거 사례의 실제 수익률과 분류">
      <line x1="20" x2={W - 20} y1="40" y2="40" stroke={LINE} />
      {mode !== 'return' && <rect x={x(mode === 'binary' ? -10 : -t)} y="26" width={mode === 'binary' ? x(t) - x(-10) : x(t) - x(-t)} height="28" fill={MUTED} opacity=".08" />}
      {OUTCOMES.map(v => <circle key={v} cx={x(v)} cy="40" r="7" fill={color[cls(v)]} />)}
      <text x="20" y="74">−10%</text><text x={x(0)} y="74" textAnchor="middle">0%</text><text x={W - 20} y="74" textAnchor="end">+10%</text>
    </svg>
    <p className="mg-result">{text[mode]}</p>
    <p className="mg-cap">점은 과거 사례의 실제 수익률(예시)입니다. 분류 방식은 Random Forest·LightGBM·XGBoost에서 고를 수 있어요.</p>
  </div>;
}

/* ---------- 지표 숫자 읽는 방식 ---------- */
function RepresentationVisual() {
  const [mode, setMode] = useState('rank');
  const rank = useMemo(() => percentile('r60'), []);
  const rows = SAMPLE.slice(0, 5);
  return <div className="mg-vis">
    <Seg label="숫자 읽는 방식" value={mode} onChange={setMode} options={[['raw', '원래 숫자'], ['rank', '다른 종목과 비교'], ['zscore', '평소와 비교']]} />
    <table className="mg-table"><thead><tr><th>예시 종목</th><th>60일 수익률</th><th>모델에 넣는 값</th></tr></thead>
      <tbody>{rows.map((s, i) => <tr key={s.id}><td>종목 {s.id}</td><td>{s.r60}%</td>
        <td className="mg-hl">{mode === 'raw' ? s.r60 : mode === 'rank' ? `${rank[s.id]} / 100` : ['+2.1', '+1.4', '+0.3', '−0.6', '+0.9'][i]}</td></tr>)}</tbody></table>
    <p className="mg-result">{mode === 'raw' ? '42%면 42를 그대로 넣습니다.' : mode === 'rank' ? '오늘 전체 종목 중 몇 등쯤인지(0~100)를 넣습니다. 기본값이에요.' : '이 종목이 평소(직전 60번)보다 얼마나 높거나 낮은지 넣습니다.'}</p>
  </div>;
}

/* ---------- 조건 ---------- */
function ConditionVisual() {
  const [cut, setCut] = useState(0), [op, setOp] = useState('gte'), [second, setSecond] = useState(false), [mode, setMode] = useState('all');
  const pass = s => { const a = op === 'gte' ? s.r60 >= cut : s.r60 <= cut, b = s.vol <= 40; return !second ? a : mode === 'all' ? a && b : a || b; };
  const W = 520, x = v => 24 + (v + 20) / 65 * (W - 48);
  const n = SAMPLE.filter(pass).length;
  return <div className="mg-vis">
    <div className="mg-row"><Seg label="방향" value={op} onChange={setOp} options={[['gte', '이상'], ['lte', '이하']]} />
      <Seg label="두 번째 조건" value={second} onChange={setSecond} options={[[false, '조건 1개'], [true, '+ 변동성 ≤ 40%']]} />
      {second && <Seg label="통과 방법" value={mode} onChange={setMode} options={[['all', '모두 충족'], ['any', '하나 이상']]} />}</div>
    <Slider label="60일 수익률 기준" value={cut} min={-20} max={40} step={5} unit="%" onChange={setCut} />
    <svg viewBox={`0 0 ${W} 92`} role="img" aria-label={`10개 중 ${n}개 통과`}>
      <line x1="24" x2={W - 24} y1="50" y2="50" stroke={LINE} />
      <line x1={x(cut)} x2={x(cut)} y1="18" y2="70" stroke={GOLD} strokeDasharray="4 3" />
      {SAMPLE.map((s, i) => <g key={s.id}><circle cx={x(s.r60)} cy={i % 2 ? 42 : 58} r="9" fill={pass(s) ? GOLD : '#3a3a2e'} stroke="#000" />
        <text x={x(s.r60)} y={(i % 2 ? 42 : 58) + 4} textAnchor="middle" fill={pass(s) ? '#1d1a12' : MUTED} fontSize="10">{s.id}</text></g>)}
      <text x={x(cut)} y="12" textAnchor="middle" fill={GOLD}>{cut}%</text>
      <text x="24" y="88">−20%</text><text x={W - 24} y="88" textAnchor="end">+45%</text>
    </svg>
    <p className="mg-result">예시 10종목 중 <b>{n}종목</b>만 후보로 남습니다.</p>
    <p className="mg-cap">조건은 "이런 종목은 아예 안 산다"는 울타리예요. 너무 엄격하면 살 종목이 없어서 현금으로 기다립니다.</p>
  </div>;
}

/* ---------- 지표와 가중치 ---------- */
function WeightVisual() {
  const [w1, setW1] = useState(1), [w2, setW2] = useState(-1);
  const r1 = useMemo(() => percentile('r60'), []), r2 = useMemo(() => percentile('vol'), []);
  const total = Math.abs(w1) + Math.abs(w2) || 1;
  const ranked = SAMPLE.map(s => ({ ...s, score: (w1 * r1[s.id] + w2 * r2[s.id]) / total })).sort((a, b) => b.score - a.score);
  const lo = Math.min(...ranked.map(s => s.score)), hi = Math.max(...ranked.map(s => s.score)), span = hi - lo || 1;
  return <div className="mg-vis">
    <div className="mg-row"><Slider label="60일 수익률 가중치" value={w1} min={-5} max={5} onChange={setW1} /><Slider label="변동성 가중치" value={w2} min={-5} max={5} onChange={setW2} /></div>
    <ol className="mg-bars">{ranked.map((s, i) => <li key={s.id} className={i < 3 ? 'is-top' : ''}>
      <span>{i + 1}위 종목 {s.id}</span><i style={{ width: `${8 + (s.score - lo) / span * 92}%` }} /><b>{Math.round(s.score)}</b></li>)}</ol>
    <p className="mg-result">{w1 > 0 ? '많이 오른' : w1 < 0 ? '덜 오른' : ''}{w1 && w2 ? ' · ' : ''}{w2 < 0 ? '덜 흔들린' : w2 > 0 ? '많이 흔들린' : ''} 종목이 위로 올라옵니다. 상위 3종목이 선택돼요.</p>
    <p className="mg-cap">양수는 "높을수록 좋다", 음수는 "낮을수록 좋다", 숫자가 클수록 더 중요하게 봅니다. 학습 모델은 이 가중치를 과거 자료로 정해요.</p>
  </div>;
}

/* ---------- 지표 묶기 ---------- */
function ReductionVisual() {
  const [on, setOn] = useState(true);
  return <div className="mg-vis">
    <Seg label="묶기" value={on} onChange={setOn} options={[[false, '각각 사용'], [true, '요약값으로 묶기']]} />
    <svg viewBox="0 0 520 130" role="img" aria-label={on ? '지표 3개를 요약값 2개로 묶음' : '지표 3개를 그대로 사용'}>
      {['20일 수익률', '60일 수익률', '20일 변동성'].map((t, i) => <g key={t}><rect x="20" y={10 + i * 40} width="150" height="30" fill="#26261d" stroke={LINE} /><text x="95" y={30 + i * 40} textAnchor="middle">{t}</text></g>)}
      {(on ? ['요약값 1 · 오르는 힘', '요약값 2 · 흔들림'] : ['20일 수익률', '60일 수익률', '20일 변동성']).map((t, i, a) => {
        const y = a.length === 2 ? 30 + i * 50 : 10 + i * 40;
        return <g key={t}><rect x="330" y={y} width="170" height="30" fill={on ? '#3a3420' : '#26261d'} stroke={on ? GOLD : LINE} /><text x="415" y={y + 20} textAnchor="middle" fill={on ? GOLD : MUTED}>{t}</text>
          {[0, 1, 2].filter(j => on || j === i).map(j => <line key={j} x1="170" y1={25 + j * 40} x2="330" y2={y + 15} stroke={on ? GOLD : LINE} opacity=".6" />)}</g>;
      })}
    </svg>
    <p className="mg-result">{on ? '비슷한 흐름의 지표를 섞어 적은 수의 숫자로 만든 뒤 모델에 넣습니다.' : '고른 지표를 하나하나 모델에 넣습니다.'}</p>
    <p className="mg-cap">학습 모델에서만 쓰는 선택 기능이에요. 처음에는 "각각 사용"으로 두어도 됩니다.</p>
  </div>;
}

/* ---------- 금액 나누기 ---------- */
function MoneyVisual({ v, set }) {
  const each = Math.min(v.exposure / v.topK, v.maxWeight), used = each * v.topK, cash = 100 - used;
  const colors = [GOLD, '#c9a95f', '#b89850', '#a68844', '#957a3b'];
  return <div className="mg-vis">
    <div className="mg-row"><Slider label="최대 보유 종목" value={v.topK} min={1} max={20} unit="개" onChange={topK => set({ topK })} />
      <Slider label="주식에 쓸 최대 비율" value={v.exposure} min={0} max={100} step={5} unit="%" onChange={exposure => set({ exposure })} />
      <Slider label="한 종목 최대 비율" value={v.maxWeight} min={1} max={100} unit="%" onChange={maxWeight => set({ maxWeight })} /></div>
    <div className="mg-stack" role="img" aria-label={`주식 ${used.toFixed(0)}% 현금 ${cash.toFixed(0)}%`}>
      {Array.from({ length: v.topK }, (_, i) => <span key={i} style={{ width: `${each}%`, background: colors[i % colors.length] }} title={`종목 ${i + 1}`} />)}
      <span className="cash" style={{ width: `${cash}%` }}>{cash >= 8 ? '현금' : ''}</span></div>
    <p className="mg-result">5,000만 원이면 종목마다 <b>{man(CAPITAL * each / 100)}</b>씩 {v.topK}종목, 현금 <b>{man(CAPITAL * cash / 100)}</b>.</p>
    <p className="mg-cap">{each < v.exposure / v.topK ? '한 종목 최대 비율에 걸려서 계획보다 현금이 더 남았어요.' : '종목 수가 적을수록 한 종목에 많이 실리고, 그만큼 결과가 크게 흔들립니다.'}</p>
  </div>;
}

/* ---------- 종목별 배분 ---------- */
function AllocationVisual({ value, setValue }) {
  const picks = SAMPLE.slice(0, 4), inv = picks.map(s => 1 / s.vol), sum = inv.reduce((a, b) => a + b, 0);
  const w = picks.map((s, i) => value === 'equal' ? 25 : inv[i] / sum * 100);
  return <div className="mg-vis">
    <Seg label="배분 방식" value={value} onChange={setValue} options={[['equal', '동일 금액'], ['inverseVol', '덜 흔들리는 종목에 더 많이']]} />
    <ol className="mg-bars">{picks.map((s, i) => <li key={s.id}><span>종목 {s.id} · 변동성 {s.vol}%</span><i style={{ width: `${w[i] * 2.4}%` }} /><b>{w[i].toFixed(0)}%</b></li>)}</ol>
    <p className="mg-result">{value === 'equal' ? '고른 종목에 같은 금액을 넣습니다.' : '많이 흔들리는 종목은 적게, 차분한 종목은 많이 넣습니다.'}</p>
  </div>;
}

/* ---------- 시장 조건 (코스피 이동평균) ---------- */
const KOSPI = series(11, 200, 0.0004, 0.022);
function MarketVisual({ value, setValue }) {
  const ma = value ? KOSPI.map((_, i) => i < value - 1 ? null : KOSPI.slice(i - value + 1, i + 1).reduce((a, b) => a + b, 0) / value) : [];
  const W = 520, H = 130, lo = Math.min(...KOSPI) * .98, hi = Math.max(...KOSPI) * 1.02;
  const x = i => 10 + i / 199 * (W - 20), y = v => 10 + (hi - v) / (hi - lo) * (H - 20);
  const out = ma.map((m, i) => m != null && KOSPI[i] < m);
  let switches = 0; out.forEach((o, i) => { if (i && o !== out[i - 1] && ma[i - 1] != null) switches++; });
  const share = value ? Math.round(out.filter(Boolean).length / ma.filter(m => m != null).length * 100) : 0;
  return <div className="mg-vis">
    <Seg label="시장 조건" value={value} onChange={setValue} options={[[0, '사용 안 함'], [20, '20일'], [60, '60일'], [120, '120일'], [200, '200일']]} />
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="코스피와 이동평균, 현금으로 쉬는 구간">
      {out.map((o, i) => o && <rect key={i} x={x(i) - 1.4} y="6" width="2.8" height={H - 12} fill={BLUE} opacity=".16" />)}
      <path d={KOSPI.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke={MUTED} strokeWidth="1.5" />
      {value > 0 && <path d={ma.map((v, i) => v == null ? '' : `${ma[i - 1] == null ? 'M' : 'L'}${x(i)},${y(v)}`).join('')} fill="none" stroke={GOLD} strokeWidth="2" />}
    </svg>
    <div className="mg-legend"><span><i style={{ background: MUTED }} />코스피(예시)</span>{value > 0 && <span><i style={{ background: GOLD }} />{value}일 평균</span>}{value > 0 && <span><i style={{ background: BLUE, opacity: .5 }} />현금으로 쉬는 날</span>}</div>
    <p className="mg-result">{value ? `코스피가 노란 선 아래로 내려간 날(약 ${share}%)에는 주식을 팔고 현금으로 기다립니다. 들어갔다 나온 횟수 ${switches}번.` : '시장 상황과 상관없이 계속 투자합니다.'}</p>
    <p className="mg-cap">평균 기간이 짧을수록 자주 들락날락하고, 길수록 큰 하락장만 피합니다.</p>
  </div>;
}

/* ---------- 시장 흔들림에 맞춰 줄이기 ---------- */
const MKT_VOL = series(5, 120, 0, 0.09).map((v, i) => 12 + Math.abs(v - 100) * 0.9 + (i > 70 && i < 90 ? 18 : 0));
function TargetVolVisual({ value, setValue }) {
  const W = 520, H = 120, x = i => 10 + i / 119 * (W - 20), yv = v => 10 + (1 - v / 50) * (H - 20);
  const expo = MKT_VOL.map(v => value ? Math.min(1, value / v) : 1);
  return <div className="mg-vis">
    <Slider label="감수할 시장 흔들림" value={value} min={0} max={40} step={5} unit={value ? '%/년' : ' (사용 안 함)'} onChange={setValue} />
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="시장 흔들림과 투자 비중">
      <path d={`M${x(0)},${H - 10}` + expo.map((e, i) => `L${x(i)},${H - 10 - e * (H - 20)}`).join('') + `L${x(119)},${H - 10}Z`} fill={GOLD} opacity=".25" />
      <path d={MKT_VOL.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${yv(v)}`).join('')} fill="none" stroke={RED} strokeWidth="1.5" />
      {value > 0 && <line x1="10" x2={W - 10} y1={yv(value)} y2={yv(value)} stroke={GOLD} strokeDasharray="4 3" />}
    </svg>
    <div className="mg-legend"><span><i style={{ background: RED }} />시장 흔들림(예시)</span><span><i style={{ background: GOLD, opacity: .5 }} />주식에 넣는 비중</span></div>
    <p className="mg-result">{value ? `시장이 ${value}%보다 크게 흔들리면 그만큼 주식 비중을 줄입니다. 흔들림이 목표의 2배면 비중은 절반.` : '0이면 이 기능을 쓰지 않습니다.'}</p>
    <p className="mg-cap">손실 한도는 아니에요. 불안한 시기에 덜 담는 장치입니다.</p>
  </div>;
}

/* ---------- 위험 모델 ---------- */
function RiskVisual({ value, setValue, model }) {
  const preds = [['종목 A', 30], ['종목 C', 12]];
  return <div className="mg-vis">
    <Seg label="목표 흔들림" value={value} onChange={setValue} options={[[5, '5%'], [10, '10%'], [15, '15%'], [20, '20%'], [30, '30%']]} />
    <ol className="mg-bars">{preds.map(([n, p]) => { const k = Math.min(1, value / p); return <li key={n}><span>{n} · 예상 흔들림 {p}%</span><i style={{ width: `${k * 100}%` }} /><b>원래 비중의 {Math.round(k * 100)}%</b></li>; })}</ol>
    <p className="mg-result">위험 모델이 "앞으로 얼마나 흔들릴지" 예상하고, 목표보다 크면 그 비율만큼 덜 삽니다.</p>
    <p className="mg-cap">현재 선택: {riskNames[model] || '사용 안 함'}. 예상하는 방법(최근 20일, GARCH, HAR 등)만 다르고 하는 일은 같아요. 학습형 방법은 투자 종목을 2~5개로 정해야 합니다.</p>
  </div>;
}

/* ---------- 급락 모의실험 ---------- */
function StressVisual() {
  const [fat, setFat] = useState(true);
  const normal = [1, 3, 8, 16, 24, 22, 14, 7, 3, 1, 0, 0], tail = [1, 2, 6, 14, 22, 21, 15, 8, 5, 3, 2, 1];
  const d = fat ? tail : normal, W = 520, bw = (W - 40) / d.length, max = 24;
  return <div className="mg-vis">
    <Seg label="가정" value={fat} onChange={setFat} options={[[false, '보통의 경우'], [true, '큰 급락이 더 잦은 경우']]} />
    <svg viewBox={`0 0 ${W} 120`} role="img" aria-label="가상 손익 분포">
      {d.map((c, i) => <rect key={i} x={20 + i * bw} y={100 - c / max * 85} width={bw - 4} height={c / max * 85} fill={i >= 9 ? RED : MUTED} opacity={i >= 9 ? .9 : .5} />)}
      <text x="20" y="116">이익</text><text x={W - 20} y="116" textAnchor="end" fill={RED}>큰 손실</text>
    </svg>
    <p className="mg-result">{fat ? '오른쪽 끝(큰 손실)이 두꺼워집니다. 최악의 5% 상황에서 약 −18%.' : '큰 손실은 드뭅니다. 최악의 5% 상황에서 약 −11%.'}</p>
    <p className="mg-cap">결과를 살펴보는 기능일 뿐, 주문이나 비중을 바꾸지는 않아요.</p>
  </div>;
}

/* ---------- 점검 주기 ---------- */
function RebalanceVisual({ value, setValue }) {
  const W = 520, x = t => 14 + t / 40 * (W - 28), ticks = Array.from({ length: 41 }, (_, t) => t).filter(t => t % value === 0);
  return <div className="mg-vis">
    <Seg label="점검 주기" value={value} onChange={setValue} options={[[1, '매 턴'], [5, '5턴마다'], [20, '20턴마다']]} />
    <svg viewBox={`0 0 ${W} 70`} role="img" aria-label={`40턴 동안 ${ticks.length}번 점검`}>
      <line x1="14" x2={W - 14} y1="34" y2="34" stroke={LINE} strokeWidth="2" />
      {ticks.map(t => <rect key={t} x={x(t) - 3} y="24" width="6" height="20" fill={GOLD} />)}
      <text x="14" y="62">1턴</text><text x={W - 14} y="62" textAnchor="end">40턴</text>
    </svg>
    <p className="mg-result">40턴 동안 <b>{ticks.length}번</b> 종목과 금액을 다시 정합니다.</p>
    <p className="mg-cap">자주 점검하면 변화에 빨리 반응하지만 거래가 늘고, 가끔 점검하면 거래는 적지만 늦게 반응합니다. 시장 조건(코스피 평균)을 벗어나면 점검일이 아니어도 팝니다.</p>
  </div>;
}

/* ---------- 순위 여유 ---------- */
function BufferVisual({ value, setValue }) {
  const held = [4, 9, 12, 15];
  return <div className="mg-vis">
    <Slider label="순위 여유" value={value} min={0} max={8} unit="등" onChange={setValue} />
    <ol className="mg-ranks">{Array.from({ length: 18 }, (_, i) => i + 1).map(r => {
      const isHeld = held.includes(r), keep = r <= 10 || (isHeld && r <= 10 + value);
      return <li key={r} className={`${r <= 10 ? 'in' : r <= 10 + value ? 'buf' : ''}${isHeld ? ' held' : ''}`}>
        <span>{r}위</span>{isHeld && <b>{keep ? '보유 유지' : '매도'}</b>}</li>;
    })}</ol>
    <p className="mg-result">10종목 보유 · 여유 {value}등이면 이미 가진 종목은 {10 + value}위까지 팔지 않습니다.</p>
    <p className="mg-cap">순위가 조금 흔들릴 때마다 사고팔지 않게 해서 거래 비용을 아낍니다.</p>
  </div>;
}

/* ---------- 단기 급등 매수 제한 ---------- */
function CeilingVisual({ value, setValue }) {
  return <div className="mg-vis">
    <Seg label="급등 매수 제한" value={value == null ? 'off' : 'on'} onChange={v => setValue(v === 'off' ? null : 10)} options={[['off', '제한 없음'], ['on', '제한']]} />
    {value != null && <Slider label="5일 상승률 기준" value={value} min={0} max={20} unit="%" onChange={setValue} />}
    <ol className="mg-bars">{SAMPLE.slice(0, 6).concat(SAMPLE[8]).map(s => { const skip = value != null && s.r5 > value; return <li key={s.id} className={skip ? 'is-skip' : ''}>
      <span>종목 {s.id} · 5일 {s.r5 > 0 ? '+' : ''}{s.r5}%</span><i style={{ width: `${Math.max(4, (s.r5 + 7) * 4)}%` }} /><b>{skip ? '이번엔 안 삼' : '살 수 있음'}</b></li>; })}</ol>
    <p className="mg-cap">새로 살 때만 적용돼요. 이미 가진 종목은 영향 없습니다. 며칠 사이 급하게 오른 종목을 뒤늦게 사는 걸 피합니다.</p>
  </div>;
}

/* ---------- 연습·비용·결과 읽기 ---------- */
function PracticeVisual() {
  const [fee, setFee] = useState(10);
  const pts = [100, 106, 112, 120, 111, 98, 90, 96, 104, 109], W = 520, H = 120;
  const x = i => 30 + i / 9 * (W - 60), y = v => 10 + (125 - v) / 40 * (H - 20);
  return <div className="mg-vis">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최고점 120에서 90까지 25% 하락">
      <path d={pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke={GOLD} strokeWidth="2.5" />
      <line x1={x(3)} x2={x(3)} y1={y(120)} y2={y(90)} stroke={RED} strokeDasharray="3 3" /><line x1={x(3)} x2={x(6)} y1={y(90)} y2={y(90)} stroke={RED} strokeDasharray="3 3" />
      <text x={x(3) + 6} y={y(105)} fill={RED}>최고점에서 −25%</text><text x={x(3)} y={y(120) - 4} textAnchor="middle">120</text><text x={x(6)} y={y(90) + 14} textAnchor="middle">90</text>
    </svg>
    <p className="mg-result">결과에서는 <b>수익률</b>, <b>최고점에서 가장 크게 줄어든 폭</b>, <b>alpha158과의 차이</b> 세 가지만 먼저 보세요.</p>
    <Seg label="거래비용" value={fee} onChange={setFee} options={[[0, '0%'], [10, '0.1%'], [20, '0.2%']]} />
    <p className="mg-cap">거래 100건 × 건당 500만 원이면 비용 약 {man(100 * 500 * fee / 10000)}. 현재 게임 규칙은 0%이고, 0.1·0.2%는 "비용이 있었다면?"을 확인하는 가정입니다.</p>
  </div>;
}

/* ---------- 단계 정의 ---------- */
// jump: 실제 편집 화면의 data-guide 위치 · learnOnly: 학습 모델을 골라야 화면에 나타남 · apply(v): 내 설정에 넣을 값
export const GUIDE_STEPS = [
  { id: 'overview', group: '큰 그림', title: '모델은 이 순서로 종목을 고릅니다', stage: null,
    body: '매 점검일마다 오늘 종가를 보고 ① 후보를 거르고 ② 줄을 세우고 ③ 위에서 몇 종목을 골라 ④ 돈을 나눈 뒤 ⑤ 다음 날 시가에 주문합니다. 아래 설정들은 모두 이 순서 중 한 곳을 바꿉니다.',
    Visual: () => <div className="mg-vis"><p className="mg-result">설정이 많아 보여도 결국 네 가지 질문이에요.</p><ul className="mg-q">
      <li><b>무엇을 볼까?</b> 지표 (수익률, 변동성, 거래량…)</li><li><b>어떻게 고를까?</b> 판단 방법 · 조건</li>
      <li><b>얼마나 살까?</b> 종목 수 · 비율 · 위험 조절</li><li><b>언제 바꿀까?</b> 점검 주기 · 순위 여유</li></ul>
      <p className="mg-cap">처음엔 레퍼런스 하나를 고르고 "얼마나 살까 · 언제 바꿀까"만 바꿔 보는 걸 추천해요.</p></div> },
  { id: 'method', group: '어떻게 고를까', title: '판단 방법: 줄을 세우는 규칙', stage: 2, jump: 'method',
    current: c => ({ ridge: 'Ridge 회귀', randomForest: 'Random Forest', lightgbm: 'LightGBM', xgboost: 'XGBoost', tree: '결정트리', score: '가중치 점수', conditions: '조건 필터' })[c.method], body: '종목마다 점수(또는 예상 수익률)를 매겨 높은 순으로 줄을 세우는 방법입니다. 내가 규칙을 직접 쓰거나, 과거 자료에서 규칙을 배우게 할 수 있어요.',
    Visual: ({ config }) => <MethodVisual method={config.method} /> },
  { id: 'horizon', group: '어떻게 고를까', title: '며칠 뒤의 수익률을 맞힐까', stage: 2, jump: 'method', learnOnly: true,
    current: c => `${c.horizon}거래일 뒤`, key: 'horizon', body: '학습 모델은 "이런 지표였던 종목이 며칠 뒤 얼마나 올랐나"를 보고 배웁니다. 그 며칠을 정하는 설정이에요.',
    Visual: ({ v, set }) => <HorizonVisual value={v} setValue={set} />, apply: v => ({ horizon: v }) },
  { id: 'train', group: '어떻게 고를까', title: '얼마나 오래된 자료까지 배울까', stage: 2, jump: 'method', learnOnly: true,
    current: c => `최대 ${c.trainYears}년`, key: 'trainYears', body: '학습 모델이 공부할 과거 기간입니다. 연습 구간의 자료는 절대 미리 보지 않아요.',
    Visual: ({ v, set }) => <TrainVisual value={v} setValue={set} />, apply: v => ({ trainYears: v }) },
  { id: 'target', group: '어떻게 고를까', title: '무엇을 맞혀 보게 할까', stage: 2, jump: 'target', learnOnly: true,
    current: c => ({ return: '수익률', binary: '상승 여부', threeClass: '3가지', tails: '큰 움직임만' })[c.target], body: '수익률 숫자 자체를 맞힐지, "올랐다/안 올랐다"처럼 나눠서 맞힐지 정합니다.',
    Visual: () => <TargetVisual /> },
  { id: 'representation', group: '어떻게 고를까', title: '지표의 숫자를 읽는 방식', stage: 2, jump: 'target', learnOnly: true,
    current: c => ({ rank: '다른 종목과 비교', raw: '원래 숫자', zscore: '평소와 비교' })[c.representation], body: '같은 지표도 "그대로의 숫자"로 볼지, "오늘 다른 종목 사이에서 몇 등인지"로 볼지에 따라 모델이 배우는 내용이 달라집니다.',
    Visual: () => <RepresentationVisual /> },
  { id: 'memo', group: '어떻게 고를까', title: '전략 이름과 메모', stage: null, jump: 'memo',
    current: c => c.name, body: '저장 목록과 결과 화면에 보이는 이름표예요. 메모는 결과 화면 위에 다시 보여 줘서 "내 예상이 맞았나?"를 돌아볼 수 있게 합니다. 계산에는 전혀 쓰이지 않아요.',
    Visual: () => <div className="mg-vis"><div className="mg-memo"><b>꾸준히 오른 종목 찾기</b><span>메모: 많이 오른 종목이 더 오를 것 같다</span><em>→ 결과 화면: 수익률 +12% · alpha158 대비 +3%p</em></div><p className="mg-cap">비워 둬도 됩니다.</p></div> },
  { id: 'conditions', group: '어떻게 고를까', title: '어떤 종목만 살까 (조건)', stage: 1, jump: 'conditions',
    current: c => c.conditions.length ? `조건 ${c.conditions.length}개` : '조건 없음', body: '줄을 세우기 전에 "이런 종목은 아예 안 본다"는 기준을 거는 곳입니다. 비워 두면 모든 종목이 후보예요.',
    Visual: () => <ConditionVisual /> },
  { id: 'terms', group: '무엇을 볼까', title: '참고할 지표와 가중치', stage: 2, jump: 'terms',
    current: c => `지표 ${c.terms.length}개`, body: '지표는 가격·거래량의 특징을 숫자로 만든 것입니다. 가중치 점수 방법에서는 지표마다 방향과 중요도를 내가 정하고, 학습 모델은 이 지표들을 보고 관계를 스스로 배웁니다.',
    Visual: () => <WeightVisual /> },
  { id: 'reduction', group: '무엇을 볼까', title: '여러 지표를 묶어서 넣기', stage: 2, jump: 'reduction', learnOnly: true,
    current: c => ({ none: '각각 사용', pca: 'PCA', anchoredPca: '가설 PCA' })[c.reduction || 'none'], body: '비슷한 내용을 담은 지표가 여러 개면 몇 개의 요약값으로 묶어 모델에 넣을 수 있어요.',
    Visual: () => <ReductionVisual /> },
  { id: 'money', group: '얼마나 살까', title: '몇 종목에, 얼마씩', stage: 3, jump: 'money', key: 'money',
    current: c => `${c.topK}종목 · 주식 ${c.exposure}% · 한 종목 ${c.maxWeight}%`, body: '줄 세운 종목 중 위에서 몇 개를 살지, 전체 돈 중 얼마를 주식에 쓸지, 한 종목에 최대 얼마까지 넣을지 정합니다. 나머지는 현금으로 둡니다.',
    Visual: ({ v, set }) => <MoneyVisual v={v} set={patch => set({ ...v, ...patch })} />, apply: v => v },
  { id: 'allocation', group: '얼마나 살까', title: '종목마다 금액을 나누는 방식', stage: 4, jump: 'money', key: 'allocation',
    current: c => c.allocation === 'equal' ? '동일 금액' : '덜 흔들리는 종목에 더 많이', body: '고른 종목에 똑같이 넣을지, 차분한 종목에 더 많이 넣을지 정합니다.',
    Visual: ({ v, set }) => <AllocationVisual value={v} setValue={set} />, apply: v => ({ allocation: v }) },
  { id: 'market', group: '얼마나 살까', title: '시장이 약하면 현금으로 쉬기', stage: 4, jump: 'money', key: 'marketMA',
    current: c => c.marketMA ? `코스피 ${c.marketMA}일 평균` : '사용 안 함', body: '코스피가 최근 평균 가격보다 낮으면 "시장이 약하다"고 보고 주식을 팔고 기다립니다.',
    Visual: ({ v, set }) => <MarketVisual value={v} setValue={set} />, apply: v => ({ marketMA: v }) },
  { id: 'targetVol', group: '얼마나 살까', title: '시장이 불안하면 덜 담기', stage: 4, jump: 'money', key: 'targetVol',
    current: c => c.targetVol ? `${c.targetVol}%/년` : '사용 안 함', body: '시장 전체가 크게 흔들리는 시기에는 주식 비중을 자동으로 줄입니다.',
    Visual: ({ v, set }) => <TargetVolVisual value={v} setValue={set} />, apply: v => ({ targetVol: v }) },
  { id: 'risk', group: '얼마나 살까', title: '종목이 크게 흔들릴 때 덜 투자 (위험 모델)', stage: 4, jump: 'risk', key: 'riskTarget',
    current: c => c.riskModel === 'none' ? '사용 안 함' : `${riskNames[c.riskModel]} · 목표 ${c.riskTarget}%`, body: '고른 종목이 앞으로 얼마나 흔들릴지 예상해서, 목표보다 크면 그만큼 덜 삽니다. GARCH·HAR 같은 이름은 "예상하는 방법"의 차이예요.',
    Visual: ({ v, set, config }) => <RiskVisual value={v} setValue={set} model={config.riskModel} />, apply: v => ({ riskTarget: v }) },
  { id: 'stress', group: '얼마나 살까', title: '여러 종목이 함께 급락하면?', stage: null, jump: 'stress',
    current: c => c.stressTest ? '살펴보기' : '살펴보지 않기', body: '가상의 급락 상황을 여러 번 만들어 손실을 미리 가늠해 보는 기능입니다.',
    Visual: () => <StressVisual /> },
  { id: 'rebalance', group: '언제 바꿀까', title: '종목을 다시 고르는 간격', stage: 5, jump: 'rebalance', key: 'rebalanceTurns',
    current: c => `${c.rebalanceTurns}턴마다`, body: '며칠마다 위 과정을 다시 돌려 종목과 금액을 조정할지 정합니다.',
    Visual: ({ v, set }) => <RebalanceVisual value={v} setValue={set} />, apply: v => ({ rebalanceTurns: v }) },
  { id: 'buffer', group: '언제 바꿀까', title: '순위가 조금 떨어져도 유지', stage: 3, jump: 'rebalance', key: 'rankBuffer',
    current: c => `${c.rankBuffer}등`, body: '가진 종목의 순위가 살짝 밀렸다고 바로 팔지 않도록 여유를 줍니다.',
    Visual: ({ v, set }) => <BufferVisual value={v} setValue={set} />, apply: v => ({ rankBuffer: v }) },
  { id: 'ceiling', group: '언제 바꿀까', title: '단기 급등 종목은 새로 사지 않기', stage: 3, jump: 'rebalance', key: 'entryCeiling',
    current: c => c.entryCeiling == null ? '제한 없음' : `5일 +${c.entryCeiling}% 초과 시 보류`, body: '최근 5일 동안 급하게 오른 종목은 새로 사지 않도록 막습니다.',
    Visual: ({ v, set }) => <CeilingVisual value={v} setValue={set} />, apply: v => ({ entryCeiling: v }) },
  { id: 'practice', group: '확인하기', title: '연습하고, 결과를 읽고, 저장하기', stage: null, jump: 'actions',
    current: () => '', body: '"과거 최대 240턴 연습"으로 지금 설정을 과거에 돌려 봅니다. 마음에 들면 "전략 저장"으로 고정하고, 저장한 모델은 자동 투자에 쓸 수 있어요.',
    Visual: () => <PracticeVisual /> },
];
// 그림의 시작값은 실제 설정에서 가져온다. 입력 칸을 비우는 중('')이어도 그림이 깨지지 않게 숫자로 보정한다.
const num = (x, fallback) => (Number.isFinite(Number(x)) && x !== '' ? Number(x) : fallback);
const initial = (step, c) => step.key === 'money'
  ? { topK: Math.max(1, num(c.topK, 10)), exposure: num(c.exposure, 80), maxWeight: Math.max(1, num(c.maxWeight, 20)) }
  : step.key === 'entryCeiling' ? c.entryCeiling : typeof c[step.key] === 'string' ? c[step.key] : num(c[step.key], 0);

// 지금 고른 판단 방법에 없는 설정(학습 모델 전용)은 건너뛴다
export const guideSteps = learn => GUIDE_STEPS.filter(s => !s.learnOnly || learn);
export function guidePosition(id, learn) {
  const steps = guideSteps(learn), i = Math.max(0, steps.findIndex(s => s.id === id));
  return { index: i + 1, total: steps.length, next: steps[i + 1]?.id || null };
}
// 편집 화면 코너 → 그 코너를 설명하는 첫 단계 (코너의 '이게 뭐예요?'와 연결)
export const guideStepFor = (key, learn) => guideSteps(learn).find(s => s.jump === key)?.id || 'overview';

/**
 * '너무 어려워요' 설명서. 편집 화면의 코너와 서로 연결된다.
 * - '실제로 적용하기'·'설명서 닫기' → onLeave(단계, 바꿀 값): 그 단계의 코너로 이동
 * - 코너의 '이게 뭐예요?' → 그 코너를 설명하는 단계로 열림 (startId)
 */
export default function ModelGuide({ config, learn, startId, onLeave }) {
  const steps = guideSteps(learn);
  const [id, setId] = useState(startId);
  const [values, setValues] = useState({});
  const index = Math.max(0, steps.findIndex(s => s.id === id));
  const step = steps[index];
  const v = step.key ? (values[step.id] ?? initial(step, config)) : null;
  const set = next => setValues(all => ({ ...all, [step.id]: next }));
  const groups = [...new Set(steps.map(s => s.group))];
  const Visual = step.Visual;
  const now = step.current?.(config);
  const go = i => setId(steps[i].id);
  return <section className="mg" aria-label="모델 만들기 설명서">
    <header className="mg-head"><div><span className="workshop-kicker">너무 어려워요 · 설명서</span><h3>모델 만들기, 하나씩 알아보기</h3></div>
      <button type="button" onClick={() => onLeave(step, null)}>{step.jump ? '설명서 닫고 이 코너 보기' : '설명서 닫기'}</button></header>
    <details className="mg-toc-wrap"><summary>목차 · 원하는 설정으로 바로 가기</summary>
      <nav className="mg-toc" aria-label="설명 목차">{groups.map(g => <div key={g}><span>{g}</span>
        {steps.map((s, i) => s.group === g && <button type="button" key={s.id} aria-current={i === index ? 'step' : undefined} onClick={() => go(i)}>{s.title.split(':')[0].split(' (')[0]}</button>)}</div>)}</nav></details>
    <div className="mg-progress" aria-hidden="true">{steps.map((s, i) => <i key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''} />)}</div>
    <div className="mg-main">
      <div className="mg-text">
        <span className="mg-count">{index + 1} / {steps.length} · {step.group}</span>
        <h4>{step.title}</h4>
        {(step.stage != null || step.id === 'overview') && <Pipeline active={step.stage} />}
        <p>{step.body}</p>
        {now && <p className="mg-now">지금 내 설정: <b>{now}</b></p>}
        {step.jump && <div className="mg-actions">
          <button type="button" className="btn-primary" onClick={() => onLeave(step, step.apply ? step.apply(v) : null)}>
            {step.apply ? '이 값으로 실제 적용하기' : '실제 설정 코너로 가기'}</button>
        </div>}
        {step.jump && <p className="mg-cap">{step.apply ? '그림에서 고른 값을 넣고 편집 화면의 이 코너로 이동합니다.' : '편집 화면의 이 코너로 이동합니다.'} 거기서 '다음 설명 계속'으로 이어 갈 수 있어요.</p>}
      </div>
      <Visual config={config} v={v} set={set} />
    </div>
    <footer className="mg-foot">
      <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>◀ 이전</button>
      <span>예시 종목과 숫자는 설명용이에요. 실제 결과는 "과거 연습"으로 확인하세요.</span>
      {index < steps.length - 1 ? <button type="button" className="btn-primary" onClick={() => go(index + 1)}>다음 ▶</button>
        : <button type="button" className="btn-primary" onClick={() => onLeave(step, null)}>다 봤어요</button>}
    </footer>
  </section>;
}
