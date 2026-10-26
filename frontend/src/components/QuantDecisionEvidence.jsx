import { QUANT_INDICATORS } from '../utils/quantIndicators';
import { contributionPoints as points, indicatorValue } from '../utils/quantAttribution';

const indicators = new Map(QUANT_INDICATORS.map(feature => [feature.name, feature]));
const number = value => indicatorValue(value).text;
function Condition({ condition }) {
  const title = indicators.get(condition.feature)?.title || condition.feature;
  let rule;
  if (condition.routing === 'missing_default' || condition.usedDefault) {
    rule = `모델이 빈 값으로 처리해 미리 정한 ${condition.selectedBranch === 'left' ? '왼쪽' : '오른쪽'} 경로를 선택`;
  } else if (condition.routing === 'categorical_missing') {
    rule = '값을 확인할 수 없어 오른쪽 경로를 선택';
  } else {
    const threshold = Array.isArray(condition.threshold) ? condition.threshold.map(number).join(', ') : number(condition.threshold);
    const operator = { '<=': '이하', '>': '초과', in: '목록에 포함', not_in: '목록에 미포함' }[condition.conditionOperator];
    rule = `${threshold} ${operator || condition.conditionOperator}`;
    if (condition.routing === 'nan_as_zero') rule = `자료가 없어 0으로 비교 → ${rule}`;
  }
  const exact = `기준값 ${Array.isArray(condition.threshold) ? condition.threshold.join(', ') : condition.threshold} · 실제 값 ${condition.value ?? '자료 없음'}`;
  return <span className="quant-observed-condition" title={exact}><b>{title}</b><span>{rule}</span><small>실제 값 {number(condition.value)}</small></span>;
}
function BranchExample({ example, index, contribution }) {
  const difference = Number(example.branchDifference);
  const oppositeDirection = difference * contribution < 0;
  return <div className="quant-branch-example">
    <span className="quant-evidence-tag">실제로 통과한 조건 {index + 1}</span>
    {example.context?.length > 0 && <details className="quant-branch-context"><summary>이 조건에 도달하기 전에 확인한 조건</summary>
      {example.omittedContextCount > 0 && <p>앞선 {example.omittedContextCount}개 조건을 거친 뒤</p>}
      <ol>{example.context.map((condition, i) => <li key={`${condition.nodeIndex}-${i}`}><Condition condition={condition} /></li>)}</ol>
    </details>}
    <Condition condition={example} />
    <p className="quant-branch-result">{difference === 0 ? '두 경로의 평균 점수가 같았어요.' : <>이 조건에서 선택한 쪽의 평균 점수는 반대쪽보다 <b>{points(Math.abs(difference)).replace(/^\+/, '')}</b> {difference > 0 ? '높았어요.' : '낮았어요.'}</>}</p>
    {oppositeDirection && <p className="quant-direction-note">위의 지표 기여도는 점수를 {contribution > 0 ? '올리는' : '내리는'} 방향이에요. 이 조건 하나의 평균 점수 차이와 전체 지표 기여도는 계산 방식이 달라요.</p>}
    <details className="quant-branch-values"><summary>두 경로의 평균 점수 확인</summary><dl>
      <div><dt>선택한 쪽</dt><dd>{points(example.selectedExpectedValue)}</dd></div>
      <div><dt>반대쪽</dt><dd>{points(example.alternativeExpectedValue)}</dd></div>
    </dl><p>이 판단 나무의 각 가지에 있는 점수를 학습 자료 수로 가중한 평균입니다. 전체 모델 점수나 실제 수익률은 아닙니다.</p><p>반올림 전 기준값: {Array.isArray(example.threshold) ? example.threshold.join(', ') : String(example.threshold)}<br />반올림 전 실제 값: {example.value == null ? '자료 없음' : String(example.value)}</p></details>
  </div>;
}
function ReferenceComparison({ comparison }) {
  if (!comparison?.available) return null;
  return <div className="quant-reference-comparison">
    <strong>이 지표 값만 보통 수준으로 바꿔 보면</strong>
    <p>다른 지표는 그대로 두고 이 값만 같은 날 alpha158이 평가한 종목들의 중간값인 <b title={indicatorValue(comparison.referenceValue).exact}>{number(comparison.referenceValue)}</b>로 바꿔 다시 계산했어요.</p>
    <div className="quant-reference-scores" aria-label="지표 값 하나를 바꾼 모델 점수 비교">
      <div><span>원래 모델 점수</span><strong>{points(comparison.originalPrediction)}</strong></div>
      <span aria-hidden="true">→</span>
      <div><span>이 값만 바꾼 점수</span><strong>{points(comparison.comparisonPrediction)}</strong></div>
    </div>
    {comparison.difference === 0 && <p>이 값만 중간값으로 바꿨을 때는 점수가 변하지 않았어요.</p>}
    <details><summary>이 비교를 읽는 방법</summary><p>코스피 대비 예상 성과를 %p로 표시했어요. 같은 평가일의 전체 평가 대상 중 이 값이 있는 {comparison.referencePopulation}종목의 중간값을 사용했습니다.</p><p>반올림 전 중간값: {String(comparison.referenceValue)}</p><p>다른 값은 그대로 둔 가상 비교여서 실제 시장에서는 이런 값 조합이 나오지 않을 수도 있어요. 모델 안에서 점수가 어떻게 달라지는지 보는 비교입니다.</p></details>
  </div>;
}
export default function QuantDecisionEvidence({ feature }) {
  const evidence = feature.decisionEvidence;
  return <section className="quant-decision-evidence" aria-label={`${feature.name} 실제 판단 조건`}>
    <h6>왜 점수에 반영됐나요?</h6>
    {!evidence ? <p>이 평가의 판단 조건 자료가 없습니다.</p>
      : <>
        <ReferenceComparison comparison={evidence.referenceComparison} />
        {!evidence.pathTreeCount ? <p>이번 종목이 실제로 지나간 경로에는 이 지표의 조건이 없어요. 기여도는 다른 경로와 비교하는 계산에도 영향을 받습니다.</p>
          : <>
            {evidence.examples[0] && <BranchExample example={evidence.examples[0]} index={0} contribution={feature.contribution} />}
            {evidence.examples.length > 1 && <details className="quant-other-branches"><summary>다른 판단 규칙도 보기</summary>{evidence.examples.slice(1).map((example, index) => <BranchExample key={`${example.treeIndex}-${example.nodeIndex}`} example={example} index={index + 1} contribution={feature.contribution} />)}</details>}
          </>}
        <details className="quant-evidence-method"><summary>지표 기여도와 판단 조건의 차이</summary>
          <p>값을 바꾼 비교와 조건별 점수 차이는 위의 지표 기여도와 계산 방식이 달라요. 조건별 차이를 더해 지표 기여도를 만들지는 않습니다.</p>
          <p>이 종목은 {evidence.pathTreeCount}개 판단 규칙에서 이 지표를 {evidence.splitCount}번 확인했어요. 그중 두 경로의 평균 점수 차이가 큰 대표 조건을 보여 줍니다.</p>
        </details>
      </>}
  </section>;
}
