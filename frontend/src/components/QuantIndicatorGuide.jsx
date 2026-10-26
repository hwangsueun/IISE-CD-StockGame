import { useState } from 'react';
import { filterQuantIndicators, INDICATOR_GROUPS, INDICATOR_PERIODS, QUANT_INDICATORS } from '../utils/quantIndicators';

const examples = [
  { name: 'MA20', title: '평균 가격과 비교', inputs: '20일 평균 종가 10,000원 · 오늘 종가 11,000원', calculation: '10,000 ÷ 11,000 ≈ 0.909', meaning: '1보다 작으면 오늘 가격이 최근 평균보다 높다는 뜻이에요.' },
  { name: 'ROC20', title: '20거래일 전과 비교', inputs: '20거래일 전 종가 9,000원 · 오늘 종가 10,000원', calculation: '9,000 ÷ 10,000 = 0.9', meaning: '과거 가격을 오늘 가격으로 나눠요. 0.9는 수익률 90%라는 뜻이 아니에요.' },
  { name: 'VMA20', title: '평균 거래량과 비교', inputs: '20일 평균 거래량 10만 주 · 오늘 거래량 20만 주', calculation: '100,000 ÷ 200,000 ≈ 0.5', meaning: '평균 거래량을 오늘 거래량으로 나누므로 오늘 거래량이 2배면 지표값은 약 0.5예요.' },
  { name: 'CNTP20', title: '오른 날은 며칠일까?', inputs: '최근 20거래일 중 전일보다 오른 날 12일', calculation: '12 ÷ 20 = 0.6', meaning: '지난 20일 중 60%의 날에 올랐다는 뜻이에요. 앞으로 오를 확률은 아니에요.' },
];

