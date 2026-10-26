import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { QUANT_INDICATORS } from '../utils/quantIndicators';
import { relativeYearDate } from '../utils/format';
import { summarizeContributions, contributionPoints as points } from '../utils/quantAttribution';

const indicators = new Map(QUANT_INDICATORS.map(f => [f.name, f]));
const valueText = v => v == null ? '자료 없음 · 모델의 결측값 처리 사용' : v.toLocaleString('ko-KR', { maximumSignificantDigits: 7 });
function Feature({ feature, max }) {
  const info = indicators.get(feature.name);
  return <details className="quant-attribution-feature">
    <summary><span>{info?.title || feature.name}<small>{feature.name}</small></span><strong>{points(feature.contribution)}</strong>
      <span className="quant-attribution-bar" aria-hidden="true"><i style={{ width: `${max ? Math.abs(feature.contribution) / max * 100 : 0}%` }} /></span>
    </summary>
    <p>당시 지표 값: <b>{valueText(feature.value)}</b></p><p>{info?.meaning}</p><p>계산: {info?.formula || feature.name}</p>
    <p>이 지표는 이번 종목의 예측을 기준값에서 {points(Math.abs(feature.contribution)).replace('+', '')} {feature.contribution > 0 ? '높이는' : '낮추는'} 쪽으로 기여했습니다. 다른 종목이나 날짜에도 같은 방향으로 작용하는 것은 아닙니다.</p>
  </details>;
}
export default function QuantAttribution({ sessionId, data, selectedAsset, onSelect }) {
  const choices = data.decision?.selections || [];
  const assetId = choices.some(row => row.assetId === selectedAsset) ? selectedAsset : choices[0]?.assetId;
  const [report, setReport] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setReport(null); setError('');
    if (assetId) api.getQuantAttribution(sessionId, assetId)
      .then(result => { if (!cancelled) setReport(result); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sessionId, assetId, data.decision?.date, data.modelVersion, retry]);
  if (!choices.length) return <section className="quant-attribution"><h4>지표별 기여도 분석</h4><p>종목 평가 기록이 생기면 여기에서 점수에 영향을 준 지표를 확인할 수 있어요.</p></section>;
  const current = report?.assetId === assetId && report.decisionDate === data.decision?.date && report.modelVersion === data.modelVersion ? report : null;
  const summary = current && summarizeContributions(current.features);
  const max = summary?.sorted[0] ? Math.abs(summary.sorted[0].contribution) : 0;
  return <section className="quant-attribution" aria-labelledby="quant-attribution-title">
    <span className="quant-eyebrow">실제 모델의 종목별 판단 근거</span><h4 id="quant-attribution-title">이 종목의 점수는 왜 나왔을까요?</h4>
    <p>같은 지표라도 종목마다 점수에 미치는 영향이 달라요. 예측을 높인 정보와 낮춘 정보를 함께 살펴보세요.</p>
    <label className="workshop-field"><span>지표별 기여도를 볼 종목</span><select value={assetId} onChange={e => onSelect(e.target.value)}>{choices.map(row => <option key={row.assetId} value={row.assetId}>{row.name}{row.rank ? ` · ${row.rank}위` : ''}</option>)}</select></label>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(n => n + 1)}>분석 다시 불러오기</button></div> : !current ? <p role="status">이 종목의 실제 지표와 모델로 기여도를 계산하고 있습니다…</p> : <>
      <p>{relativeYearDate(current.signalDate, data.date)} 기준 · {current.decisionTurn}턴 평가 · {current.rank}위 · {{buy_pending:'매수 예약',sell_pending:'매도 예약',bought:'신규 매수',held:'보유 유지'}[current.action]}</p>
      <div className="quant-attribution-equation" aria-label="모델 예측값의 구성">
        <div><span>모델의 기준값</span><strong>{points(current.baseValue)}</strong></div><span aria-hidden="true">+</span>
        <div><span>높인 지표 전체</span><strong className="attribution-positive">{points(summary.positiveTotal)}</strong></div><span aria-hidden="true">+</span>
        <div><span>낮춘 지표 전체</span><strong className="attribution-negative">{points(summary.negativeTotal)}</strong></div><span aria-hidden="true">=</span>
        <div><span>코스피 대비 예상 성과</span><strong>{points(current.prediction)}</strong></div>
      </div>
      <p>기준값에 158개 지표의 기여도를 모두 더하면 실제 모델 점수가 됩니다. 표시된 값은 반올림했습니다. +0.10%p의 기여는 예측을 0.10%p 높였다는 뜻이에요. 실제 수익이나 상승 확률을 뜻하지는 않습니다.</p>
      <div className="quant-attribution-columns">
        <section className="attribution-positive"><h5>점수를 높인 지표 <small>영향이 큰 순서 · 최대 5개</small></h5>{summary.positive.length ? summary.positive.map(f => <Feature key={f.name} feature={f} max={max} />) : <p>점수를 높인 지표가 없습니다.</p>}</section>
        <section className="attribution-negative"><h5>점수를 낮춘 지표 <small>영향이 큰 순서 · 최대 5개</small></h5>{summary.negative.length ? summary.negative.map(f => <Feature key={f.name} feature={f} max={max} />) : <p>점수를 낮춘 지표가 없습니다.</p>}</section>
      </div>
      <p className="quant-attribution-rule">{current.strategy === 'topk_dropout' ? `alpha158은 점수 순위와 기존 보유 종목을 함께 보고 최대 ${current.nDrop}종목을 교체합니다. 처음 종목을 채울 때는 최대 ${current.topK}종목을 고릅니다.` : `alpha158은 정해진 교체 시점에 상위 ${current.topK}종목을 고릅니다.`} 기여도는 최근 평가 점수를 설명합니다. 최초 매수 당시의 이유나 실제 주가가 움직인 원인과는 구분해 주세요.</p>
      <details className="quant-strategy-details"><summary>158개 지표 전체 보기 · 영향이 큰 순서</summary><div className="quant-attribution-all"><table className="data-table"><thead><tr><th>지표</th><th>당시 값</th><th>예측에 더한 값</th></tr></thead><tbody>{summary.sorted.map(f => <tr key={f.name}><td><details><summary>{indicators.get(f.name)?.title || f.name}<small>{f.name}</small></summary><p>{indicators.get(f.name)?.meaning}</p><p>{indicators.get(f.name)?.formula}</p></details></td><td>{valueText(f.value)}</td><td className={f.contribution > 0 ? 'attribution-positive' : f.contribution < 0 ? 'attribution-negative' : ''}>{points(f.contribution, 6)}</td></tr>)}</tbody></table></div></details>
      <details className="quant-strategy-details"><summary>분석 기준과 계산 방법</summary><p>이 게임에 연결된 LightGBM의 TreeSHAP 기여도를 사용합니다. 모든 종목에 공통인 지표 중요도가 아니라 해당 날짜와 해당 종목의 예측을 분해한 값입니다.</p><p>모델의 기준값은 이 설명 방식이 사용하는 평균 예측값입니다. 현재 보유 종목의 평균 수익률은 아닙니다.</p><p>학습 결과가 확인된 마지막 날 {relativeYearDate(current.trainedThrough, data.date)} · 실제 점수와 기여도 합의 일치 확인 완료</p><a href="https://lightgbm.readthedocs.io/en/v4.6.0/pythonapi/lightgbm.Booster.html#lightgbm.Booster.predict" target="_blank" rel="noreferrer">LightGBM 기여도 계산 설명 ↗</a></details>
    </>}
  </section>;
}
