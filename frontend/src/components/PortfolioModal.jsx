// 포트폴리오 모달: 현금과 보유 주식 / 평가손익
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import ReturnsDashboard from './ReturnsDashboard';
import PendingOrders from './PendingOrders';
import { won, pct, changeClass } from '../utils/format';

const PNL_PERIODS = [
  { key: 'daily', label: '일간' }, { key: 'weekly', label: '주간' },
  { key: 'monthly', label: '월간' }, { key: 'yearly', label: '연간' }, { key: 'all', label: '전체' },
];
// 포트폴리오 화면 도움말 (Modal의 ? 버튼으로 토글)
const PORTFOLIO_HELP = (
  <>
    <p><b>보유 자산과 수익 성과</b>를 확인하는 화면이다.</p>
    <ul>
      <li><b>총자산</b> — 현금 + 보유 자산 평가액. <b>순자산</b>은 여기서 부채를 뺀 값이다.</li>
      <li><b>평가손익</b> — 지금 들고 있는 자산의 미실현 손익(팔지 않은 상태의 손익)이다.</li>
      <li><b>포트폴리오 구성</b> — 현금과 보유 주식 종목별 금액과 비중을 확인한다.</li>
      <li><b>시장 대비 내 투자</b> — 부업·월급·상환 등 투자 외 입출금을 제외한 수익률을 코스피·코스닥과 비교한다. 일별·주별·월별 성과도 볼 수 있다.</li>
      <li><b>보유자산</b> — 지금 들고 있는 종목별 수량·평균단가·평가액·수익률 목록. 클릭하면 종목 상세로 이동한다.</li>
      <li><b>수익분석</b> — 실제로 팔아서 확정된 <b>실현손익</b>을 기간별로 모아본다.</li>
    </ul>
  </>
);

export default function PortfolioModal() {
  const { sessionId, openModal } = useGameStore();
  const [pf, setPf] = useState(null);
  const [tab, setTab] = useState('dashboard'); // dashboard | holdings | pnl
  const [pnlPeriod, setPnlPeriod] = useState('all');
  const [pnl, setPnl] = useState(null);

  useEffect(() => {
    api.getPortfolio(sessionId).then(setPf).catch(console.error);
  }, [sessionId]);

  // 수익분석: 기간별/자산군별 실현손익 (기능명세서 §자산)
  useEffect(() => {
    if (tab === 'pnl') {
      api.getRealizedPnl(sessionId, pnlPeriod, 'stock').then(setPnl).catch(console.error);
    }
  }, [tab, pnlPeriod, sessionId]);

  if (!pf) return <Modal title="포트폴리오" wide help={PORTFOLIO_HELP} />;

  return (
    <Modal title="포트폴리오" wide help={PORTFOLIO_HELP}>
      <dl className="info-list horizontal">
        <div><dt>총자산</dt><dd>{won(pf.totalAsset)}</dd></div>
        <div><dt>순자산</dt><dd>{won(pf.netAsset)}</dd></div>
        <div><dt>평가손익</dt><dd className={changeClass(pf.unrealizedPnl)}>{won(pf.unrealizedPnl)}</dd></div>
      </dl>

      <div className="filter-bar">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>수익률 대시보드</button>
        <button className={tab === 'holdings' ? 'active' : ''} onClick={() => setTab('holdings')}>보유자산</button>
        <button data-tutorial="orders-tab" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>주문 내역</button>
        <button className={tab === 'pnl' ? 'active' : ''} onClick={() => setTab('pnl')}>수익분석</button>
      </div>

      {/* 보유자산·수익분석은 고정 높이 패널 안에서만 스크롤한다 (5종목까지 스크롤 없이 보임).
          대시보드는 내용이 길어 고정하지 않고 자연 높이로 둔다. */}
      <div className={`pf-panel${tab === 'dashboard' ? ' auto' : ''}`}>
      {tab === 'orders' && <PendingOrders sessionId={sessionId}/>}
      {tab === 'dashboard' && (
        <div className="pf-dashboard-main">
          <ReturnsDashboard sessionId={sessionId} />
        </div>
      )}

      {tab === 'holdings' && (
        <table className="data-table">
          <thead>
            <tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가액</th><th>수익률</th></tr>
          </thead>
          <tbody>
            <tr className="pf-cash-row">
              <td>현금</td><td>—</td><td>—</td><td>—</td><td>{won(pf.cash)}</td><td>—</td>
            </tr>
            {pf.holdings.map((h) => (
              <tr key={h.assetId} onClick={() => openModal('asset', { assetId: h.assetId })}>
                <td>{h.name}</td>
                <td>{h.quantity}</td>
                <td>{won(h.avgPrice)}</td>
                <td>{won(h.price)}</td>
                <td>{won(h.value)}</td>
                <td className={changeClass(h.returnRate)}>{pct(h.returnRate)}</td>
              </tr>
            ))}
            {pf.holdings.length === 0 && (
              <tr><td colSpan="6" className="news-empty">보유한 주식이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'pnl' && (
        <>
          <div className="filter-bar sub">
            {PNL_PERIODS.map((p) => (
              <button key={p.key} className={pnlPeriod === p.key ? 'active' : ''} onClick={() => setPnlPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="pnl-body">
            <div className="pnl-main">
              {pnl && (
                <>
                  <dl className="info-list horizontal">
                    <div><dt>실현손익 합계</dt>
                      <dd className={changeClass(pnl.totalPnl)}>{won(pnl.totalPnl)}</dd></div>
                    <div><dt>거래 횟수</dt><dd>{pnl.tradeCount}회</dd></div>
                  </dl>
                  <table className="data-table">
                    <thead><tr><th>종목</th><th>실현손익</th><th>거래</th></tr></thead>
                    <tbody>
                      {pnl.byAsset.map((r) => (
                        <tr key={r.assetId} onClick={() => openModal('asset', { assetId: r.assetId })}>
                          <td>{r.name}</td>
                          <td className={changeClass(r.pnl)}>{won(r.pnl)}</td>
                          <td>{r.tradeCount}회</td>
                        </tr>
                      ))}
                      {pnl.byAsset.length === 0 && (
                        <tr><td colSpan="3" className="news-empty">해당 기간 실현손익이 없다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </>
      )}
      </div>
    </Modal>
  );
}
