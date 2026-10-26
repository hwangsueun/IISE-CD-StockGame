import { getQuantExplanation } from '../utils/quantExplanation';

export default function QuantModelGuide({ data, onIndicators }) {
  const explanation = getQuantExplanation(data);
  return <section className="quant-learning-guide" aria-label="Alpha158 지표와 판단 과정">
    <ol className="quant-learning-steps">
      <li><span className="quant-step-number">01 · 입력 만들기</span>
        <h5>하루의 주식 상태를 158개 숫자로 바꿔요</h5>
        <p>그날까지의 시가·고가·저가·종가·거래량 등으로 평균 가격, 가격의 변동 폭, 거래량 변화 등을 계산해요. 이렇게 만든 지표 묶음을 <b>Alpha158</b>이라고 해요.</p>
        <p>예를 들어 MA20은 ‘최근 20거래일 평균 종가 ÷ 오늘 종가’예요. 주가 자체가 아니라 평균과 비교한 비율을 넣는 거예요.</p>
        <button className="quant-guide-link" onClick={onIndicators}>158개 지표의 계산식과 예시 보기 →</button>
      </li>
      <li><span className="quant-step-number">02 · 정답 붙이기</span>
        <h5>그 뒤에 실제로 코스피보다 얼마나 잘했는지 붙여요</h5>
        <p>과거 날짜마다 158개 지표에 <b>이후 주식 수익률 − 같은 기간 코스피 수익률</b>을 짝지어요. 이것이 AI가 맞히려는 ‘정답’이에요.</p>
        <div className="quant-worked-example">
          <span>이해를 돕기 위한 가상 예시</span>
          <p>주식 10,000원 → 10,300원: <b>+3%</b><br />코스피 2,000 → 2,020: <b>+1%</b></p>
          <strong>학습할 정답 = +3% − (+1%) = +2%p</strong>
          <p>계산식은 (마지막 가격 ÷ 시작 가격 − 1)이에요. 학습에는 2%p를 소수 <b>0.02</b>로 넣어요.</p>
        </div>
        {explanation && <p className="quant-learning-callout"><b>이 게임에서 예측하는 기간</b><br />{explanation.prediction}</p>}
      </li>
      <li><span className="quant-step-number">03 · 규칙 학습하기</span>
        <h5>예측과 정답의 차이가 줄어들도록 규칙을 배워요</h5>
        <p>LightGBM은 ‘어떤 지표가 어느 값보다 큰가?’ 같은 질문으로 과거 기록을 나누는 <b>결정트리</b>를 만들어요. 어떤 지표로 어디서 나눌지는 학습 자료의 예측 오차를 줄이는 방향으로 정해요.</p>
        <p>다음 트리가 앞선 트리의 오차를 보완하는 과정을 반복해요. 여러 트리의 결과를 더한 값이 최종 예측이에요. 모든 지표에 같은 점수를 주거나 단순히 평균을 내는 방식은 아니에요.</p>
        <p>학습용 기록보다 뒤의 과거 구간으로 오차를 확인해 학습 횟수를 고른 뒤 예측 시점 전에 결과가 확정된 기록으로 모델을 학습해요.</p>
      </li>
      <li><span className="quant-step-number">04 · 오늘 예측하기</span>
        <h5>오늘의 지표를 학습된 규칙에 넣고 순위를 매겨요</h5>
        <p>오늘의 158개 지표를 각 트리에 통과시키고 결과를 합치면 <b>코스피 대비 예상 수익률</b>이 나와요. 종목 선택 탭의 ‘모델 점수’가 이 값이에요. 높은 점수부터 비교해요. 매 턴 다시 학습하지 않고 그 시점에 사용 가능한 모델로 계산해요.</p>
        <div className="quant-worked-example">
          <span>점수 해석 예시 · 실제 종목의 예측값이 아니에요</span>
          <p>A 종목 <b>0.02</b>는 코스피보다 <b>2%p 높은 성과</b>를, B 종목 <b>−0.01</b>은 <b>1%p 낮은 성과</b>를 예상한다는 뜻이에요. 이 경우 A의 우선순위가 더 높아요.</p>
          <p>코스피 대비 성과이므로 점수가 양수여도 주가 자체는 하락할 수 있어요. 점수는 상승 확률이나 확정 수익률이 아니에요.</p>
        </div>
        {explanation && <p>{explanation.summary}</p>}
      </li>
    </ol>
    <aside className="quant-learning-callout">
      <h5>미래의 결과를 미리 보나요?</h5>
      <p>게임 속 판단 시점보다 앞서 결과가 나온 기록만 학습에 사용해요. 예측에는 그날까지의 지표만 사용해요. 이후의 실제 수익률은 넣지 않아요.</p>
    </aside>
  </section>;
}
