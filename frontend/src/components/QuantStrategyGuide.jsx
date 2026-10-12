import { getQuantExplanation } from '../utils/quantExplanation';

export default function QuantStrategyGuide({ data, onLearn }) {
  const explanation = getQuantExplanation(data);
  if (!explanation) return null;

  return (
    <section className="quant-strategy-guide" aria-labelledby="quant-strategy-title">
      <div className="quant-strategy-heading">
        <h4 id="quant-strategy-title">이렇게 골라 담아요</h4>
      </div>
      <ol className="quant-strategy-steps" aria-label={explanation.summary}>
        {explanation.steps.map((step, index) => (
          <li key={step.title}>
            <span className="quant-step-number" aria-hidden="true">0{index + 1}</span>
            <h5>{step.title}</h5>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <button className="quant-guide-link" onClick={onLearn}>AI는 어떻게 배우고 예측하나요? →</button>
      <p className="quant-execution-note"><b>언제 거래하나요?</b> {explanation.execution}</p>
      <details className="quant-strategy-details">
        <summary>투자 금액·교체 기준 자세히 보기</summary>
        <dl>
          {explanation.allocationExample && <div><dt>얼마씩 투자하나요?</dt><dd>{explanation.allocationExample}</dd></div>}
          <div><dt>계속 같은 비중으로 보유하나요?</dt><dd>{explanation.replacement}</dd></div>
        </dl>
      </details>
      <p className="quant-score-note">점수가 높을수록 코스피 대비 더 나은 성과를 예상한다는 뜻이에요. 실제 수익이나 상승 확률을 보장하지는 않아요.</p>
    </section>
  );
}
