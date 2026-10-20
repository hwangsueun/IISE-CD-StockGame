import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { won, pct, relativeYearDate } from '../utils/format';
import './QuantWorkshop.css';
import { TargetControls, ReductionControls, RiskControls, ResearchResult } from './QuantResearch';
import { strategySignature as signature, restoreStrategyDraft } from '../utils/userStrategy';

const number = value => value == null || !Number.isFinite(value) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const modelOptions = [
  { id: 'ridge', title: '지표의 중요도 배우기', name: 'Ridge 회귀', type: '과거 자료로 학습', description: '수익률을 예측할 때 어떤 지표를 얼마나 반영할지 배웁니다.', output: '배운 가중치로 지표를 더해 예상 수익률 계산' },
  { id: 'randomForest', title: '여러 판단의 평균 내기', name: 'Random Forest', type: '과거 자료로 학습', description: '조금씩 다른 자료로 여러 판단 규칙을 만듭니다. 각 규칙의 예측을 모아 평균냅니다.', output: '하나의 규칙 대신 여러 규칙을 함께 사용' },
  { id: 'lightgbm', title: '틀린 예측을 차례로 보완하기', name: 'LightGBM', type: '과거 자료로 학습', description: '먼저 만든 예측의 오차를 줄이는 규칙을 차례로 더합니다. 도움이 큰 조건부터 더 세밀하게 나눕니다.', output: 'XGBoost와 같은 목적이지만 규칙을 만드는 방법이 달라요' },
  { id: 'xgboost', title: '틀린 예측을 차례로 보완하기', name: 'XGBoost', type: '과거 자료로 학습', description: '먼저 만든 예측의 오차를 줄이는 규칙을 차례로 더합니다. 이 게임에서는 질문을 같은 단계별로 더 나눠 갑니다.', output: 'LightGBM과 같은 조건에서 비교해 볼 수 있어요' },
  { id: 'tree', title: '조건을 따라 판단하기', name: '결정트리 회귀', type: '과거 자료로 학습', description: '“최근에 올랐나?”처럼 지표에 따른 질문과 갈림길을 배웁니다. 도착한 조건에서 수익률을 예측합니다.', output: '어떤 조건을 거쳤는지 결과에서 확인' },
  { id: 'score', title: '내가 점수 매기기', name: '가중치 점수', type: '내가 규칙 작성', description: '수익률은 높게 보고 변동성은 낮게 보는 식으로 지표마다 방향과 중요도를 직접 정합니다.', output: '내 점수가 높은 종목부터 선택' },
  { id: 'conditions', title: '내 조건으로 걸러내기', name: '조건 필터', type: '내가 규칙 작성', description: '“최근 60일 수익률이 0% 이상”처럼 통과할 기준을 직접 정합니다.', output: '조건을 통과한 종목 중에서 선택' },
];
const methods = Object.fromEntries(modelOptions.map(model => [model.id, model.name]));
function featureHelp(id) {
  const days = id.match(/\d+/)?.[0];
  if (id.startsWith('return')) return `${days}거래일 전보다 가격이 얼마나 올랐는지 봅니다. 5%면 그때보다 5% 오른 가격이에요.`;
  if (id.startsWith('skip')) return `최근 20거래일의 움직임은 빼고 그 이전 ${days}거래일 동안의 수익률을 봅니다.`;
  if (id.startsWith('vol')) return id === 'volume20' ? '오늘 거래된 주식 수가 평소의 몇 배인지 봅니다. 2배면 직전 20일 평균의 두 배예요.' : `최근 ${days}거래일 수익률의 흔들림입니다. 높을수록 크게 오르내렸다는 뜻이에요. 1년 기준으로 환산한 값입니다.`;
  if (id.startsWith('ma')) return `최근 ${days}거래일의 평균 가격과 비교합니다. +5%면 평균보다 5% 비싸고 −5%면 5% 저렴해요.`;
  if (id.startsWith('parkinson')) return `하루 최고가와 최저가가 벌어진 정도로 최근 ${days}거래일의 흔들림을 봅니다. 1년 기준으로 환산한 값입니다.`;
  if (id === 'amount20') return '최근 20거래일 동안 하루 평균 얼마어치가 거래됐는지 봅니다. 단위는 억 원이에요.';
  if (id === 'position60') return '최근 60일 종가 중 가장 낮은 가격은 0%이고 가장 높은 가격은 100%입니다. 오늘 종가가 그 사이 어디쯤인지 봅니다.';
  if (id === 'riskMomentum') return '최근 20일을 뺀 120일 수익률을 가격의 흔들림으로 나눈 값입니다. 같은 수익률이면 덜 흔들린 종목의 값이 커져요.';
  return '';
}
function Field({ label, children, note }) { return <label className="workshop-field"><span>{label}</span>{children}{note && <small>{note}</small>}</label>; }
function Choice({ label, value, options, onChange, numeric = false, note }) {
  return <Field label={label} note={note}><select value={value} onChange={e => onChange(numeric ? Number(e.target.value) : e.target.value)}>
    {options.map(([v, text]) => <option value={v} key={v}>{text}</option>)}</select></Field>;
}
function Numeric({ label, value, onChange, min, max, step = 1, note }) {
  return <Field label={label} note={note}><input type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} /></Field>;
}
function Curve({ rows, lines = [['own', '내 전략', '#d7b874'], ['rival', 'alpha158', '#a5bd9b'], ['equal', '동일금액 보유', '#9cbce1'], ['benchmark', '코스피 참고', '#bd9fc9']] }) {
  const values = rows.flatMap(r => lines.map(([k]) => r[k]).filter(Number.isFinite));
  if (!values.length) return null;
  const lo = Math.min(0, ...values), hi = Math.max(.01, ...values), span = hi - lo || .01;
  const x = i => 54 + i / Math.max(1, rows.length - 1) * 632, y = v => 190 - (v - lo) / span * 162;
  return <figure className="workshop-curve"><svg role="img" aria-label={`${lines.map(l => l[1]).join(' · ')} 누적 수익률`} viewBox="0 0 710 228">
    {[lo, lo + span / 2, hi].map(v => <g key={v}><line x1="54" y1={y(v)} x2="686" y2={y(v)} stroke="#655b47" strokeDasharray="3 4" /><text x="47" y={y(v) + 4} textAnchor="end">{(v * 100).toFixed(0)}%</text></g>)}
    {lines.map(([key, , color]) => <path key={key} d={rows.map((r, i) => Number.isFinite(r[key]) ? `${i === 0 || !Number.isFinite(rows[i - 1]?.[key]) ? 'M' : 'L'}${x(i)},${y(r[key])}` : '').join(' ')} fill="none" stroke={color} strokeWidth={key === 'own' ? 3 : 1.6} />)}
    <text x="54" y="215">1턴</text><text x="686" y="215" textAnchor="end">{rows.length}턴</text>
  </svg><figcaption>{lines.filter(([k]) => rows.some(r => Number.isFinite(r[k]))).map(([key, title, color]) => <span key={key}><i style={{ background: color }} />{title}</span>)}</figcaption></figure>;
}
function Result({ report, workspace, dirty, onBuild, onAsset }) {
  const feature = id => /^axis[1-5]$/.test(id) ? `요약값 ${id.slice(4)}` : workspace.features.find(f => f.id === id)?.name || id;
  const ref = workspace.references.find(r => r.id === report.config.referenceId);
  const decision = report.decision;
  return <div className="workshop-result">
    <div className="workshop-result-heading"><div><span className="workshop-kicker">{report.kind === 'observe' ? '저장 이후 관찰 · 규칙 고정' : '과거 연습 · 반복해서 수정 가능'}</span>
      <h4>{report.config.name}</h4><p>{report.config.hypothesis || '가설을 적으면 결과와 함께 다시 돌아볼 수 있어요.'}</p></div>
      <button type="button" onClick={onBuild}>이 설정으로 수정</button></div>
    {dirty && <p className="workshop-notice">현재 편집한 설정과 다른 결과입니다. 수정 후 다시 연습해 주세요.</p>}
    <p>{relativeYearDate(report.from, workspace.date)} ~ {relativeYearDate(report.to, workspace.date)} · {report.turnCount}턴 · 초기 자금 {won(report.initialCash)} · 편도 비용 {report.feeBps / 100}%</p>
    <div className="workshop-metrics"><div><span>내 전략 수익률</span><strong>{pct(report.own.returnRate)}</strong></div>
      <div><span>가장 크게 줄어든 폭</span><strong>{pct(Math.abs(report.own.maxDrawdown))}</strong></div><div><span>체결 거래</span><strong>{report.own.tradeCount}건</strong></div></div>
    <p>가장 크게 줄어든 폭은 자산이 최고점에서 얼마나 내려갔는지 보여 줍니다. 100만 원이 120만 원까지 올랐다가 90만 원이 됐다면 25%입니다. 이를 최대 낙폭이라고 해요.</p>
    <Curve rows={report.chart} />
    <div className="workshop-scroll"><table className="data-table"><thead><tr><th>비교 대상</th><th>누적 수익률</th><th>최고점에서 줄어든 폭</th><th>거래 수</th></tr></thead>
      <tbody>{[['내 전략', report.own], ['alpha158', report.rival], ['첫날 동일금액 매수·보유', report.equal]].map(([name, r]) => <tr key={name}><td>{name}</td><td>{r ? pct(r.returnRate) : '자료 없음'}</td><td>{r ? pct(Math.abs(r.maxDrawdown)) : '—'}</td><td>{r?.tradeCount ?? '—'}</td></tr>)}
        <tr><td>코스피 종가 참고지수</td><td>{report.benchmarkReturn == null ? '자료 없음' : pct(report.benchmarkReturn)}</td><td>—</td><td>—</td></tr></tbody></table></div>
    {report.rivalNote && <p>{report.rivalNote.replaceAll('기존 퀀트', 'alpha158')}</p>}
    <p>내 전략·alpha158·동일금액 보유는 같은 초기 자금과 기간, 비용으로 비교합니다. 다음 개장일 시가에 정수 수량으로 체결합니다.</p>
    <details className="workshop-details"><summary>20턴마다 비교하기 · 완료한 {report.monthly.length}개 구간</summary>
      <p>이 결과의 시작일부터 20턴씩 나눕니다. 투자 챌린지의 실제 상금은 내 게임 계좌 성과로 결정됩니다.</p>
      {report.monthly.length ? <div className="workshop-scroll"><table className="data-table"><thead><tr><th>구간</th><th>내 전략</th><th>alpha158</th><th>차이</th></tr></thead><tbody>
        {report.monthly.map(m => <tr key={m.month}><td>{m.month}번째 20턴</td><td>{pct(m.returnRate)}</td><td>{m.rivalReturn == null ? '—' : pct(m.rivalReturn)}</td><td>{m.rivalReturn == null ? '—' : `${((m.returnRate - m.rivalReturn) * 100).toFixed(2)}%p`}</td></tr>)}
      </tbody></table></div> : <p>20턴이 쌓이면 첫 비교가 나타납니다.</p>}</details>
    {decision && <section className="workshop-section"><h4>{report.kind === 'observe' ? '현재 규칙이 선택한 종목' : '연습 마지막 시점의 선택 근거'}</h4>
      <p>자료 기준: {relativeYearDate(decision.date, workspace.date)} · {decision.reviewDue ? '정기 점검 시점' : '정기 점검 사이의 참고 신호'}</p>
      {decision.reasons.map(reason => <p key={reason}>{reason}</p>)}
      <p>목표 현금 {pct(decision.cashWeight)} · 조건 통과 {decision.candidates}종목 · 자료 부족 {decision.excluded.missing}종목 · 조건 제외 {decision.excluded.conditions}종목</p>
      {!decision.rows.length && <p className="workshop-notice">조건을 충족한 종목이 없습니다. 현금으로 대기합니다.</p>}
      {decision.rows.map(row => <details className="workshop-stock" key={row.id}><summary><span>{row.rank}위 · {row.name}</span><span>전체 자금의 {pct(row.targetWeight, 1)}{report.config.method !== 'conditions' && (row.probabilities ? ` · 상승 추정 ${pct(row.score)}` : report.config.method === 'score' ? ` · 내 점수 ${row.score.toFixed(4)}` : ` · 예상 수익률 ${pct(row.score)}`)}</span></summary>
        <dl>{row.checks.map((c, i) => <div key={i}><dt>{feature(c.feature)}</dt><dd>{number(c.observed)}{c.measure === 'rank' ? ' / 100 위치' : ''} · {c.value} {c.op === 'gte' ? '이상' : '이하'} 조건 {c.passed ? '통과' : '미충족'}</dd></div>)}
          {row.probabilities && <div><dt>각 구간의 추정값</dt><dd>{row.probabilities.map((p,i)=>`${row.probabilities.length === 3 ? ['하락','중립','상승'][i] : i ? '상승' : report.config.target === 'tails' ? '하락' : '비상승'} ${pct(p)}`).join(' · ')}</dd></div>}
          {row.contributions?.map(c => <div key={c.feature}><dt>{feature(c.feature)}</dt><dd>{row.axisValues ? `요약 값 ${number(row.axisValues[c.feature])}` : `실제 값 ${number(row.values[c.feature])} · 종목 사이의 위치 ${number(row.ranks[c.feature])} / 100`} · {row.explanationMethod === 'path_delta' ? '분기에 따른 예측값 변화' : '점수 기여'} {c.value.toFixed(4)}</dd></div>)}
          {row.intercept != null && <div><dt>학습 기준값</dt><dd>{row.intercept.toFixed(4)}</dd></div>}
          {row.path?.map((c, i) => <div key={i}><dt>{feature(c.feature)}</dt><dd>{c.representation === 'raw' ? `현재 값 ${number(c.observed)} · 기준 ${number(c.rawThreshold)} ${c.direction}로 판단` : `종목 사이의 위치 ${number(c.percentile)} / 100 · 기준 ${number(c.threshold)} ${c.direction}로 판단`}</dd></div>)}
          {row.leafCount != null && <div><dt>같은 조건으로 분류된 과거 사례</dt><dd>{row.leafCount}건</dd></div>}
        </dl>{row.contributions?.length > 0 && <p>지표별 기여 값이 양수면 모델의 판단을 높인 정보이고 음수면 낮춘 정보입니다. 모델이 계산한 이유를 보여 주며 실제 주가가 움직인 원인을 설명하는 값은 아닙니다.</p>}
        {row.treeCount && <details><summary>여러 판단 규칙을 합산한 방법</summary><p>{row.treeCount}개 결정트리의 분기 전후 변화를 지표별로 합쳤습니다. {row.explanationMethod === 'margin_path_delta' ? '기여 값은 확률로 바꾸기 전 상승 점수의 변화입니다. 이 숫자들을 더한 값이 상승 확률과 바로 같지는 않습니다.' : '기준값에 각 변화량을 더하면 최종 예측값이 됩니다.'} SHAP 값은 아닙니다.</p></details>}
        {report.kind === 'observe' && <button type="button" onClick={() => onAsset(row.id)}>게임에서 종목 살펴보기</button>}</details>)}
      <p>저장한 모델의 자동 투자를 켜면 게임 계좌에도 주문을 실행합니다. 보유 종목의 순위가 조금 떨어져도 유지하도록 설정했다면 그 종목이 남을 수 있습니다.</p>
    </section>}
    <ResearchResult report={report} workspace={workspace} />
    {report.model && <details className="workshop-details"><summary>학습 범위와 고정된 모델</summary><p>{report.model.target}</p>
      <p>학습 모델: {methods[report.model.method]}{report.model.library && ` · ${report.model.library} ${report.model.libraryVersion} · 나무 ${(report.model.ensemble?.trees.length ?? 1)}개`}</p>
      <p>학습 정답이 확인된 마지막 날: {relativeYearDate(report.model.trainedThrough, workspace.date)} · {report.model.sampleCount.toLocaleString()}개 사례 · {report.model.trainingDates}개 관측일. 5개장일 간격으로 학습 사례를 추출합니다. 평가 기간에는 다시 학습하지 않습니다.</p>
      {report.model.coefficients && <ul>{report.model.keys.map((key, i) => <li key={key}>{feature(key)}: {report.model.coefficients[i].toFixed(4)}</li>)}</ul>}
    </details>}
    <details className="workshop-details"><summary>이 결과를 해석할 때</summary><ul>{report.limitations.map(s => <li key={s}>{s}</li>)}</ul>
      {ref && <p>참고: <a href={ref.url} target="_blank" rel="noreferrer">{ref.author}</a>. 게임용 변형이며 원문의 성과를 재현했다고 주장하지 않습니다.</p>}</details>
  </div>;
}
function Comparison({ report, workspace, config, onBuild, onAsset }) {
  const [selected, setSelected] = useState(0);
  const current = report.reports[selected] || report.reports[0];
  const custom = report.comparison === 'custom';
  const observing = custom && report.comparisonPeriod === 'observe';
  const label = r => r.variantLabel || methods[r.config.method];
  const colors = ['#d7b874','#9cbce1','#c7a5cf','#f7a37b'];
  const lines = [...report.reports.map((r,i)=>[`variant${i}`,label(r),colors[i%colors.length]]), ['rival','alpha158','#a5bd9b'],
    ...(custom ? [['benchmark','코스피','#b9ada1']] : [])];
  const chart = report.reports[0].chart.map((r,i)=>({turn:r.turn,rival:r.rival,benchmark:r.benchmark,...Object.fromEntries(report.reports.map((p,j)=>[`variant${j}`,p.chart[i].own]))}));
  return <><section className="workshop-section" aria-label="모델 비교 결과"><span className="workshop-kicker">{custom ? observing ? '저장 후 같은 기간 관찰' : '같은 과거로 연습' : '한 가지 설정을 바꿔서 비교'}</span>
    <h4>{custom ? `${report.reports.length}개 투자 모델 비교` : {models:'판단 방법을 바꾸면?',labels:'맞혀 볼 결과를 바꾸면?',risk:'불안할 때 덜 투자하면?',reduction:'지표를 묶어서 사용하면?'}[report.comparison || 'models']}</h4>
    {custom ? <p>{observing
      ? `마지막 모델을 저장한 ${report.commonStartTurn}턴부터 모두 같은 자금으로 시작합니다. 저장할 때 배운 내용과 설정을 그대로 사용합니다. 각 모델의 개별 관찰 결과와 시작 시점이 다를 수 있습니다.`
      : '각 모델의 설정을 같은 과거 기간에 적용합니다. 학습이 필요한 모델은 연습 시작 이전의 자료만으로 다시 학습합니다.'} 초기 자금·기간·거래비용·체결 규칙을 맞췄습니다.</p>
      : <p>투자 대상·초기 자금·기간·비용·체결 규칙을 맞췄습니다. {report.comparison === 'labels' ? '중립 제외 설정은 학습 사례 수와 평가 대상이 달라집니다. 확률 점수의 단순 우열보다 같은 기간의 매매 성과를 함께 보세요.' : report.comparison === 'risk' ? '종목을 고르는 수익 모델은 동일한 학습값을 사용합니다.' : '모델에 같은 지표와 학습 사례를 넣었습니다.'}</p>}
    {custom && <p>{relativeYearDate(report.from, workspace.date)} ~ {relativeYearDate(report.to, workspace.date)}</p>}
    <p>{report.turnCount}턴 · 초기 자금 {won(report.initialCash)} · 편도 비용 {report.feeBps/100}% · 평가 중 재학습 없음</p>
    {observing && report.turnCount < 2 && <p className="workshop-notice">아직 같은 기간에 쌓인 거래가 없습니다. 다음 턴을 진행한 뒤 다시 비교해 주세요.</p>}
    <Curve rows={chart} lines={lines} />
    <div className="workshop-scroll"><table className="data-table"><thead><tr><th>설정</th><th>수익률</th><th>최고점에서 줄어든 폭</th><th>거래</th></tr></thead><tbody>{report.reports.map((r,i)=><tr key={i}><td>{label(r)}{custom && <small className="workshop-comparison-method">{methods[r.config.method]}</small>}</td><td>{pct(r.own.returnRate)}</td><td>{pct(Math.abs(r.own.maxDrawdown))}</td><td>{r.own.tradeCount}건</td></tr>)}</tbody></table></div>
    {!observing && <p>반복해서 확인하는 과거 연습입니다. 이 비교의 최고 수익률이 다음 기간의 성과를 보장하지 않습니다.</p>}
    <nav className="workshop-nav" aria-label="비교 설정 상세">{report.reports.map((r,i)=><button type="button" key={i} aria-pressed={current===r} onClick={()=>setSelected(i)}>{label(r)} 상세</button>)}</nav>
  </section><Result report={current} workspace={workspace} dirty={!custom && signature(report.config)!==signature(config)} onBuild={()=>onBuild(current.config)} onAsset={onAsset} /></>;
}
export default function QuantWorkshop({ sessionId, turnNumber }) {
  const [workspace, setWorkspace] = useState(null), [config, setConfig] = useState(null), [view, setView] = useState('references');
  const [report, setReport] = useState(null), [feeBps, setFeeBps] = useState(10), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [autoBusy,setAutoBusy]=useState(false);
  const [comparisonIds, setComparisonIds] = useState([]), [comparisonPeriod, setComparisonPeriod] = useState('practice');
  const alive = useRef(true), saveKey = useRef(null), pending = useRef(false);
  const openModal = useGameStore(s => s.openModal);
  const draftKey = `antsurvival_strategy_draft_v1:${sessionId}`;
  useEffect(() => {
    alive.current = true;
    api.getStrategyWorkspace(sessionId).then(w => {
      if (!alive.current) return;
      setWorkspace(w); setConfig(current => {
        if (current) return current;
        try { return restoreStrategyDraft(localStorage.getItem(draftKey), w.blank, w.features); } catch { /* Storage can be unavailable. */ }
        return w.blank;
      });
    }).catch(e => { if (alive.current) setError(e.message); });
    return () => { alive.current = false; };
  }, [sessionId, turnNumber, draftKey]);
  useEffect(() => { if (config) try { localStorage.setItem(draftKey, JSON.stringify(config)); } catch { /* Server-saved versions remain available. */ } }, [config, draftKey]);
  const update = patch => { setConfig(c => { const next={ ...c, ...patch, researchVersion: 1 }; if(next.terms.length>1)next.components=Math.min(next.components,next.terms.length-1); return next; }); saveKey.current = null; setMessage(''); };
  const replace = next => { setConfig(structuredClone({ ...workspace.blank, ...next, researchVersion: 1 })); saveKey.current = null; setView('build'); setMessage(''); setError(''); };
  const refresh = async () => { const w = await api.getStrategyWorkspace(sessionId); if (alive.current) setWorkspace(w); };
  const act = async fn => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try { await fn(); } catch (e) { if (alive.current) setError(e.message); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const practice = () => act(async () => { const r = await api.practiceStrategy(sessionId, config, feeBps); if (alive.current) { setReport(r); setView('results'); } await refresh(); });
  const compare = () => act(async () => { const r = await api.compareStrategies(sessionId, config, feeBps); if (alive.current) { setReport(r); setView('results'); } await refresh(); });
  const compareSaved = () => act(async () => {
    const r = await api.compareSavedStrategies(sessionId, comparisonIds, comparisonPeriod, feeBps);
    if (alive.current) { setReport(r); setView('results'); }
    await refresh();
  });
  const automate = async (enabled,versionId) => {
    if(autoBusy)return; setAutoBusy(true);setError('');
    try {const automation=await api.setStrategyAutomation(sessionId,enabled,versionId);await refresh();if(alive.current)setMessage(enabled
      ? automation.paused ? `자동 투자 설정을 저장했습니다. ${automation.pauseReason} 제한이 풀리면 다음 턴 진행부터 다시 판단합니다.`
        : '자동 투자를 켰습니다. 다음 턴 진행부터 저장한 모델로 판단합니다.'
      : '자동 투자를 해제했습니다. 대기 중인 자동 주문을 취소했습니다. 보유 주식은 유지합니다.');}
    catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setAutoBusy(false);}
  };
  const save = () => act(async () => {
    saveKey.current ||= crypto.randomUUID();
    const saved = await api.saveStrategy(sessionId, config, saveKey.current);
    await refresh(); if (alive.current) {
      setComparisonIds(ids => ids.includes(saved.id) || ids.length >= 4 ? ids : [...ids, saved.id]);
      setMessage('모델을 저장했습니다. 다른 모델을 더 만들어 결과를 비교할 수 있습니다.'); setView('versions');
    }
  });
  const observe = id => act(async () => { const r = await api.observeStrategy(sessionId, id); if (alive.current) { setReport(r); setView('results'); } });
  const oldReport = id => act(async () => { const r = await api.getStrategyRun(sessionId, id); if (alive.current) { setReport(r); setView('results'); } });
  if (!workspace || !config) return <div className="workshop"><p role={error ? 'alert' : 'status'}>{error || '전략 도구를 준비하고 있습니다…'}</p></div>;
  const options = workspace.features.map(f => [f.id, `${f.name} (${f.unit})`]);
  const learn = ['ridge', 'tree', 'randomForest', 'lightgbm', 'xgboost'].includes(config.method);
  const unavailable = id => ['randomForest', 'lightgbm', 'xgboost'].includes(id) && !workspace.modelCapabilities?.[id]?.available;
  const currentRef = workspace.references.find(r => r.id === config.referenceId);
  const changeTerm = (i, patch) => update({ terms: config.terms.map((t, j) => i === j ? { ...t, ...patch } : t) });
  const changeRule = (i, patch) => update({ conditions: config.conditions.map((t, j) => i === j ? { ...t, ...patch } : t) });
  return <div className="workshop" aria-busy={busy}>
    <div className="workshop-intro"><span className="workshop-kicker">내 아이디어로 종목을 고르는 도구</span><h3>나만의 투자 모델 만들기</h3>
      <p>모델은 종목을 고르고 투자 금액을 정하는 방법입니다. 예시 아이디어에서 시작해도 좋아요. 과거 자료로 연습한 뒤 저장하면 게임을 진행하며 성과를 확인할 수 있습니다.</p>
      <div className="workshop-flow"><span>01 참고하기</span><span>02 판단 방법 정하기</span><span>03 연습하기</span><span>04 저장하고 지켜보기</span></div></div>
    <section className="workshop-automation" aria-label="모델 자동 투자">
      <div><strong>모델로 자동 투자 · {workspace.automation?.enabled ? workspace.automation.paused ? '일시정지' : '켜짐' : '꺼짐'}</strong>
        <p>{workspace.automation?.enabled ? `${workspace.automation.name} · 내 주식과 사용 가능한 현금으로 운용합니다.` : '저장한 모델에서 자동 투자를 켤 수 있습니다. 내 주식과 사용 가능한 현금으로 운용합니다.'}</p>
        {workspace.automation?.paused && <p role="status">{workspace.automation.pauseReason}{workspace.automation.resumeTurn && workspace.automation.resumeTurn < 240 ? ` ${workspace.automation.resumeTurn}턴부터 다시 판단할 수 있습니다.` : ''} 제한이 풀린 뒤 다음 턴을 진행하면 재개합니다.</p>}
        <p>입원 중이거나 부업을 한 날에는 자동 투자도 쉽니다. 아직 체결되지 않은 주문은 취소하고, 재개할 때 최신 가격과 잔액으로 다시 판단합니다.</p>
        {workspace.automation?.lastResult && <p>{workspace.automation.lastTurn}턴: {workspace.automation.lastResult.reason}</p>}
      </div>{workspace.automation?.enabled ? <button type="button" disabled={autoBusy} onClick={()=>automate(false)}>자동 투자 해제</button> : <button type="button" onClick={()=>setView('versions')}>저장한 모델 선택</button>}
    </section>
    <nav className="workshop-nav" aria-label="전략 제작 단계">{[['references', '전략 레퍼런스'], ['build', '내 전략 편집'], ['compare', '모델 비교'], ['results', '연습·관찰 결과'], ['versions', '저장·연습 기록']].map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} disabled={busy} onClick={() => setView(id)}>{label}</button>)}</nav>
    {error && <p role="alert" className="workshop-error">{error}</p>}{message && <p role="status" className="workshop-notice">{message}</p>}
    {busy && <p role="status" className="workshop-notice">게임 시점까지의 자료로 계산하고 있습니다… 최대 2분 정도 걸릴 수 있어요.</p>}
    <fieldset className="workshop-body" disabled={busy}>
    {view === 'compare' && <section className="workshop-section" aria-label="저장한 모델 비교">
      <div className="workshop-section-heading"><div><h4>내 모델들을 나란히 비교하기</h4>
        <p>서로 다른 지표와 투자 규칙을 설정한 모델을 2~4개 선택하세요.</p></div>
        <button type="button" onClick={() => replace(workspace.blank)}>새 모델 만들기</button></div>
      {workspace.versions.length < 2 && <p className="workshop-notice">모델을 두 개 이상 저장하면 비교할 수 있습니다. 저장한 모델을 복사해서 다른 설정을 만들어도 좋아요.</p>}
      <div className="workshop-compare-options">{workspace.versions.map((v, i) => {
        const checked = comparisonIds.includes(v.id);
        return <label className={`workshop-compare-option${checked ? ' is-selected' : ''}`} key={v.id}>
          <input type="checkbox" checked={checked} disabled={!checked && comparisonIds.length >= 4}
            onChange={() => setComparisonIds(ids => checked ? ids.filter(id => id !== v.id) : [...ids, v.id])}
            aria-label={`${v.config.name} · 저장 모델 ${i + 1} 비교 선택`} />
          <span><strong>{v.config.name}</strong><small>{methods[v.config.method]} · {v.saved_turn}턴에 저장</small>
            <small>{v.config.terms.length}개 지표 · {v.config.conditions.length}개 조건 · 최대 {v.config.topK}종목 · 주식 {v.config.exposure}%</small></span>
        </label>;
      })}</div>
      <div className="workshop-grid">
        <Choice label="어느 기간을 비교할까요?" value={comparisonPeriod}
          options={[[ 'practice', '같은 과거로 연습 · 최대 240턴'], ['observe', '저장 후 같은 기간 관찰']]} onChange={setComparisonPeriod} />
        {comparisonPeriod === 'practice' && <Choice label="살 때와 팔 때 각각 적용할 거래비용" numeric value={feeBps}
          options={[[0, '0% · 현재 게임 규칙'], [10, '0.1% · 비용 가정'], [20, '0.2% · 비용 가정']]} onChange={setFeeBps} />}
      </div>
      <p>{comparisonPeriod === 'practice'
        ? '게임의 오늘까지 공개된 과거 자료로 비교합니다. 학습이 필요한 모델은 연습 시작 이전 자료로 학습합니다.'
        : '마지막 모델을 저장한 날부터 비교합니다. 모든 모델을 같은 초기 자금으로 시작하고 저장할 때 배운 내용은 유지합니다.'}</p>
      <p>공통 초기 자금 {won(workspace.initialCash)} · 수익률 추이, 최고점에서 줄어든 폭, 거래 수를 함께 볼 수 있습니다.</p>
      <button className="btn-primary" type="button" disabled={comparisonIds.length < 2} onClick={compareSaved}>선택한 {comparisonIds.length}개 모델 비교</button>
    </section>}
    {view === 'references' && <>
      <div className="workshop-section-heading"><p>어떤 생각으로 투자할지 예시를 골라 보세요. 판단 방법과 참고할 지표는 모두 바꿀 수 있어요.</p><button type="button" onClick={() => replace(workspace.blank)}>빈 전략에서 시작</button></div>
      <div className="workshop-library">{workspace.references.filter(ref=>ref.template).map(ref => <article className="workshop-reference" key={ref.id}>
        <h4>{ref.title}</h4><p>{ref.hypothesis}</p>
        <details><summary>어떤 아이디어인지 자세히 보기</summary><dl><dt>원본 아이디어</dt><dd>{ref.original}</dd><dt>게임에서의 변형</dt><dd>{ref.adaptation}</dd><dt>실패할 수 있는 상황</dt><dd>{ref.risk}</dd><dt>직접 검증할 질문</dt><dd>{ref.question}</dd></dl>
          <a href={ref.url} target="_blank" rel="noreferrer">{ref.author} · {ref.year} ↗</a></details>

        <button type="button" disabled={!ref.template} onClick={() => replace(ref.template)}>이 아이디어로 만들기</button>
      </article>)}</div>
    </>}
    {view === 'build' && <>
      <section className="workshop-section" aria-labelledby="workshop-model-title"><h4 id="workshop-model-title">어떤 방법으로 종목을 고를까요?</h4>
        <p>과거 사례에서 판단 방법을 배우게 하거나 내가 규칙을 직접 정할 수 있어요. 아래의 모델 중 하나를 선택하세요.</p>
        <div className="workshop-models" role="radiogroup" aria-labelledby="workshop-model-title">
          {modelOptions.map(model => <label className={`workshop-model${config.method === model.id ? ' is-selected' : ''}`} key={model.id}>
            <input type="radio" name="workshop-model" value={model.id} checked={config.method === model.id} disabled={unavailable(model.id)}
              onChange={() => update({ method: model.id, ...(!['randomForest','lightgbm','xgboost'].includes(model.id) ? { target: 'return', tradePolicy: 'rank', ...(['conditions','score'].includes(model.id)?{reduction:'none'}:{}) } : {}) })} aria-describedby={`workshop-model-${model.id}-description`} />
            <span className="workshop-model-content"><small>{model.type}</small><strong>{model.title}</strong><span className="workshop-model-name">{model.name}</span>
              <span id={`workshop-model-${model.id}-description`}>{model.description}</span><span className="workshop-model-output">{unavailable(model.id) ? '현재 이 모델의 학습 기능을 사용할 수 없습니다' : model.output}</span></span>
          </label>)}
        </div>
        <p className="workshop-model-current" role="status">현재 선택: <b>{methods[config.method]}</b> · {learn ? '데이터로 학습' : '직접 작성한 규칙 사용'}</p>
        <div className="workshop-grid"><Choice label="며칠 뒤의 수익률을 예측할까요?" numeric value={config.horizon} options={[[1, '1거래일 뒤'], [5, '5거래일 뒤'], [10, '10거래일 뒤'], [20, '20거래일 뒤']]} onChange={horizon => update({ horizon })} note="거래일은 주식시장이 열리는 날입니다." />
          <Choice label="얼마나 오래된 자료까지 배울까요?" numeric value={config.trainYears} options={[[1, '최대 1년'], [2, '최대 2년'], [3, '최대 3년']]} onChange={trainYears => update({ trainYears })} />
        </div>
        <details className="workshop-details"><summary>세부 학습 설정 · 직접 바꿔 볼 수 있어요</summary>
          <p>위 기간과 아래 설정은 학습 모델을 실행하거나 비교할 때 사용합니다. 직접 만든 점수·조건 규칙에는 적용하지 않습니다.</p>
          <div className="workshop-grid">
            <Choice label="Ridge · 특정 지표에 치우치는 정도 줄이기" numeric value={config.ridgePenalty} options={[[.03, '약하게 (0.03)'], [.1, '보통 (0.1)'], [.3, '강하게 (0.3)'], [1, '매우 강하게 (1)']]} onChange={ridgePenalty => update({ ridgePenalty })} note="강하게 할수록 학습하는 가중치의 크기를 더 억제합니다." />
            {config.method === 'tree' && <Choice label="결정트리 · 질문을 몇 단계 이어 갈까요?" numeric value={config.treeDepth} options={[[1, '1단계'], [2, '2단계'], [3, '3단계']]} onChange={treeDepth => update({ treeDepth })} />}
            <Choice label="여러 나무 모델 · 만들 판단 규칙 수 상한" numeric value={config.ensembleTrees} options={[[50, '50개'], [100, '100개'], [200, '200개']]} onChange={ensembleTrees => update({ ensembleTrees })} note="Random Forest·LightGBM·XGBoost에 적용합니다." />
            <Choice label="여러 나무 모델 · 질문 단계 수 상한" numeric value={config.ensembleDepth} options={[[3, '3단계'], [5, '5단계'], [8, '8단계']]} onChange={ensembleDepth => update({ ensembleDepth })} note="단계가 많으면 더 세밀한 조건을 배울 수 있지만 과거에만 맞는 규칙이 될 수도 있어요." />
            <Choice label="적은 자료로 세부 규칙을 만드는 것 제한" numeric value={config.minLeaf} options={[[10, '약하게 · 10'], [30, '보통 · 30'], [50, '강하게 · 50']]} onChange={minLeaf => update({ minLeaf })} note="클수록 적은 근거만으로 질문을 더 나누기 어렵게 합니다." />
            <Choice label="LightGBM·XGBoost · 새 규칙을 반영하는 크기" numeric value={config.learningRate} options={[[.03, '0.03 · 조금씩 보완'], [.05, '0.05'], [.1, '0.1 · 크게 보완']]} onChange={learningRate => update({ learningRate })} />
          </div>
          <details><summary>알고리즘 용어와 구현 보기</summary><p>판단 규칙은 결정트리입니다. 질문 단계 수는 나무 깊이이며 새 규칙을 반영하는 크기는 학습률입니다. 최소 분기 기준은 Random Forest·LightGBM에서 사례 수를 사용합니다. XGBoost는 사례 수 대신 헤시안 합을 사용합니다.</p><p><a href="https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestRegressor.html" target="_blank" rel="noreferrer">Random Forest 설명 ↗</a> · <a href="https://lightgbm.readthedocs.io/en/v4.6.0/pythonapi/lightgbm.LGBMRegressor.html" target="_blank" rel="noreferrer">LightGBM 설명 ↗</a></p></details>
        </details>
        <p>{learn ? '연습 시작 전까지 확인할 수 있었던 과거 사례로만 배웁니다. 저장하면 배운 모델을 고정해 이후 게임에서 성과를 지켜봅니다.' : '직접 만든 규칙은 별도 학습 없이 실행합니다. 같은 지표를 사용하는 학습 모델과도 비교할 수 있어요.'}</p>
      </section>
      <TargetControls config={config} update={update} learn={learn} />
      <section className="workshop-section"><h4>어떤 생각으로 투자하나요?</h4><Field label="전략 이름"><input maxLength={60} value={config.name} onChange={e => update({ name: e.target.value })} /></Field>
        <Field label="어떤 종목을 고르면 좋을까요?"><textarea rows={2} maxLength={500} value={config.hypothesis} placeholder="예: 꾸준히 오른 종목이 잠깐 조정받았을 때 매수한다." onChange={e => update({ hypothesis: e.target.value })} /></Field>
        {currentRef && <p>참고한 아이디어: <a href={currentRef.url} target="_blank" rel="noreferrer">{currentRef.title} ↗</a> · 각 요소는 아래에서 바꿀 수 있어요.</p>}
      </section>
      <section className="workshop-section"><h4>어떤 종목만 살까요? <small>선택 사항 · 최대 8개</small></h4>
        <p>예: 최근 60일 수익률이 0% 이상인 종목만 남길 수 있어요. 조건이 없으면 모델이 살펴보는 모든 종목을 후보로 둡니다.</p>
        <Choice label="조건을 통과하는 방법" value={config.conditionMode} options={[[ 'all', '모든 조건 충족'], ['any', '하나 이상의 조건 충족']]} onChange={conditionMode => update({ conditionMode })} />
        {config.conditions.map((r, i) => <div className="workshop-rule" key={i}>
          <Choice label={`조건 ${i + 1} 지표`} value={r.feature} options={options} onChange={feature => changeRule(i, { feature })} note={featureHelp(r.feature)} />
          <Choice label="비교 값" value={r.measure} options={[['raw', '지표 값'], ['rank', '다른 종목과 비교한 위치 (0~100)']]} onChange={measure => changeRule(i, { measure })} />
          <Choice label="방향" value={r.op} options={[['gte', '이상'], ['lte', '이하']]} onChange={op => changeRule(i, { op })} />
          <Numeric label={r.measure === 'rank' ? '위치 기준 (상위 30% = 70 이상)' : `기준 (${workspace.features.find(f => f.id === r.feature)?.unit})`} value={r.value} min={r.measure === 'rank' ? 0 : -1e6} max={r.measure === 'rank' ? 100 : 1e6} step={.1} onChange={value => changeRule(i, { value })} />
          <button type="button" aria-label={`조건 ${i + 1} 삭제`} onClick={() => update({ conditions: config.conditions.filter((_, j) => j !== i) })}>삭제</button>
        </div>)}
        <button type="button" disabled={config.conditions.length >= 8} onClick={() => update({ conditions: [...config.conditions, { feature: 'return60', measure: 'raw', op: 'gte', value: 0 }] })}>+ 조건 추가</button>
      </section>
      <section className="workshop-section"><h4>{config.method === 'conditions' ? '학습 모델 비교에 넣을 지표' : learn ? '어떤 정보를 참고할까요?' : '점수를 매길 때 참고할 정보'} <small>최대 12개</small></h4>
        <p>{config.method === 'conditions' ? '조건 필터만 실행할 때는 사용하지 않습니다. 아래 지표는 학습 모델을 비교할 때 입력합니다.' : learn ? '지표는 가격이나 거래량의 특징을 숫자로 나타낸 정보입니다. 모델이 이 정보를 보고 이후 수익률과의 관계를 배웁니다.' : '각 지표에서 다른 종목보다 얼마나 높은 위치인지 점수를 매깁니다. 가중치가 양수면 높은 값을 선호하고 음수면 낮은 값을 선호해요. 절댓값이 클수록 더 중요하게 봅니다.'}</p>
        {config.terms.map((t, i) => <div className="workshop-term" key={i}><Choice label={`지표 ${i + 1}`} value={t.feature} options={options.filter(([id]) => id === t.feature || !config.terms.some(x => x.feature === id))} onChange={feature => changeTerm(i, { feature })} note={featureHelp(t.feature)} />
          {(config.method === 'score' || config.reduction === 'anchoredPca') && <Numeric label={config.method === 'score' ? '가중치 (−5 ~ 5, 0 제외)' : '첫 요약값에 반영할 가중치 (0 제외)'} value={t.weight} min={-5} max={5} step={.5} onChange={weight => changeTerm(i, { weight })} />}
          <button type="button" aria-label={`지표 ${i + 1} 삭제`} onClick={() => update({ terms: config.terms.filter((_, j) => j !== i) })}>삭제</button></div>)}
        <button type="button" disabled={config.terms.length >= 12} onClick={() => update({ terms: [...config.terms, { feature: workspace.features.find(f => !config.terms.some(t => t.feature === f.id)).id, weight: 1 }] })}>+ 지표 추가</button>
      </section>
      <ReductionControls config={config} update={update} learn={learn} />
      <section className="workshop-section"><h4>얼마를 투자하고 얼마를 남길까요?</h4><div className="workshop-grid">
        <Numeric label="최대 몇 종목을 보유할까요?" value={config.topK} min={1} max={30} onChange={topK => update({ topK })} />
        <Numeric label="전체 자금 중 주식에 쓸 최대 비율 (%)" value={config.exposure} min={0} max={100} onChange={exposure => update({ exposure })} />
        <Numeric label="전체 자금 중 한 종목에 쓸 최대 비율 (%)" value={config.maxWeight} min={1} max={100} onChange={maxWeight => update({ maxWeight })} />
        <Choice label="종목별 금액 배분" value={config.allocation} options={[['equal', '동일 금액'], ['inverseVol', '덜 흔들리는 종목에 더 많이']]} onChange={allocation => update({ allocation })} />
        <Choice label="코스피가 이 평균 가격보다 높을 때만 투자" numeric value={config.marketMA} options={[[0, '시장 조건 사용 안 함'], [20, '코스피 20거래일 평균'], [60, '코스피 60거래일 평균'], [120, '코스피 120거래일 평균'], [200, '코스피 200거래일 평균']]} onChange={marketMA => update({ marketMA })} />
        <Numeric label="시장 전체의 흔들림에도 맞춰 줄이기 (%/년)" value={config.targetVol} min={0} max={100} onChange={targetVol => update({ targetVol })} note="0이면 사용하지 않습니다. 낮게 정할수록 시장이 불안할 때 투자 금액을 더 줄입니다. 손실 한도가 아닙니다." />
      </div><p>예: 총 투자 비율이 80%라면 자금 100만 원 중 최대 80만 원을 주식에 씁니다. 한 종목의 비율을 20%로 정하면 그 종목에는 최대 20만 원을 씁니다. 남는 돈은 현금으로 둡니다. 코스피 조건을 사용하면 조건을 벗어날 때 다음 점검일 전에도 매도를 예약합니다.</p></section>
      <RiskControls config={config} update={update} workspace={workspace} />
      <section className="workshop-section"><h4>언제 다시 살펴보고 거래할까요?</h4><div className="workshop-grid">
        <Choice label="종목과 투자 금액을 다시 정할 간격" numeric value={config.rebalanceTurns} options={[[1, '매 턴'], [5, '5턴마다'], [20, '20턴마다']]} onChange={rebalanceTurns => update({ rebalanceTurns })} />
        <Numeric label="보유 종목의 순위가 몇 등 떨어져도 유지할까요?" value={config.rankBuffer} min={0} max={30} onChange={rankBuffer => update({ rankBuffer })} note="10종목·여유 5등이면 기존 종목은 15위까지 유지할 수 있어요. 선정 조건은 계속 충족해야 해요." />
        <Choice label="단기 급등 종목 신규 매수" value={config.entryCeiling == null ? 'off' : 'on'} options={[['off', '추가 조건 없음'], ['on', '5일 상승률이 기준 이하면 매수']]} onChange={value => update({ entryCeiling: value === 'off' ? null : 10 })} />
        {config.entryCeiling !== null && <Numeric label="5일 상승률 기준 (%)" value={config.entryCeiling} min={-50} max={100} onChange={entryCeiling => update({ entryCeiling })} />}
      </div><p>오늘 장이 끝난 가격으로 판단해 다음에 주식시장이 열리는 날의 시작 가격에 거래합니다. 동점이면 이미 보유한 종목을 먼저 고릅니다.</p></section>
      <details className="workshop-details"><summary>모든 지표의 뜻과 계산법 · {workspace.features.length}개</summary><dl>{workspace.features.map(f => <div key={f.id}><dt>{f.name}</dt><dd>{featureHelp(f.id)}<br />계산: {f.formula} · 최소 {f.lookback}개 가격 자료</dd></div>)}</dl><p>이 제작 도구의 지표 정의입니다. 공식 Alpha158 지표의 정의는 ‘What is Alpha158?’에서 확인할 수 있습니다.</p></details>
      <Choice label="무엇을 바꿔서 비교할까" value={config.comparison} options={[['models', '학습 모델만 변경'], ['labels', '모델이 맞혀 볼 결과 변경'], ['risk', '불안할 때 투자 금액 줄이기 켜기·끄기'], ['reduction', '지표를 그대로 쓰기·묶어서 쓰기']]} onChange={comparison => update({ comparison })} />
      <div className="workshop-actions"><Choice label="살 때와 팔 때 각각 적용할 거래비용" numeric value={feeBps} options={[[0, '0% · 현재 게임 규칙'], [10, '0.1% · 비용 가정'], [20, '0.2% · 비용 가정']]} onChange={setFeeBps} />
        <button className="btn-primary" type="button" disabled={unavailable(config.method)} onClick={practice}>과거 최대 240턴 연습</button>
        <button type="button" disabled={!config.terms.length || (config.comparison === 'models' && (unavailable('randomForest') || unavailable('lightgbm') || unavailable('xgboost')))} onClick={compare}>같은 조건으로 비교</button>
        <button type="button" disabled={workspace.ended || workspace.turn >= 240 || unavailable(config.method)} onClick={save}>전략 저장 · 오늘부터 관찰</button></div>
      <p>‘같은 조건으로 비교’를 누르면 선택한 설정만 바꾼 결과를 나란히 볼 수 있어요. 초기 자금과 기간을 맞춰 비교합니다.</p>
      <p>연습 초기 자금은 이 게임의 시작 자금 {won(workspace.initialCash)}입니다. 저장 후 관찰 비용은 현재 게임 규칙을 사용합니다. 저장된 버전은 변경되지 않으며 수정본은 새 버전으로 남습니다.</p>
    </>}
    {view === 'results' && (report ? (report.kind === 'compare'
      ? <Comparison key={report.id} report={report} workspace={workspace} config={config} onBuild={replace} onAsset={assetId => openModal('asset', { assetId })} />
      : <Result report={report} workspace={workspace} dirty={signature(report.config) !== signature(config)} onBuild={() => replace(report.config)} onAsset={assetId => openModal('asset', { assetId })} />) : <div className="workshop-empty"><h4>내 아이디어는 어떤 결과를 만들까?</h4><p>전략을 만든 뒤 과거 연습을 실행해 보세요. 돈이 얼마나 늘거나 줄었는지와 어떤 이유로 종목을 골랐는지 볼 수 있습니다.</p><button type="button" onClick={() => setView('build')}>내 전략 편집</button></div>)}
    {view === 'versions' && <><details className="workshop-details"><summary>자동 투자 기록</summary>{workspace.automation?.history?.length ? workspace.automation.history.map(r=><p key={r.turn_number}>{r.turn_number}턴 · {r.detail.reason}{r.detail.orderCount ? ` (${r.detail.orderCount}건)` : ''}</p>) : <p>아직 자동 투자 기록이 없습니다.</p>}</details><section className="workshop-section">
      <div className="workshop-section-heading"><h4>저장한 전략 · {workspace.versions.length}/20</h4><button type="button" onClick={() => setView('compare')}>모델 골라 비교하기</button></div>
      <p>자동 투자를 켜면 내 보유 주식과 현금을 모델에 맞춰 조절합니다. 언제든 해제할 수 있습니다. 해제하면 자동 대기 주문만 취소하고 보유 주식은 유지합니다.</p>
      {!workspace.versions.length && <p>아직 저장한 전략이 없습니다.</p>}{workspace.versions.map(v => <article className="workshop-record" key={v.id}><div><strong>{v.config.name}</strong><p>{v.saved_turn}턴부터 · {methods[v.config.method]}</p></div><button type="button" onClick={() => observe(v.id)}>현재까지 관찰</button>
      <button type="button" disabled={autoBusy || workspace.ended || (workspace.automation?.enabled && workspace.automation.versionId===v.id)} onClick={()=>automate(true,v.id)}>{workspace.automation?.enabled && workspace.automation.versionId===v.id ? '자동 투자 중' : '이 모델로 자동 투자'}</button><button type="button" onClick={() => replace(v.config)}>복사해서 수정</button></article>)}</section>
      <section className="workshop-section"><h4>연습·비교 기록 · 최근 12개</h4><p>잘된 결과와 실패한 결과를 함께 남깁니다. 반복해서 확인한 기간은 새로운 검증 기간이 아닙니다.</p>
      {!workspace.runs.length && <p>아직 실행한 연습이 없습니다.</p>}{workspace.runs.map(r => <article className="workshop-record" key={r.id}><div><strong>{r.config.name}</strong><p>{r.comparison === 'custom' ? r.comparison_period === 'observe' ? '저장 모델 관찰 비교' : '저장 모델 과거 비교' : r.kind === 'compare' ? '학습 모델 비교' : `수익률 ${pct(r.performance?.returnRate)}`} · 편도 비용 {Number(r.fee_bps) / 100}%</p></div><button type="button" onClick={() => oldReport(r.id)}>결과 보기</button></article>)}</section></>}
    </fieldset>
  </div>;
}
