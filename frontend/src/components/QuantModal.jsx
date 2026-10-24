import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { won, pct, changeClass, relativeYearDate } from '../utils/format';
import Modal from './Modal';
import QuantStrategyGuide from './QuantStrategyGuide';
import QuantModelGuide from './QuantModelGuide';
import QuantIndicatorGuide from './QuantIndicatorGuide';
import QuantChallenge, { ChallengeInvitation } from './QuantChallenge';
import QuantWorkshop from './QuantWorkshop';
import QuantAttribution from './QuantAttribution';
import { getQuantExplanation } from '../utils/quantExplanation';
import './QuantModal.css';

const tabs = [['challenge', '투자 챌린지'], ['workshop', '나만의 투자 모델 만들기'], ['portfolio', 'alpha158의 포트폴리오'], ['about', 'What is Alpha158?']];
const portfolioTabs = [['holdings','보유 종목'], ['selection','종목 선택'], ['orders','예약 주문'], ['history','운용 기록']];

const help = (data) => <>
  <p>LightGBM이라는 AI가 과거 주가·거래량 지표와 이후 실제 수익률의 관계를 학습합니다. 오늘의 지표로 코스피 대비 수익률을 예측합니다. 당신과 같은 초기 투자금으로 주식을 운용합니다.</p>
  {data?.strategy === 'topk_dropout'
    ? <p>처음에는 상위 {data.topK}종목에 같은 금액을 배분합니다. 이후 매 턴 순위를 평가하고 최대 {data.nDrop}종목을 교체합니다. 기존 보유 종목의 비중은 매일 다시 맞추지 않습니다.</p>
    : data?.rebalanceTurns && <p>이 게임에 연결된 기존 모델은 {data.rebalanceTurns}턴마다 상위 {data.topK}종목에 같은 금액을 배분합니다.</p>}
  <p>휴장일에는 매매하지 않고 다음 개장일까지 기다립니다.</p>
  <p>{getQuantExplanation(data)?.execution} 평가는 당일 종가로 합니다. 버튼을 누르는 시점과 횟수는 결과에 영향을 주지 않습니다.</p>
  <p>매수 수량과 예산은 주문할 때 정합니다. 시가가 오르거나 현금이 부족하면 예산 안에서 수량을 줄이고 나머지는 취소합니다. 매도부터 체결합니다. 개별 종목의 시가가 없으면 주문은 체결되지 않습니다.</p>
  <p>모델 점수는 코스피 대비 성과를 예측한 값입니다. 실제 수익률이나 상승 확률을 보장하지 않습니다.</p>
</>;

