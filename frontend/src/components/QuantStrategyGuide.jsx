import { getQuantExplanation } from '../utils/quantExplanation';

export default function QuantStrategyGuide({ data }) {
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
      <p className="quant-execution-note"><b>언제 거래하나요?</b> {explanation.execution}</p>
      <details className="quant-strategy-details">
        <summary>선정 기준 자세히 보기</summary>
        <dl>
          <div><dt>어떤 정보를 보나요?</dt>
            <dd>가격이 얼마나 오르내렸는지, 변동 폭이 얼마나 컸는지, 거래량이 어떻게 달라졌는지 등을 158가지 지표로 살펴봐요. 코스피보다 수익률이 높을 것으로 예상하는 종목일수록 높은 점수를 줘요.</dd></div>
          <div><dt>어느 기간의 수익을 예측하나요?</dt><dd>{explanation.prediction}</dd></div>
          {explanation.allocationExample && <div><dt>얼마씩 투자하나요?</dt><dd>{explanation.allocationExample}</dd></div>}
          <div><dt>계속 같은 비중으로 보유하나요?</dt><dd>{explanation.replacement}</dd></div>
          <div><dt>어떤 모델인가요?</dt>
            <dd>Alpha158은 가격·거래량 지표 묶음이고, LightGBM은 과거 지표와 이후 수익률의 관계를 학습해 점수를 만드는 모델이에요. 게임 속 해당 시점에 알 수 있는 정보로 판단해요.</dd></div>
        </dl>
      </details>
      <p className="quant-score-note">점수는 종목을 비교하는 기준이에요. 수익률이나 상승 확률을 확정하는 숫자는 아니에요.</p>
    </section>
  );
}