export default function QuantIndicatorGuide({ data }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [period, setPeriod] = useState('all');
  const indicators = filterQuantIndicators({ query, group, period });
  const reset = () => { setQuery(''); setGroup('all'); setPeriod('all'); };

  return <section className="quant-indicator-guide" aria-labelledby="quant-indicator-title">
    <header className="quant-guide-intro">
      <span className="quant-eyebrow">FROM PRICE TO NUMBERS</span>
      <h4 id="quant-indicator-title">가격과 거래량이 지표가 되는 과정</h4>
      <p>지표는 원래 가격·거래량을 비교하기 좋은 숫자로 바꾼 값이에요. <b>당일 지표 13개 + 기간별 지표 29종 × 5개 기간 = 158개</b>를 모델에 넣어요.</p>
      <p>기간은 5·10·20·30·60거래일이에요. ‘최근 20거래일’은 오늘을 포함하고 휴장일은 제외해요. ‘20거래일 전’은 오늘보다 20번의 개장일 앞을 뜻해요.</p>
    </header>
    <h5 className="quant-section-title">숫자로 먼저 이해해요</h5>
    <p className="quant-footnote">아래는 계산 방법을 설명하기 위한 가상 예시예요. 현재 종목의 실제 지표값과는 달라요.</p>
    <div className="quant-indicator-examples">
      {examples.map((example) => <article className="quant-worked-example" key={example.name}>
        <span>{example.name}</span><h5>{example.title}</h5><p>{example.inputs}</p>
        <strong>{example.calculation}</strong><p>{example.meaning}</p>
      </article>)}
    </div>
    <aside className="quant-learning-callout"><b>값이 크다고 무조건 좋은 지표는 아니에요</b>
      <p>지표마다 계산 방향과 의미가 달라요. 모델은 여러 지표의 조합을 학습해요. 특정 지표 하나로 매수 여부를 정하지 않아요.</p>
    </aside>
    <details className="quant-calculation-basics">
      <summary>원자료와 계산 기호 이해하기</summary>
      <dl>
        <div><dt>가격·거래량은 어디에서 오나요?</dt><dd>{data?.priceBasis?.startsWith('adjusted')
          ? '게임에 수록된 수정 시가·고가·저가·종가를 사용해요. 거래량은 원래 거래량 ÷ 가격 조정 배율, VWAP은 (원래 거래대금 ÷ 원래 거래량) × 가격 조정 배율로 맞춰요.'
          : '게임에 수록된 시가·고가·저가·종가·거래량을 사용해요. VWAP은 거래대금 ÷ 거래량으로 계산한 평균 거래 가격이에요.'}</dd></div>
        <div><dt>평균·표준편차</dt><dd>평균은 값의 합 ÷ 개수예요. 표준편차를 구할 때는 각 값에서 평균을 뺀 차이를 제곱해 더해요. 그 합을 (개수 − 1)로 나눈 뒤 제곱근을 구해요. 값들이 흩어져 있을수록 커져요.</dd></div>
        <div><dt>분위수·추세선</dt><dd>분위수는 값을 작은 순서로 놓은 뒤 지정한 비율의 위치를 찾아요. 두 값 사이면 선형 보간해요. 추세선은 날짜 순서 1, 2, …와 종가 사이의 오차 제곱 합이 가장 작은 직선이에요.</dd></div>
        <div><dt>상관계수·ln·절댓값</dt><dd>상관계수는 두 값이 함께 움직이는 정도예요. 각 값에서 평균을 뺀 편차들의 곱 합을 두 편차 제곱 합의 곱의 제곱근으로 나눠요. ln은 자연로그, |값|은 부호를 뺀 크기예요.</dd></div>
        <div><dt>ε와 계산할 수 없는 값</dt><dd>ε는 0으로 나누는 일을 줄이기 위해 일부 분모에 더하는 아주 작은 수(10⁻¹²)예요. 아래 풀어쓴 식은 관측값이 모두 있는 경우를 기준으로 해요. 누락된 값은 연산별로 처리해요. 최종 계산의 무한대는 결측값으로 바꿔 모델에 넣어요.</dd></div>
        <div><dt>실제 계산식의 기호</dt><dd>$open·$high·$low·$close는 시가·고가·저가·종가, $volume은 거래량이에요. Ref는 과거 값, Mean·Sum·Std는 평균·합·표준편차, Greater·Less는 두 값 중 큰 값·작은 값이에요. Mean($close, 20)은 최근 20거래일 종가의 평균을 뜻해요.</dd></div>
      </dl>
    </details>
    <h5 className="quant-section-title">전체 지표 찾아보기</h5>
    <div className="quant-indicator-filters">
      <label htmlFor="quant-indicator-search">이름·뜻으로 검색
        <input id="quant-indicator-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: MA20, 평균, 거래량" /></label>
      <label htmlFor="quant-indicator-group">종류
        <select id="quant-indicator-group" value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="all">전체 종류</option>{Object.entries(INDICATOR_GROUPS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      <label htmlFor="quant-indicator-period">기간
        <select id="quant-indicator-period" value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="all">전체 기간</option><option value="today">당일 지표</option>
          {INDICATOR_PERIODS.map((days) => <option key={days} value={days}>{days}거래일</option>)}
        </select></label>
    </div>
    <div className="quant-indicator-results">
      <p className="quant-footnote" role="status">전체 {QUANT_INDICATORS.length}개 중 {indicators.length}개 · 항목을 눌러 계산식 보기</p>
      {(query || group !== 'all' || period !== 'all') && <button className="quant-guide-link" onClick={reset}>검색 초기화</button>}
    </div>
    <div className="quant-indicator-list" role="region" aria-label="지표 계산식 목록" tabIndex={0}>
      {indicators.map((item) => <details className="quant-indicator-item" key={item.name}>
        <summary><code>{item.name}</code><span>{item.title}</span></summary>
        <div className="quant-indicator-body"><p className="quant-indicator-formula">{item.formula}</p><p>{item.meaning}</p>
          <details className="quant-raw-expression"><summary>실제 계산식 원문</summary><code>{item.expression}</code></details>
        </div>
      </details>)}
      {!indicators.length && <p className="quant-empty">조건에 맞는 지표가 없어요. 검색어나 필터를 바꿔 보세요.</p>}
    </div>
    <p className="quant-footnote">이 게임의 Qlib Alpha158 계산식을 기준으로 설명해요. 이름이 비슷한 일반 투자 지표와 식이 다를 수 있어요.</p>
  </section>;
}