export default function QuantModal() {
  const { sessionId, turn, closeModal, loadTurn } = useGameStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState('challenge');
  const [portfolioTab,setPortfolioTab] = useState('holdings');
  const [attributionAsset, setAttributionAsset] = useState(null);
  const showAttribution = assetId => {
    setAttributionAsset(assetId);
    document.getElementById('quant-attribution-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const detailTab = tab === 'portfolio' ? portfolioTab : null;
  const [exploring, setExploring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const act = async (month) => {
    setBusy(true);
    setActionError('');
    try {
      if (month === undefined) {
        await api.joinQuantChallenge(sessionId);
        setMessage('참가 신청이 완료되었습니다. 첫 월말 결산을 준비하세요.');
      } else {
        const result = await api.claimQuantPrize(sessionId, month);
        setMessage(`${won(result.prize)} 상금 수령 완료. 보유 현금에 반영되었습니다.`);
      }
      // Refresh even after a committed action; retries are idempotent on the server.
      const result = await api.getQuantPortfolio(sessionId);
      setData(result);
      await loadTurn(turn.turnNumber);
    } catch (e) { setActionError(e.message); }
    finally { setBusy(false); }
  };
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

  if (data?.challenge && !data.challenge.enrolled && !exploring) {
    return <Modal title="alpha158 · 투자 챌린지 초대" wide showTutorial={false}>
      <ChallengeInvitation challenge={data.challenge} available={data.status !== 'unavailable'}
        busy={busy} error={actionError} onJoin={() => act()} onLater={closeModal}
        onExplore={() => { setExploring(true); setTab('portfolio'); }} />
    </Modal>;
  }

  return <Modal title="투자 챌린지 · 모델 연구실" wide>
    <div className="quant-panel">
      <div className="quant-heading"><div><span className="quant-eyebrow">ALPHA158</span>
        <h3>alpha158과 투자하기</h3></div>
      </div>
      {error && <div role="alert" className="quant-empty"><p>{error}</p>
        <button className="btn-primary" onClick={() => setRetry((v) => v + 1)}>다시 불러오기</button></div>}
      {!data && !error && <p role="status" className="quant-empty">alpha158의 포트폴리오를 확인하고 있습니다…</p>}
      {data && <>
        {data.status === 'unavailable' && <p role="status" className="quant-empty">{data.message}</p>}
        {tab === 'portfolio' && data.status !== 'unavailable' && <>
        <div className="quant-stats">
          <div><span>alpha158 총자산</span><strong>{won(data.totalAsset)}</strong></div>
          <div><span>alpha158 누적 수익률</span><strong className={changeClass(data.returnRate)}>{pct(data.returnRate)}</strong></div>
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
        </>}
        <div className="filter-bar quant-tabs" role="tablist" aria-label="alpha158 정보">
          {tabs.map(([key, label]) =>
            <button key={key} ref={(element) => { tabRefs.current[key] = element; }} id={`quant-tab-${key}`}
              role="tab" aria-selected={tab === key} aria-controls="quant-tab-panel" tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'active' : ''} onClick={() => selectTab(key)} onKeyDown={(event) => handleTabKey(event, key)}>{label}</button>)}
        </div>
        <div id="quant-tab-panel" role="tabpanel" aria-labelledby={`quant-tab-${tab}`} tabIndex={0}>
          {tab === 'workshop' && <QuantWorkshop key={sessionId} sessionId={sessionId} turnNumber={turn?.turnNumber} />}
          {tab === 'challenge' && <QuantChallenge challenge={data.challenge} busy={busy} message={message}
            error={actionError} onClaim={act} onInvite={() => setExploring(false)} onExplore={() => selectTab('portfolio')} />}
          {tab === 'about' && <div className="alpha158-about">
            <h3>What is Alpha158?</h3><p>이 게임에서는 공식 Alpha158 지표 158개와 LightGBM을 사용하는 투자 상대를 alpha158이라고 부릅니다. Alpha158 자체는 가격과 거래량으로 만든 지표 모음입니다.</p>
            <QuantModelGuide data={data} onIndicators={() => document.getElementById('alpha158-indicators')?.scrollIntoView({behavior:'smooth'})} />
            <QuantStrategyGuide data={data} />
            <details className="workshop-details"><summary>주문과 체결 방식</summary>{help(data)}</details>
            <div id="alpha158-indicators"><QuantIndicatorGuide data={data} /></div>
          </div>}
          {tab === 'portfolio' && <nav className="workshop-nav" aria-label="alpha158 포트폴리오 상세">{portfolioTabs.map(([key,label])=><button type="button" key={key} aria-pressed={portfolioTab===key} onClick={()=>setPortfolioTab(key)}>{label}</button>)}</nav>}
          {tab === 'portfolio' && data.status !== 'unavailable' && <div className="quant-table-wrap">
          {detailTab === 'holdings' && <>
            <table className="data-table"><thead><tr><th>종목</th><th>수량</th><th>비중</th><th>평가액</th><th>수익률</th><th>판단 근거</th></tr></thead>
              <tbody>{data.holdings.map((h) => <tr key={h.assetId}><td>{h.name}</td><td>{h.quantity.toLocaleString('ko-KR')}</td>
                <td>{pct(h.weight, 1)}</td><td>{won(h.value)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td><td>{data.decision?.selections.some(s => s.assetId === h.assetId) ? <button type="button" className="quant-analysis-button" aria-label={`${h.name} 지표 분석`} onClick={() => showAttribution(h.assetId)}>지표 분석</button> : '평가 자료 없음'}</td></tr>)}
                <tr className="quant-cash"><td>현금</td><td>—</td><td>{pct(data.cash / data.totalAsset, 1)}</td><td>{won(data.cash)}</td><td>—</td><td>—</td></tr>
              </tbody></table>
            <p className="quant-footnote">정수 주식 수량으로 매수해 남은 금액은 현금으로 보유합니다.</p>
          </>}
          {detailTab === 'selection' && <>
            <p className="quant-footnote">{data.decision?.signalDate ? `${relativeYearDate(data.decision.signalDate, data.date)}까지의 정보로 선택했습니다.` : '선택 기록이 없습니다.'} 모델 점수가 높을수록 코스피 대비 더 나은 수익률을 예상합니다. 실제 수익이나 상승 확률을 보장하지는 않습니다.</p>
            {dropout && <p className="quant-footnote">순위가 유지되면 거래하지 않습니다. 처음 종목을 채울 때를 제외하고 하루 최대 {data.nDrop}종목을 교체합니다. 아래 비중은 최근 평가 시점의 실제 보유 비중입니다.</p>}
            <table className="data-table"><thead><tr><th>순위</th><th>종목</th><th>모델 점수</th><th>{dropout ? '보유 비중' : '목표 비중'}</th>{dropout && <th>선택</th>}<th>판단 근거</th></tr></thead>
              <tbody>{(data.decision?.selections || []).map((s) => <tr key={s.assetId}><td>{s.rank ?? '—'}</td><td>{s.name}</td><td>{Number.isFinite(s.score) ? s.score.toFixed(4) : '—'}</td><td>{pct(dropout ? s.weight : s.targetWeight, 1)}</td>{dropout && <td>{{bought:'신규 매수',buy_pending:'매수 예약',sell_pending:'매도 예약'}[s.action] || '유지'}</td>}<td><button type="button" className="quant-analysis-button" aria-label={`${s.name} 지표 분석`} onClick={() => showAttribution(s.assetId)}>지표 분석</button></td></tr>)}</tbody></table>
          </>}
          {detailTab === 'orders' && <>
            <p className="quant-footnote">다음 개장일 시가로 체결할 주문입니다. 아래는 주문할 때 요청한 수량입니다. 실제 체결 수량은 예산에 따라 줄어들 수 있습니다.</p>
            {!(data.pendingOrders || []).length ? <p className="quant-empty">대기 중인 주문이 없습니다.</p> :
              <table className="data-table"><thead><tr><th>종목</th><th>주문</th><th>요청 수량</th><th>매수 예산</th></tr></thead>
                <tbody>{data.pendingOrders.map(o => <tr key={o.orderKey}><td>{o.name}</td><td>{o.side === 'buy' ? '매수' : '매도'}</td><td>{o.quantity.toLocaleString('ko-KR')}</td><td>{o.side === 'buy' ? won(o.cashBudget) : '—'}</td></tr>)}</tbody></table>}
          </>}
          {detailTab === 'history' && <table className="data-table"><thead><tr><th>턴</th><th>총자산</th><th>현금</th><th>누적 수익률</th></tr></thead>
            <tbody>{[...data.history].reverse().map((h) => <tr key={h.turn}><td>{h.turn}턴</td><td>{won(h.totalAsset)}</td><td>{won(h.cash)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td></tr>)}</tbody></table>}
          </div>}
          {tab === 'portfolio' && ['holdings', 'selection'].includes(detailTab) && data.status !== 'unavailable' &&
            <QuantAttribution sessionId={sessionId} data={data} selectedAsset={attributionAsset} onSelect={setAttributionAsset} />}
        </div>
        <p className="quant-footnote">{data.priceBasis?.startsWith('adjusted')
          ? '게임과 alpha158 모두 수정주가 기준입니다. 주식분할 등 가격 조정은 데이터에 반영합니다. 현금배당은 별도로 지급하지 않습니다.'
          : '게임에 수록된 주식과 가격 기준으로 운용합니다. 배당·주식분할은 별도로 반영하지 않습니다.'}</p>
      </>}
    </div>
  </Modal>;
}
