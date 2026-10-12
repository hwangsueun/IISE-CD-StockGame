import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { won, pct, changeClass, relativeYearDate } from '../utils/format';
import Modal from './Modal';
import QuantStrategyGuide from './QuantStrategyGuide';
import QuantModelGuide from './QuantModelGuide';
import QuantIndicatorGuide from './QuantIndicatorGuide';
import { getQuantExplanation } from '../utils/quantExplanation';
import './QuantModal.css';

const tabs = [['holdings', '보유 포트폴리오'], ['selection', '종목 선택'], ['orders', '예약 주문'],
  ['history', '운용 기록'], ['learning', 'AI 학습·예측'], ['indicators', '지표 계산법']];

const help = (data) => <>
  <p>LightGBM이라는 AI가 과거 주가·거래량 지표와 이후 실제 수익률의 관계를 학습합니다. 오늘의 지표로 코스피 대비 수익률을 예측하고, 당신과 같은 초기 투자금으로 주식을 운용합니다.</p>
  {data?.strategy === 'topk_dropout'
    ? <p>처음에는 상위 {data.topK}종목에 같은 금액을 배분합니다. 이후 매 턴 순위를 평가하고 최대 {data.nDrop}종목을 교체합니다. 기존 보유 종목의 비중은 매일 다시 맞추지 않습니다.</p>
    : data?.rebalanceTurns && <p>이 게임에 연결된 기존 모델은 {data.rebalanceTurns}턴마다 상위 {data.topK}종목에 같은 금액을 배분합니다.</p>}
  <p>휴장일에는 매매하지 않고 다음 개장일까지 기다립니다.</p>
  <p>{getQuantExplanation(data)?.execution} 평가는 당일 종가로 합니다. 버튼을 누르는 시점과 횟수는 결과에 영향을 주지 않습니다.</p>
  <p>매수 수량과 예산은 주문할 때 정합니다. 시가가 오르거나 현금이 부족하면 예산 안에서 수량을 줄이고 나머지는 취소합니다. 매도부터 체결하며, 개별 종목의 시가가 없으면 주문은 체결되지 않습니다.</p>
  <p>모델 점수는 코스피 대비 성과를 예측한 값입니다. 실제 수익률이나 상승 확률을 보장하지 않습니다.</p>
</>;

