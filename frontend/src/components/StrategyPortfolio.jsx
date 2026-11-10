import { useId, useState } from 'react';
import { won, pct, changeClass, relativeYearDate } from '../utils/format';
import { StrategyPortfolioSnapshot } from '../utils/strategyPortfolio';

const tabs = [['holdings', '보유 종목'], ['orders', '예약 주문'], ['history', '운용 기록']];

export default function StrategyPortfolio({ report, referenceDate, onAsset }) {
  const [tab, setTab] = useState('holdings');
  const titleId = useId();
  const portfolio = new StrategyPortfolioSnapshot(report);
  const holdings = portfolio.holdings;
  const orders = report.pendingOrders;
  return <section className="workshop-section workshop-portfolio" aria-labelledby={titleId}>
    <h4 id={titleId}>{report.config.name}의 포트폴리오</h4>
    <p>{relativeYearDate(report.to, referenceDate)} 기준 · {report.kind === 'observe' ? '저장 이후 모의 운용' : '과거 연습 마지막 시점'}</p>
    <p>초기 자금 {won(report.initialCash)}으로 이 모델만 따로 운용한 결과입니다. 자동 투자로 매매하는 실제 게임 계좌는 ‘내 포트폴리오’에서 확인하세요.</p>
    {!portfolio.available ? <p className="workshop-notice">이 기록에는 포트폴리오 상세가 없습니다. 저장 모델을 다시 관찰하거나 과거 연습을 새로 실행해 주세요.</p> : <>
      <div className="workshop-metrics">
        <div><span>모델 총자산</span><strong>{won(report.totalAsset)}</strong></div>
        <div><span>보유 현금</span><strong>{won(report.cash)}</strong></div>
        <div><span>주식 평가액</span><strong>{won(report.totalAsset - report.cash)}</strong></div>
      </div>
      <nav className="workshop-nav" aria-label={`${report.config.name} 포트폴리오 상세`}>
        {tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </nav>
      {tab === 'holdings' && <>
        {!holdings.length && <p className="workshop-notice">아직 체결된 보유 종목이 없어 현금으로 보유 중입니다.{orders?.length > 0 && ' 다음 개장일에 체결할 예약 주문을 확인하세요.'}</p>}
        <div className="workshop-scroll"><table className="data-table"><caption className="workshop-table-caption">체결된 보유 종목과 현금</caption>
          <thead><tr><th>종목</th><th>수량</th><th>비중</th><th>평균 매수가</th><th>평가 가격</th><th>평가액</th><th>평가손익</th><th>수익률</th></tr></thead>
          <tbody>{holdings.map(h => <tr key={h.assetId}>
            <td>{report.kind === 'observe' && onAsset ? <button type="button" className="workshop-asset-button" onClick={() => onAsset(h.assetId)}>{h.name}</button> : h.name}</td>
            <td>{h.quantity.toLocaleString('ko-KR')}</td><td>{pct(h.weight, 1)}</td><td>{won(h.avgPrice)}</td><td>{won(h.price)}</td><td>{won(h.value)}</td>
            <td className={changeClass(h.profit)}>{won(h.profit)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td>
          </tr>)}
            <tr className="quant-cash"><td>현금</td><td>—</td><td>{pct(portfolio.cashWeight, 1)}</td><td>—</td><td>—</td><td>{won(report.cash)}</td><td>—</td><td>—</td></tr>
          </tbody></table></div>
        <p>비중은 현금을 포함한 모델 총자산 기준입니다. 평가 가격은 해당 시점까지 확인된 최근 종가이며, 종목별 수익률은 평균 매수가 대비 가격 변화입니다. 거래비용은 모델 총자산에 반영됩니다.</p>
      </>}
      {tab === 'orders' && <>
        <p>해당 시점에 예약한 주문이며 다음 개장일 시가로 체결합니다. 요청 수량과 실제 체결 수량은 가격·현금 사정에 따라 달라질 수 있습니다.</p>
        {!Array.isArray(orders) ? <p>이 기록에는 예약 주문 내역이 저장되지 않았습니다.</p> : !orders.length ? <p>대기 중인 주문이 없습니다.</p> :
          <div className="workshop-scroll"><table className="data-table"><thead><tr><th>종목</th><th>주문</th><th>요청 수량</th><th>매수 예산</th></tr></thead>
            <tbody>{orders.map(o => <tr key={o.orderKey}><td>{o.name}</td><td>{o.side === 'buy' ? '매수' : '매도'}</td><td>{o.quantity.toLocaleString('ko-KR')}</td><td>{o.side === 'buy' ? won(o.cashBudget) : '—'}</td></tr>)}</tbody>
          </table></div>}
      </>}
      {tab === 'history' && <>
        <p>기간 시작을 1턴으로 표시합니다. 각 턴의 총자산은 현금과 보유 주식 평가액의 합계입니다.</p>
        {portfolio.history === null ? <p className="workshop-notice">이전 기록에는 턴별 자산 내역이 저장되지 않았습니다. 저장 모델의 포트폴리오를 다시 열거나 과거 연습을 새로 실행하면 확인할 수 있습니다.</p> :
          <div className="workshop-scroll workshop-history-scroll"><table className="data-table"><thead><tr><th>기간 내 턴</th><th>날짜</th><th>총자산</th><th>현금</th><th>주식 평가액</th><th>누적 수익률</th></tr></thead>
            <tbody>{[...portfolio.history].reverse().map(h => <tr key={h.turn}><td>{h.turn}턴</td><td>{relativeYearDate(h.date, referenceDate)}</td><td>{won(h.totalAsset)}</td><td>{won(h.cash)}</td><td>{won(h.totalAsset - h.cash)}</td><td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td></tr>)}</tbody>
          </table></div>}
      </>}
    </>}
  </section>;
}
