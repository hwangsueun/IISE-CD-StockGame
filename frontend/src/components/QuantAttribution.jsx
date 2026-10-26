import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { QUANT_INDICATORS } from '../utils/quantIndicators';
import { relativeYearDate } from '../utils/format';
import { summarizeContributions, compareContributions, contributionPoints as points, indicatorValue } from '../utils/quantAttribution';
import QuantDecisionEvidence from './QuantDecisionEvidence';
import './QuantAttribution.css';

const indicators = new Map(QUANT_INDICATORS.map(feature => [feature.name, feature]));
const valueText = value => indicatorValue(value).text;
const directionClass = value => value > 0 ? 'attribution-positive' : value < 0 ? 'attribution-negative' : '';
const actionNames = { buy_pending: '매수 예약', sell_pending: '매도 예약', bought: '신규 매수', held: '보유 유지' };

function useAttributionReport(sessionId, assetId, data, retry) {
  const [report, setReport] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setReport(null); setError('');
    if (assetId) api.getQuantAttribution(sessionId, assetId)
      .then(result => { if (!cancelled) setReport(result); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sessionId, assetId, data.decision?.date, data.decision?.modelId, data.modelVersion, retry]);
  return { report, error };
}

function Feature({ feature, max }) {
  const info = indicators.get(feature.name);
  return <details className="quant-attribution-feature">
    <summary><span>{info?.title || feature.name}<small>{feature.name}</small></span><strong>{points(feature.contribution)}</strong>
      <span className="quant-attribution-bar" aria-hidden="true"><i style={{ width: `${max ? Math.abs(feature.contribution) / max * 100 : 0}%` }} /></span>
    </summary>
    <p>당시 지표 값: <b title={indicatorValue(feature.value).exact}>{valueText(feature.value)}</b></p><p>{info?.meaning}</p><p>계산: {info?.formula || feature.name}</p>
    <p>이 지표가 이 종목의 모델 점수를 {points(Math.abs(feature.contribution)).replace('+', '')} {feature.contribution > 0 ? '높인' : '낮춘'} 것으로 계산됐어요.</p>
  </details>;
}

function StockContribution({ name, feature }) {
  return <div className="quant-stock-contribution">
    <strong>{name}</strong>
    <dl>
      <div><dt>당시 지표 값</dt><dd title={indicatorValue(feature.value).exact}>{valueText(feature.value)}</dd></div>
      <div><dt>점수 {feature.contribution < 0 ? '내림' : feature.contribution > 0 ? '올림' : '변화'}</dt><dd className={directionClass(feature.contribution)}>{points(feature.contribution)}</dd></div>
    </dl>
  </div>;
}

function ImportantFeature({ feature, index, max, current, compared }) {
  const info = indicators.get(feature.name);
  return <li className="quant-important-feature">
    <div className="quant-important-heading">
      <span className="quant-feature-position" aria-label={`이 종목에서 기여 크기 ${index + 1}번째`}>{index + 1}</span>
      <h6>{info?.title || feature.name}<small>{feature.name}</small></h6>
      <strong className={directionClass(feature.contribution)}>{feature.contribution < 0 ? '점수 내림' : '점수 올림'}</strong>
    </div>
    <p>{info?.meaning}</p>
    <div className="quant-feature-values">
      <StockContribution name={current.name} feature={feature} />
      {compared && <StockContribution name={compared.name} feature={compared.feature} />}
    </div>
    <span className={`quant-attribution-bar ${directionClass(feature.contribution)}`} aria-hidden="true"><i style={{ width: `${max ? Math.abs(feature.contribution) / max * 100 : 0}%` }} /></span>
    <details className="quant-feature-formula"><summary>지표 값 계산식</summary><p>{info?.formula || feature.name}</p><p>반올림 전 지표 값: {indicatorValue(feature.value).exact ?? '자료 없음'}</p></details>
    <QuantDecisionEvidence feature={feature} report={current} />
  </li>;
}