export default function QuantModal() {
  const { sessionId, turn } = useGameStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState('holdings');
  const tabRefs = useRef({});
  const tabNavigation = useRef(false);
  const selectTab = (key) => {
    tabNavigation.current = key !== tab;
    setTab(key);
  };
  useLayoutEffect(() => {
    if (!tabNavigation.current) return;
    const button = tabRefs.current[tab];
    button?.focus({ preventScroll: true });
    const menu = button?.parentElement;
    const modal = menu?.closest('.modal');
    const panel = menu?.nextElementSibling;
    if (modal && panel) {
      const headerHeight = modal.querySelector('.modal-header').offsetHeight;
      menu.style.top = `${headerHeight}px`;
      // Read the new panel after rendering; a sticky menu's own position is not its scroll offset.
      modal.scrollTop += panel.getBoundingClientRect().top - modal.getBoundingClientRect().top
        - modal.clientTop - headerHeight - menu.offsetHeight - 12;
    }
    tabNavigation.current = false;
  }, [tab]);
  const handleTabKey = (event, key) => {
    const index = tabs.findIndex(([value]) => value === key);
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next][0]); }
  };
  const dropout = data?.strategy === 'topk_dropout';
  const actionLabel = dropout ? '평가' : '교체';
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    api.getQuantPortfolio(sessionId).then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sessionId, turn?.turnNumber, retry]);

  return <Modal title="퀀트 모델" wide help={help(data)}>
    <div className="quant-panel">
      <div className="quant-heading"><div><span className="quant-eyebrow">YOUR QUANT RIVAL</span>
        <h3>숫자로 선택하는 경쟁자</h3><p>가격과 거래량을 읽고 스스로 투자하는 상대</p></div>
        <span className="quant-badge">{dropout ? `매 턴 평가 · 최대 ${data.nDrop}종목 교체` : data?.rebalanceTurns ? `${data.rebalanceTurns}턴마다 교체` : '운용 정보 확인 중'}</span></div>
      {error && <div role="alert" className="quant-empty"><p>{error}</p>
        <button className="btn-primary" onClick={() => setRetry((v) => v + 1)}>다시 불러오기</button></div>}
      {!data && !error && <p role="status" className="quant-empty">퀀트의 포트폴리오를 확인하고 있습니다…</p>}
      {data?.status === 'unavailable' && <p className="quant-empty">{data.message}</p>}
      {data && data.status !== 'unavailable' && <>
        <div className="quant-stats">
          <div><span>퀀트 총자산</span><strong>{won(data.totalAsset)}</strong></div>
          <div><span>퀀트 누적 수익률</span><strong className={changeClass(data.returnRate)}>{pct(data.returnRate)}</strong></div>
          <div><span>내 총자산</span><strong>{won(data.playerTotalAsset)}</strong></div>
        </div>
        <p className="quant-comparison">{data.comparisonNote}</p>
        <div className="quant-schedule">
          <span>현재 {data.turnNumber}턴</span>
          <span>{data.decision ? `최근 ${actionLabel} ${data.decision.turn}턴` : '첫 개장일 대기'}</span>
          <span>{data.rebalancePending ? '예약 주문 · 다음 개장일 시가 체결' : data.nextRebalanceTurn ? `다음 ${actionLabel} ${data.nextRebalanceTurn}턴` : '게임 종료까지 보유'}</span>
        </div>
        {data.status === 'no_signal' && <p className="quant-notice">이 시점의 예측 정보가 없어 매매를 건너뛰고 기존 보유 종목과 현금을 유지합니다.</p>}
        {data.status === 'no_eligible_stocks' && <p className="quant-notice">거래 가능한 선택 종목이 없습니다.</p>}
        <div className="filter-bar quant-tabs" role="tablist" aria-label="퀀트 모델 정보">
          {tabs.map(([key, label]) =>
            <button key={key} ref={(element) => { tabRefs.current[key] = element; }} id={`quant-tab-${key}`}
              role="tab" aria-selected={tab === key} aria-controls="quant-tab-panel" tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'active' : ''} onClick={() => selectTab(key)} onKeyDown={(event) => handleTabKey(event, key)}>{label}</button>)}
        </div>
        <div id="quant-tab-panel" role="tabpanel" aria-labelledby={`quant-tab-${tab}`} tabIndex={0}>
          {tab === 'learning' && <QuantModelGuide data={data} onIndicators={() => selectTab('indicators')} />}
          {tab === 'indicators' && <QuantIndicatorGuide data={data} />}
          {tab === 'holdings' && <QuantStrategyGuide data={data} onLearn={() => selectTab('learning')} />}
          {!['learning', 'indicators'].includes(tab) && <div className="quant-table-wrap">
          {tab === 'holdings' && <>
            <table className="data-table"><thead><tr><th>종목</th><th>수량</th><th>비중</th><th>평가액</th><th>수익률</th></tr></thead>
              <tbody>{data.holdings.map((h) => <tr key={h.assetId}><td>{h.name}</td><td>{h.quantity.toLocaleString('ko-KR')}</td>
                <td>{pct(h.weight, 1)}</td><td>{won(h.value)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td></tr>)}
                <tr className="quant-cash"><td>현금</td><td>—</td><td>{pct(data.cash / data.totalAsset, 1)}</td><td>{won(data.cash)}</td><td>—</td></tr>
              </tbody></table>
            <p className="quant-footnote">정수 주식 수량으로 매수해 남은 금액은 현금으로 보유합니다.</p>
          </>}
          {tab === 'selection' && <>
            <p className="quant-footnote">{data.decision?.signalDate ? `${relativeYearDate(data.decision.signalDate, data.date)}까지의 정보로 선택했습니다.` : '선택 기록이 없습니다.'} 모델 점수가 높을수록 코스피 대비 더 나은 수익률을 예상합니다. 실제 수익이나 상승 확률을 보장하지는 않습니다.</p>
            {dropout && <p className="quant-footnote">순위가 유지되면 거래하지 않습니다. 처음 종목을 채울 때를 제외하고 하루 최대 {data.nDrop}종목을 교체하며, 아래 비중은 최근 평가 시점의 실제 보유 비중입니다.</p>}
            <table className="data-table"><thead><tr><th>순위</th><th>종목</th><th>모델 점수</th><th>{dropout ? '보유 비중' : '목표 비중'}</th>{dropout && <th>선택</th>}</tr></thead>
              <tbody>{(data.decision?.selections || []).map((s) => <tr key={s.assetId}><td>{s.rank ?? '—'}</td><td>{s.name}</td><td>{Number.isFinite(s.score) ? s.score.toFixed(4) : '—'}</td><td>{pct(dropout ? s.weight : s.targetWeight, 1)}</td>{dropout && <td>{{bought:'신규 매수',buy_pending:'매수 예약',sell_pending:'매도 예약'}[s.action] || '유지'}</td>}</tr>)}</tbody></table>
          </>}
          {tab === 'orders' && <>
            <p className="quant-footnote">다음 개장일 시가로 체결할 주문입니다. 아래 수량은 요청 수량이며, 실제 체결 수량은 예산에 따라 줄어들 수 있습니다.</p>
            {!(data.pendingOrders || []).length ? <p className="quant-empty">대기 중인 주문이 없습니다.</p> :
              <table className="data-table"><thead><tr><th>종목</th><th>주문</th><th>요청 수량</th><th>매수 예산</th></tr></thead>
                <tbody>{data.pendingOrders.map(o => <tr key={o.orderKey}><td>{o.name}</td><td>{o.side === 'buy' ? '매수' : '매도'}</td><td>{o.quantity.toLocaleString('ko-KR')}</td><td>{o.side === 'buy' ? won(o.cashBudget) : '—'}</td></tr>)}</tbody></table>}
          </>}
          {tab === 'history' && <table className="data-table"><thead><tr><th>턴</th><th>총자산</th><th>현금</th><th>누적 수익률</th></tr></thead>
            <tbody>{[...data.history].reverse().map((h) => <tr key={h.turn}><td>{h.turn}턴</td><td>{won(h.totalAsset)}</td><td>{won(h.cash)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td></tr>)}</tbody></table>}
          </div>}
        </div>
        <p className="quant-footnote">{data.priceBasis?.startsWith('adjusted')
          ? '게임과 퀀트 모두 수정주가 기준입니다. 주식분할 등 가격 조정은 데이터에 반영하며, 현금배당은 별도로 지급하지 않습니다.'
          : '게임에 수록된 주식과 가격 기준으로 운용합니다. 배당·주식분할은 별도로 반영하지 않습니다.'}</p>
      </>}
    </div>
  </Modal>;
}
