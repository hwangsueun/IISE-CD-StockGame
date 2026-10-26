import { pct, won, relativeYearDate } from '../utils/format';
const num = n => Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : '—';
function Select({ label, value, values, onChange, numeric = false }) {
  return <label className="workshop-field"><span>{label}</span><select value={value} onChange={e => onChange(numeric ? Number(e.target.value) : e.target.value)}>{values.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}
export const riskNames = {
  none: '사용 안 함', historical: '최근 20일의 흔들림 살펴보기', garch: '최근 급등락의 영향 반영 · GARCH',
  har: '짧은 흐름과 긴 흐름 함께 보기 · HAR', vhar: '다른 종목의 흐름도 함께 보기 · VHAR',
  sparseVhar: '관련성이 큰 흐름에 집중 · Sparse VHAR', ewma: '최근 함께 움직인 정도 반영 · EWMA',
  ccc: '종목 사이의 관계를 고정해서 보기 · CCC', dcc: '종목 사이의 관계 변화도 반영 · DCC',
};
const riskHelp = {
  historical: '최근 20일 동안 각 종목의 수익률이 얼마나 크게 오르내렸는지 봅니다.',
  garch: '큰 가격 변화가 있은 뒤에도 불안한 흐름이 이어지는지 과거 자료에서 배웁니다.',
  har: '어제의 가격 움직임과 짧은 기간·긴 기간의 움직임을 함께 봅니다.',
  vhar: '내가 고른 종목들이 서로의 가격 움직임을 설명하는 데 도움이 되는지 배웁니다.',
  sparseVhar: '여러 종목과 기간의 관계를 배우되 관련성이 약한 관계의 영향은 줄입니다.',
  ewma: '최근 같은 방향으로 움직인 종목을 함께 보유하면 얼마나 흔들릴지 계산합니다. 최근 자료를 더 많이 반영합니다.',
  ccc: '종목마다 가격이 흔들리는 정도를 갱신합니다. 종목들이 함께 움직이는 관계는 학습할 때 정한 값을 유지합니다.',
  dcc: '각 종목의 흔들림뿐 아니라 종목들이 함께 오르내리는 관계도 새 가격에 맞춰 갱신합니다.',
};
const reductionNames = { none: '지표를 각각 사용', pca: '데이터에서 조합 찾기 · PCA', anchoredPca: '내 기준도 반영해 조합 찾기 · 가설 PCA' };
export function ReductionControls({ config: c, update, learn, ask = () => null, resume = () => null }) {
  if (!learn) return null;
  const active = c.reduction && c.reduction !== 'none';
  return <section className="workshop-section" data-guide="reduction">
    <span className="workshop-effect">선택 사항 · 모델이 지표를 읽는 방식</span><h4>여러 지표를 몇 개의 숫자로 묶어 볼까요? {ask('reduction')}</h4>{resume('reduction')}
    <p>20일 수익률과 60일 수익률처럼 비슷한 흐름을 담은 지표가 있을 수 있어요. 여러 지표를 조합한 새 숫자를 만들어 모델에 넣는 기능입니다.</p>
    <div className="workshop-example"><strong>예를 들면</strong><p>수익률 2개와 변동성 1개를 골랐다면 3개 값을 그대로 쓰거나 2개 요약값으로 바꿔 볼 수 있어요. 어떤 방식이 더 나은지는 같은 기간의 연습 결과로 비교하세요.</p></div>
    <Select label="지표를 모델에 전달하는 방법" value={c.reduction || 'none'} values={Object.entries(reductionNames)} onChange={reduction => update({ reduction })} />
    {active && <><Select label="조합해서 만들 숫자 개수" numeric value={c.components} values={[1,2,3,4,5].filter(k => k < c.terms.length).map(k => [k, `${k}개`])} onChange={components => update({ components })} />
      {c.reduction === 'anchoredPca' ? <p>첫 번째 요약값에는 내가 정한 지표 가중치를 반영합니다. 수익률에 +1과 변동성에 −1을 주면 ‘많이 오르고 덜 흔들릴수록 큰 값’이 됩니다. 이 값으로 실제 종목을 고르는 방법은 모델이 학습합니다.</p> : <p>지표들이 함께 변하는 패턴을 찾아 요약값을 만듭니다. 앞으로 오를 종목을 잘 구분하는지는 별도로 확인해야 해요.</p>}
      {c.terms.length < 2 && <p className="workshop-notice">먼저 지표를 두 개 이상 선택해 주세요.</p>}
    </>}
    <details className="workshop-details"><summary>PCA의 원리와 계산 방법</summary><p>PCA는 여러 지표에 가중치를 곱해 더한 ‘축’을 학습합니다. 지표 변화의 큰 부분을 적은 축으로 표현합니다. 정보를 줄이는 과정에서 유용한 정보도 빠질 수 있습니다.</p><p>학습 자료에서만 평균·표준편차와 축을 정합니다. 평가 중에는 고정합니다. 가설 PCA는 사용자의 가중치로 첫 축을 정하고 나머지 축은 첫 축과 겹치지 않는 방향에서 학습합니다.</p></details>
  </section>;
}
export function TargetControls({ config: c, update, learn, ask = () => null, resume = () => null }) {
  if (!learn) return null;
  const classification = ['randomForest', 'lightgbm', 'xgboost'].includes(c.method);
  const inputNames = { rank: '다른 종목과 비교한 위치', raw: '지표의 원래 숫자', zscore: '이 종목의 평소와 다른 정도' };
  return <section className="workshop-section" data-guide="target"><h4>모델에게 무엇을 맞혀 보게 할까요? {ask('target')}</h4>{resume('target')}
    <p>과거 지표를 본 뒤 실제로 어떤 일이 일어났는지 알려 주며 학습합니다. 어떤 결과를 맞힐지 직접 정할 수 있어요.</p>
    <Select label="예측할 결과" value={c.target} values={classification ? [['return', '얼마나 오르거나 내릴까?'], ['binary', '정한 기준보다 오를까?'], ['threeClass', '오를까 · 큰 변화 없을까 · 내릴까?'], ['tails', '크게 움직인 사례만 보고 오름·내림 구분']] : [['return', '얼마나 오르거나 내릴까?']]} onChange={target => update({ target, tradePolicy: target === 'return' ? 'rank' : c.tradePolicy })} />
    <p>기간은 위에서 정한 {c.horizon}거래일입니다. 거래일은 주식시장이 열리는 날을 뜻합니다.</p>
    {c.target !== 'return' && <>
      <div className="workshop-grid"><Select label="어느 정도 움직여야 상승·하락으로 볼까요?" value={c.labelRule} values={[[ 'fixed', '내가 수익률 기준 정하기'], ['sigma', '과거의 평소 움직임을 기준으로 정하기']]} onChange={labelRule => update({ labelRule })} />
        {c.labelRule === 'fixed' ? <Select label="상승·하락을 구분할 수익률 폭" numeric value={c.labelThreshold} values={[[0, '0%'], [.5, '0.5%'], [1, '1%'], [2, '2%'], [5, '5%']]} onChange={labelThreshold => update({ labelThreshold })} /> : <Select label="구분할 폭 · 클수록 큰 움직임만 분류" numeric value={c.labelSigma} values={[[.2, '평소 흔들림의 0.2배'], [.5, '평소 흔들림의 0.5배'], [1, '평소 흔들림의 1배'], [1.5, '평소 흔들림의 1.5배']]} onChange={labelSigma => update({ labelSigma })} />}
      </div>
      <p>예를 들어 수익률 기준을 1%로 정하면 매수·매도 비용까지 넘게 올라야 ‘상승’으로 분류해요. 실제로 사용한 경계는 연습 결과에 표시됩니다.</p>
      {c.target === 'tails' && <p className="workshop-notice">변화가 작은 사례는 빼고 배웁니다. 이때 ‘상승 70%’는 크게 움직인 사례 안에서의 추정값이에요. 모든 날에 70% 확률로 오른다는 뜻은 아닙니다.</p>}
      <div className="workshop-grid"><Select label="예측을 보고 종목을 고르는 방법" value={c.tradePolicy} values={[[ 'rank', '상승 가능성을 높게 본 종목부터'], ['probability', '매수·매도할 기준을 따로 정하기']]} onChange={tradePolicy => update({ tradePolicy })} />
        {c.tradePolicy === 'probability' && <><Select label="처음 살 때 · 상승 추정값이 이 값 이상" numeric value={c.entryProbability} values={[[.5, '50%'], [.6, '60%'], [.65, '65%'], [.75, '75%'], [.9, '90%']]} onChange={entryProbability => update({ entryProbability })} />
          <Select label="팔 때 · 상승 추정값이 이 값 이하" numeric value={c.exitProbability} values={[[.1, '10%'], [.25, '25%'], [.4, '40%'], [.45, '45%']]} onChange={exitProbability => update({ exitProbability })} /></>}
      </div>
      <p>상승 추정값은 모델이 내놓은 판단입니다. 실제로 그 비율만큼 맞히는지는 연습 결과에서 확인할 수 있어요.{c.tradePolicy === 'probability' && ' 두 기준 사이에서는 기존 보유 여부를 유지합니다. 종목 조건과 위험 조절도 함께 적용합니다.'}</p>
    </>}
    <details className="workshop-details"><summary>지표의 숫자를 읽는 방식 · {inputNames[c.representation]}</summary>
      <Select label="모델에 넣을 숫자" value={c.representation} values={Object.entries(inputNames)} onChange={representation => update({ representation })} />
      <p>{c.representation === 'rank' ? '예: 같은 날 수익률이 높은 상위 30%에 든다면 70백분위 이상입니다. 수익률 자체보다 다른 종목과 비교한 위치를 봅니다.' : c.representation === 'raw' ? '예: 수익률이 5%라면 숫자 5를 넣습니다. 지표마다 단위와 값의 크기가 다를 수 있습니다.' : '직전 60개 지표 값의 평균에서 얼마나 떨어져 있는지 봅니다. 현재 값은 평소 기준을 계산할 때 제외합니다. 이를 표준화라고 합니다.'}</p>
      <p>상승·하락 경계는 학습 자료로 정한 뒤 고정합니다. 평소 움직임은 수익률의 평균과 표준편차로 계산합니다. 왕복 거래비용을 더해 작은 변화를 상승·하락으로 오해하지 않도록 합니다.</p>
    </details>
  </section>;
}
export function RiskControls({ config: c, update, workspace, ask = () => null, resume = () => null }) {
  const fitted = ['garch','har','vhar','sparseVhar','ewma','ccc','dcc'].includes(c.riskModel);
  const joint = ['ewma','ccc','dcc'].includes(c.riskModel);
  const lagged = ['har','vhar','sparseVhar'].includes(c.riskModel);
  const assets = workspace.assets || [];
  return <>
    <section className="workshop-section" data-guide="risk"><span className="workshop-effect">투자 금액을 조절하는 설정</span><h4>가격이 크게 흔들릴 때 덜 투자할까요? {ask('risk')}</h4>{resume('risk')}
      <p>고른 종목의 가격이 얼마나 크게 오르내릴지 계산합니다. 정한 수준보다 크게 흔들릴 것으로 보면 주식에 넣는 돈을 줄이고 현금을 남겨요.</p>
      <Select label="가격의 흔들림을 살펴보는 방법" value={c.riskModel} values={Object.entries(riskNames)} onChange={riskModel => update({ riskModel })} />
      {c.riskModel !== 'none' && <>
        <p className="workshop-example">{riskHelp[c.riskModel]}</p>
        <Select label="감수할 가격 흔들림의 목표 · 연간 변동성" numeric value={c.riskTarget} values={[[5, '5% · 적게 흔들리도록'], [10, '10%'], [15, '15%'], [20, '20%'], [30, '30%'], [50, '50% · 크게 흔들려도 허용']]} onChange={riskTarget => update({ riskTarget })} />
        <p>낮게 정할수록 현금을 더 남길 수 있어요. 15%를 골라도 손실을 15% 이내로 막아 주는 기능은 아닙니다.</p>
        <details className="workshop-details"><summary>위험 계산의 세부 설정과 원리</summary>
          {c.riskModel === 'ewma' && <Select label="이전 위험을 유지하는 비율" numeric value={c.covarianceDecay ?? .94} values={[[.9,'90% · 최근 변화에 빠르게'],[.94,'94%'],[.97,'97%'],[.99,'99% · 천천히 반영']]} onChange={covarianceDecay => update({ covarianceDecay })} />}
          {lagged && <><Select label="함께 살펴볼 짧은 기간과 긴 기간" value={c.riskLagMode} values={[[ 'fixed', '기간을 직접 지정'], ['auto', '과거 학습 자료에서 비교해서 선택']]} onChange={riskLagMode => update({ riskLagMode })} />
            {c.riskLagMode === 'fixed' && <div className="workshop-grid"><Select label="짧은 기간의 평균" numeric value={c.riskShort} values={[[4, '4거래일'], [5, '5거래일'], [7, '7거래일']]} onChange={riskShort => update({ riskShort })} /><Select label="긴 기간의 평균" numeric value={c.riskLong} values={[[17, '17거래일'], [20, '20거래일'], [22, '22거래일']]} onChange={riskLong => update({ riskLong })} /></div>}
            <p>하루·단기 평균·장기 평균의 고가·저가 변동성을 사용합니다. 자동 선택 후보는 1·4·17일 / 1·5·22일 / 1·7·20일입니다.</p></>}
          <p>{joint ? '각 종목에 넣을 비중과 종목 간 공분산으로 함께 보유할 때의 위험을 계산합니다.' : '각 종목의 예상 변동성을 투자 비중에 따라 더합니다. 분산 투자 효과를 빼지 않은 보수적인 계산입니다.'} 학습한 계수는 고정하고 새로 확인된 가격만 반영합니다.</p>
          <p>변동성은 수익률이 퍼져 있는 정도입니다. 여기서는 1년 기준으로 환산한 값을 사용합니다. 예상 변동성이 목표의 두 배라면 투자 비중을 절반으로 줄이는 방식입니다.</p>
        </details>
      </>}
    </section>
    <section className="workshop-section" data-guide="stress"><span className="workshop-effect">결과를 살펴보는 기능</span><h4>여러 종목이 함께 급락하면 얼마나 잃을까요? {ask('stress')}</h4>{resume('stress')}
      <p>모델이 고른 종목을 보유한다고 가정하고 가상의 가격 변화를 여러 번 만들어 봅니다. 큰 급락이 드문 경우와 큰 움직임이 더 자주 나타날 수 있는 경우의 손실을 비교해요.</p>
      <div className="workshop-grid"><Select label="함께 급락하는 상황도 살펴볼까요?" value={c.stressTest ? 'on' : 'off'} values={[[ 'off', '살펴보지 않기'], ['on', '두 가지 상황의 손실 비교하기']]} onChange={v => update({ stressTest: v === 'on' })} />
        {c.stressTest && <Select label="며칠 동안 보유한다고 가정할까요?" numeric value={c.stressHorizon} values={[[1, '1거래일'], [5, '5거래일'], [20, '20거래일']]} onChange={stressHorizon => update({ stressHorizon })} />}
      </div>
      <p>연습 결과에 손실률과 금액을 보여 줍니다. 이 계산 결과가 주문이나 투자 비중을 자동으로 바꾸지는 않습니다. 아래에서 고른 투자 대상은 실제 전략에도 적용됩니다.</p>
      <details className="workshop-details"><summary>어떤 상황을 비교하나요?</summary><p>기본 비교는 가격 충격이 정규분포를 따른다고 가정합니다. 다른 비교는 과거의 큰 움직임과 종목들이 함께 움직인 방향을 반영합니다. 이를 ‘두꺼운 꼬리’를 반영한 모의실험이라고 합니다.</p><p>만들어진 가상 상황에서 손실이 난 비율을 계산합니다. 실제 미래에 그 확률로 손실이 난다는 뜻은 아닙니다.</p></details>
    </section>
    <details className="workshop-details" open={fitted || c.stressTest || c.riskAssets.length > 0}><summary>투자할 수 있는 종목 · {c.riskAssets.length ? `${c.riskAssets.length}개로 제한 중` : '전체 종목'}</summary>
      <p>종목을 고르면 모델의 학습과 투자 대상이 이 종목들로 제한됩니다. 위험 모델을 학습하거나 급락 상황을 비교하려면 2~5개를 골라 주세요. 해당 기능을 꺼도 고른 종목은 유지됩니다.</p>
      {c.riskAssets.map((id,i) => <div className="workshop-term" key={id}><Select label={`투자 대상 ${i+1}`} value={id} values={assets.filter(a => a.asset_id === id || !c.riskAssets.includes(a.asset_id)).map(a => [a.asset_id,a.masked_name])} onChange={next => update({ riskAssets: c.riskAssets.map((a,j) => i === j ? next : a) })} /><button type="button" onClick={() => update({ riskAssets: c.riskAssets.filter(a => a !== id) })}>제외</button></div>)}
      <button type="button" disabled={c.riskAssets.length >= 5 || !assets.some(a => !c.riskAssets.includes(a.asset_id))} onClick={() => update({ riskAssets: [...c.riskAssets,assets.find(a => !c.riskAssets.includes(a.asset_id)).asset_id] })}>+ 투자 대상 종목</button>
      {(fitted || c.stressTest) && c.riskAssets.length < 2 && <p className="workshop-notice">실행하기 전에 투자 대상 종목을 2개 이상 골라 주세요.</p>}
      <p>위험 모델 학습에는 함께 확인할 수 있는 과거 일별 자료 200개가 필요합니다. 급락 상황 비교에는 300개가 필요합니다.</p>
    </details>
  </>;
}
export function ResearchResult({ report: r, workspace }) {
  const spec = r.model?.labelSpec, calibration = r.calibration, risk = r.riskModel, stress = r.stress;
  const transform = r.model?.transform, forecast = r.decision?.riskForecast;
  const name = id => workspace.features.find(f => f.id === id)?.name || id;
  const assetName = id => workspace.assets?.find(a => a.asset_id === id)?.masked_name || id;
  return <>
    {transform && <details className="workshop-details"><summary>모델이 읽은 정보 · {transform.inputKeys.length}개 지표를 {transform.axes.length}개 숫자로 조합</summary>
      <p>{transform.method === 'anchoredPca' ? '내 기준도 반영한 가설 PCA' : 'PCA'}를 사용했습니다. 원래 지표들의 변화 중 {pct(transform.explained.reduce((a,b) => a+b,0))}를 요약값에 담았습니다. 이 비율은 예측을 맞힌 비율이 아닙니다.</p>
      {transform.axes.map((axis,i) => <details key={i}><summary>요약값 {i+1}{i === 0 && transform.method === 'anchoredPca' ? ' · 내가 정한 기준' : ' · 데이터에서 찾은 조합'} · 담은 정보 {pct(transform.explained[i])}</summary><p>각 지표를 학습 때 정한 평균과 표준편차로 맞춘 뒤 아래 가중치를 곱해 더합니다.</p><ul>{axis.map((w,j) => <li key={j}>{name(transform.inputKeys[j])}: {num(w)}</li>)}</ul></details>)}
    </details>}
    {spec && spec.type !== 'return' && <details className="workshop-details"><summary>모델이 오를 거라고 본 종목은 실제로 올랐을까요?</summary>
      <p>{r.config.horizon}거래일 뒤 수익률로 확인합니다. 비용을 반영한 상승 기준은 {pct(spec.upper)} 초과입니다.{spec.type !== 'binary' && ` 하락 기준은 ${pct(spec.lower)} 미만입니다.`}</p>
      {spec.conditional && <p className="workshop-notice">크게 오르거나 내린 사례만 비교한 결과입니다. 변화가 작은 사례는 아래 비교에서도 제외했습니다.</p>}
      {calibration?.count ? <><p>결과를 확인한 {calibration.count.toLocaleString()}개 사례 중 오름·내림 등의 구분을 맞힌 비율은 {pct(calibration.accuracy)}입니다.</p>
        <p>예를 들어 모델이 평균 70%로 본 사례들이 실제로도 70%가 올랐는지 비교해 보세요.</p>
        <div className="workshop-scroll"><table className="data-table"><thead><tr><th>모델이 본 상승 가능성 · 평균</th><th>실제로 상승 기준을 넘은 비율</th><th>비교한 사례</th></tr></thead><tbody>{calibration.bins.filter(b => b.count).map((b,i) => <tr key={i}><td>{pct(b.predicted)}</td><td>{pct(b.observed)}</td><td>{b.count}개</td></tr>)}</tbody></table></div>
        <details><summary>학습 사례와 통계 지표 자세히 보기</summary><p>Brier {num(calibration.brier)} · 로그 손실 {num(calibration.logLoss)}. 둘 다 작을수록 예측과 실제 결과의 차이가 적습니다.</p><p>학습 사례 {spec.counts.map((n,i) => `${spec.type === 'threeClass' ? ['하락','중립','상승'][i] : i ? '상승' : spec.conditional ? '하락' : '비상승'} ${n.toLocaleString()}개`).join(' · ')} · 제외한 중립 {spec.excluded.toLocaleString()}개</p><p>이 결과로 모델이나 상승·하락 기준을 수정하지 않습니다. 5거래일 간격으로 뽑은 사례는 보유 기간에 따라 겹칠 수 있습니다.</p></details>
      </> : <p>정해 둔 보유 기간이 지난 사례가 쌓이면 모델의 판단과 실제 결과를 비교합니다.</p>}
    </details>}
    {risk && <details className="workshop-details"><summary>투자 금액을 줄일 때 사용한 기준 · {riskNames[risk.method]}</summary>
      <p>{riskHelp[risk.method]} 학습에 사용한 마지막 날짜는 {relativeYearDate(risk.trainedThrough, workspace.date)}입니다.</p>
      {forecast?.annualVol != null && <p>비중을 줄이기 전 예상 흔들림은 연간 변동성 {num(forecast.annualVol)}%입니다. 손실 한도를 뜻하지 않습니다. 실제 목표 투자 비중은 위의 종목별 선택 결과에 표시됩니다.</p>}
      {forecast?.correlation && <div className="workshop-scroll"><p>종목들이 함께 움직이는 정도입니다. 1에 가까우면 같은 방향으로 움직이고 −1에 가까우면 반대 방향으로 움직입니다. 0에 가까우면 뚜렷한 선형 관계가 적습니다.</p><table className="data-table"><thead><tr><th>종목</th>{forecast.ids.map(id => <th key={id}>{assetName(id)}</th>)}</tr></thead><tbody>{forecast.correlation.map((row,i) => <tr key={i}><th>{assetName(forecast.ids[i])}</th>{row.map((v,j) => <td key={j}>{num(v)}</td>)}</tr>)}</tbody></table></div>}
      <details><summary>학습 수치와 종목별 계산 보기</summary><p>학습 관측 {risk.sampleCount}개 · 평가 중 계수 고정</p>
        {risk.short && <p>사용한 시차: 1·{risk.short}·{risk.long}거래일 · 0이 아닌 계수 {risk.coefficientCount}개</p>}
        {risk.decay && <p>이전 공분산 유지 비율 {pct(risk.decay)}</p>}
        {risk.dcc && <p>새 충격 반영 {num(risk.dcc.alpha)} · 이전 상관 상태 유지 {num(risk.dcc.beta)}</p>}
        {risk.lagCandidates?.length > 1 && <><p>학습 구간의 마지막 20%에서 기간 후보를 비교했습니다.</p><ul>{risk.lagCandidates.map(c => <li key={`${c.short}-${c.long}`}>1·{c.short}·{c.long}일: 로그 변동성 검증 MSE {num(c.validationMSE)}</li>)}</ul></>}
        {forecast?.assetVols?.length > 0 && <ul>{forecast.assetVols.map(a => <li key={a.id}>{assetName(a.id)}: 예상 연율 변동성 {num(a.vol)}%</li>)}</ul>}
      </details>
    </details>}
    {stress && <details className="workshop-details" open><summary>여러 종목이 함께 급락하면 · 가상의 손실 비교</summary>
      {stress.available ? <><p>현재 모델이 고른 비중으로 {stress.horizon}거래일 동안 보유하는 상황을 각 {stress.paths.toLocaleString()}번 만들었습니다. 전체 자금의 {pct(stress.exposure)}를 주식에 넣는 조건입니다.</p>
        <p>금액은 게임 시작 자금 <strong>{won(r.initialCash)}</strong>을 기준으로 계산합니다. 현재 내 계좌 잔액으로 계산한 금액과는 다를 수 있어요.</p>
        <div className="workshop-scroll"><table className="data-table"><thead><tr><th>가정한 상황</th><th>손실이 큰 5%의 시작점</th><th>그 5% 상황의 평균 손실</th><th>손실이 난 가상 상황</th></tr></thead><tbody>{[['gaussian','큰 급락이 드문 가정'],['mrv','큰 움직임과 동반 급락 반영']].map(([id,title]) => <tr key={id}><td>{title}</td><td>{won(stress[id].varAmount)}<br/>{pct(stress[id].var95)}</td><td>{won(stress[id].esAmount)}<br/>{pct(stress[id].es95)}</td><td>{pct(stress[id].lossFrequency)}</td></tr>)}</tbody></table></div>
        <div className="workshop-example"><strong>표는 이렇게 읽어요</strong><p>가상 상황 100개를 손실이 큰 순서로 줄 세웠을 때 가장 나쁜 5개가 어느 손실부터 시작하는지와 그 5개의 평균 손실을 보여 줍니다. 이보다 더 큰 손실도 날 수 있어요.</p></div>
        <p>손실이 난 비율은 이 실험 안에서 센 값입니다. 실제 미래의 손실 확률을 뜻하지 않습니다. 보유 중의 추가 거래와 수수료·빚 상환은 계산하지 않았습니다.</p>
        <details><summary>통계 용어와 실험 방법 보기</summary><p>‘손실이 큰 5%의 시작점’은 95% VaR입니다. ‘그 5% 상황의 평균 손실’은 ES입니다. 계산 결과가 손실이 아니면 0으로 표시합니다.</p><p>정규분포 잔차 가정과 두꺼운 꼬리·공동 방향 가정을 비교합니다. 꼬리 지수 {num(stress.tailIndex)} · 극단 관측 {stress.tailCount}개 / 공통 관측 {stress.sampleCount}개. 원문의 타원형 추정 대신 관측된 극단 방향과 Hill 추정량을 사용한 게임용 변형입니다.</p></details>
      </> : <p>{stress.reason}</p>}
    </details>}
  </>;
}