export default function QuantAttribution({ sessionId, data, selectedAsset, onSelect }) {
  const choices = data.decision?.selections || [];
  const assetId = choices.some(row => row.assetId === selectedAsset) ? selectedAsset : choices[0]?.assetId;
  const [retry, setRetry] = useState(0), [comparisonAsset, setComparisonAsset] = useState('');
  const compareId = comparisonAsset !== assetId && choices.some(row => row.assetId === comparisonAsset) ? comparisonAsset : '';
  const primary = useAttributionReport(sessionId, assetId, data, retry);
  const secondary = useAttributionReport(sessionId, compareId, data, retry);
  const matchesContext = report => report?.decisionDate === data.decision?.date &&
    report?.signalDate === data.decision?.signalDate && report?.modelId === data.decision?.modelId &&
    report?.modelVersion === data.modelVersion && report?.artifactSha256 === data.artifactSha256;
  const current = primary.report?.assetId === assetId && matchesContext(primary.report) ? primary.report : null;
  const other = secondary.report?.assetId === compareId ? secondary.report : null;
  const contextError = primary.report?.assetId === assetId && !current
    ? '화면과 분석의 평가 시점이 달라졌어요. 포트폴리오를 다시 열어 주세요.' : '';
  const comparison = current && other ? compareContributions(current, other) : null;
  const summary = current && summarizeContributions(current.features);
  const important = summary?.sorted.filter(feature => feature.contribution !== 0).slice(0, 5) || [];
  const comparedFeatures = new Map(comparison?.comparable ? comparison.rows.map(row => [row.name, row.secondary]) : []);
  const max = summary?.sorted[0] ? Math.abs(summary.sorted[0].contribution) : 0;

  if (!choices.length) return <section className="quant-attribution"><h4>종목별 주요 지표</h4><p>종목 평가 기록이 생기면 점수에 크게 반영된 지표를 확인할 수 있어요.</p></section>;
  return <section className="quant-attribution" aria-labelledby="quant-attribution-title">
    <span className="quant-eyebrow">종목별 지표 기여도</span>
    <h4 id="quant-attribution-title">이 종목에서 중요하게 반영된 지표</h4>
    <p>중요도는 이번 모델 점수에 더하거나 뺀 값의 크기예요. 종목을 고르면 크게 반영된 지표부터 보여 드려요.</p>
    <div className="quant-attribution-selectors">
      <label className="workshop-field"><span>분석할 종목</span><select value={assetId} onChange={e => onSelect(e.target.value)}>{choices.map(row => <option key={row.assetId} value={row.assetId}>{row.name}</option>)}</select></label>
      {choices.length > 1 && <label className="workshop-field"><span>같은 지표를 다른 종목과 비교</span><select value={compareId} onChange={e => setComparisonAsset(e.target.value)}><option value="">비교하지 않기</option>{choices.filter(row => row.assetId !== assetId).map(row => <option key={row.assetId} value={row.assetId}>{row.name}</option>)}</select></label>}
    </div>
    {primary.error || contextError ? <div role="alert"><p>{primary.error || contextError}</p><button type="button" onClick={() => setRetry(n => n + 1)}>분석 다시 불러오기</button></div> : !current ? <p role="status">이 종목의 지표와 실제 판단 규칙을 불러오고 있어요…</p> : <>
      <p>{relativeYearDate(current.signalDate, data.date)} 기준 · {current.decisionTurn}턴 평가 · 종목 점수 순위 {current.rank}위 · {actionNames[current.action]}</p>
      {compareId && <div className="quant-comparison-state">
        {secondary.error ? <p role="alert">{secondary.error} <button type="button" onClick={() => setRetry(n => n + 1)}>비교 다시 불러오기</button></p>
          : !other ? <p role="status">비교할 종목의 같은 평가일 자료를 불러오고 있어요…</p>
          : !comparison?.comparable ? <p role="alert">{comparison?.reason} <button type="button" onClick={() => setRetry(n => n + 1)}>비교 다시 불러오기</button></p>
          : <p><b>{current.name}</b>에서 크게 반영된 지표 {important.length}개를 <b>{other.name}</b>의 같은 지표와 비교해요. 평가일과 모델은 같아요.</p>}
      </div>}
      <ol className="quant-important-features" aria-label={`${current.name} 지표 기여 크기순`}>
        {important.map((feature, index) => <ImportantFeature key={feature.name} feature={feature} index={index} max={max} current={current}
          compared={comparedFeatures.has(feature.name) ? { name: other.name, feature: comparedFeatures.get(feature.name) } : null} />)}
      </ol>
      {!important.length && <p>이번 점수에 더하거나 뺀 값이 있는 지표가 없어요.</p>}
      <p className="quant-attribution-rule">같은 지표라도 값과 함께 적용된 조건에 따라 기여의 크기와 방향이 달라져요. 카드의 판단 규칙은 모델이 점수를 계산한 과정입니다. 실제 주가가 움직인 원인을 뜻하지는 않아요.</p>
      <details className="quant-strategy-details">
        <summary>158개 지표가 최종 점수로 합쳐지는 과정</summary>
        <div className="quant-attribution-equation" aria-label="모델 예측값의 구성">
          <div><span>모델의 기준값</span><strong>{points(current.baseValue)}</strong></div><span aria-hidden="true">+</span>
          <div><span>점수를 올린 값의 합</span><strong className="attribution-positive">{points(summary.positiveTotal)}</strong></div><span aria-hidden="true">+</span>
          <div><span>점수를 내린 값의 합</span><strong className="attribution-negative">{points(summary.negativeTotal)}</strong></div><span aria-hidden="true">=</span>
          <div><span>코스피 대비 예상 성과</span><strong>{points(current.prediction)}</strong></div>
        </div>
        <p>기준값에 158개 지표의 기여도를 모두 더하면 실제 모델 점수가 됩니다. +0.10%p의 기여는 점수에 0.10%p가 더해졌다는 뜻이에요. 실제 수익이나 상승 확률을 뜻하지는 않습니다.</p>
      </details>
      <details className="quant-strategy-details">
        <summary>점수를 올린 지표와 내린 지표로 나눠 보기</summary>
        <div className="quant-attribution-columns">
          <section className="attribution-positive"><h5>점수를 올린 지표 <small>더한 값이 큰 순서 · 최대 5개</small></h5>{summary.positive.length ? summary.positive.map(feature => <Feature key={feature.name} feature={feature} max={max} />) : <p>점수를 올린 지표가 없습니다.</p>}</section>
          <section className="attribution-negative"><h5>점수를 내린 지표 <small>내린 폭이 큰 순서 · 최대 5개</small></h5>{summary.negative.length ? summary.negative.map(feature => <Feature key={feature.name} feature={feature} max={max} />) : <p>점수를 내린 지표가 없습니다.</p>}</section>
        </div>
      </details>
      <details className="quant-strategy-details"><summary>이 종목의 158개 지표 전체 보기 · 기여 크기순</summary><div className="quant-attribution-all"><table className="data-table"><thead><tr><th>지표</th><th>이 종목의 지표 값</th><th>이 종목의 점수 기여</th></tr></thead><tbody>{summary.sorted.map(feature => <tr key={feature.name}><td><details><summary>{indicators.get(feature.name)?.title || feature.name}<small>{feature.name}</small></summary><p>{indicators.get(feature.name)?.meaning}</p><p>{indicators.get(feature.name)?.formula}</p></details></td><td>{valueText(feature.value)}</td><td className={directionClass(feature.contribution)}>{points(feature.contribution, 6)}</td></tr>)}</tbody></table></div></details>
      <details className="quant-strategy-details"><summary>분석 기준과 계산 방법</summary><p>기여도는 이 종목의 해당 날짜 예측을 나눈 TreeSHAP 값입니다. 모든 종목에 공통으로 적용하는 지표 중요도와는 달라요.</p><p>지표 값은 표시된 계산식의 결과입니다. 모델의 기준값은 이 설명 방식이 사용하는 평균 예측값입니다.</p><p>학습 결과가 확인된 마지막 날 {relativeYearDate(current.trainedThrough, data.date)} · 실제 점수와 기여도 합의 일치 확인 완료</p><a href="https://lightgbm.readthedocs.io/en/v4.6.0/pythonapi/lightgbm.Booster.html#lightgbm.Booster.predict" target="_blank" rel="noreferrer">기여도 계산 방법 ↗</a></details>
    </>}
  </section>;
}
