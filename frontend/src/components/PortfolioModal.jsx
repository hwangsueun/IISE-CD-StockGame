// 포트폴리오 모달: 보유자산/평가손익/자산군 비중 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import ReturnsDashboard from './ReturnsDashboard';
import { won, pct, changeClass } from '../utils/format';

const TYPE_LABEL = { cash: '현금', stock: '주식', bond: '채권', coin: '코인' };
const TYPE_COLOR = { cash: '#8a8f98', stock: '#e2504c', bond: '#3b6fd4', coin: '#e8a33d' };

const PNL_PERIODS = [
  { key: 'daily', label: '일간' }, { key: 'weekly', label: '주간' },
  { key: 'monthly', label: '월간' }, { key: 'yearly', label: '연간' }, { key: 'all', label: '전체' },
];
// 자산군 구분은 마켓 창처럼 좌측 세로 탭으로 (드롭다운 아님)
const PNL_TYPES = [
  { key: '', label: '전체' }, { key: 'stock', label: '주식' },
  { key: 'bond', label: '채권' }, { key: 'coin', label: '코인' },
];

export default function PortfolioModal() {
  const { sessionId, openModal } = useGameStore();
  const [pf, setPf] = useState(null);
  const [tab, setTab] = useState('dashboard'); // dashboard | holdings | pnl
  const [pnlPeriod, setPnlPeriod] = useState('all');
  const [pnlType, setPnlType] = useState('');
  const [pnl, setPnl] = useState(null);

  useEffect(() => {
    api.getPortfolio(sessionId).then(setPf).catch(console.error);
  }, [sessionId]);

  // 수익분석: 기간별/자산군별 실현손익 (기능명세서 §자산)
  useEffect(() => {
    if (tab === 'pnl') {
      api.getRealizedPnl(sessionId, pnlPeriod, pnlType || undefined).then(setPnl).catch(console.error);
    }
  }, [tab, pnlPeriod, pnlType, sessionId]);

  if (!pf) return <Modal title="포트폴리오" wide />;

  return (
    <Modal title="포트폴리오" wide>
      <dl className="info-list horizontal">
        <div><dt>총자산</dt><dd>{won(pf.totalAsset)}</dd></div>
        <div><dt>순자산</dt><dd>{won(pf.netAsset)}</dd></div>
        <div><dt>평가손익</dt><dd className={changeClass(pf.unrealizedPnl)}>{won(pf.unrealizedPnl)}</dd></div>
      </dl>

      {/* 자산군 비중 바 */}
      <div className="weight-bar">
        {Object.entries(pf.weights).map(([k, w]) =>
          w > 0 ? (
            <div key={k} className="weight-seg" style={{ width: `${w * 100}%`, background: TYPE_COLOR[k] }}
                 title={`${TYPE_LABEL[k]} ${pct(w)}`} />
          ) : null
        )}
      </div>
      <div className="weight-legend">
        {Object.entries(pf.weights).map(([k, w]) => (
          <span key={k}><i style={{ background: TYPE_COLOR[k] }} /> {TYPE_LABEL[k]} {pct(w, 1)}</span>
        ))}
      </div>

      <div className="filter-bar">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>수익률 대시보드</button>
        <button className={tab === 'holdings' ? 'active' : ''} onClick={() => setTab('holdings')}>보유자산</button>
        <button className={tab === 'pnl' ? 'active' : ''} onClick={() => setTab('pnl')}>수익분석</button>
      </div>

      {/* 보유자산·수익분석은 고정 높이 패널 안에서만 스크롤한다 (5종목까지 스크롤 없이 보임).
          대시보드는 내용이 길어 고정하지 않고 자연 높이로 둔다. */}
      <div className={`pf-panel${tab === 'dashboard' ? ' auto' : ''}`}>
      {tab === 'dashboard' && <ReturnsDashboard sessionId={sessionId} pf={pf} />}

      {tab === 'holdings' && (
        <table className="data-table">
          <thead>
            <tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가액</th><th>수익률</th></tr>
          </thead>
          <tbody>
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
              <tr><td colSpan="6" className="news-empty">보유 자산이 없다.</td></tr>
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
            {/* 자산군 구분: 마켓 창과 동일한 좌측 세로 탭 */}
            <aside className="pnl-side">
              {PNL_TYPES.map((t) => (
                <button
                  key={t.key || 'all'}
                  className={`mk-tab ${pnlType === t.key ? 'active' : ''}`}
                  onClick={() => setPnlType(t.key)}
                >
                  <span>{t.label}</span>
                </button>
              ))}
            </aside>

            <div className="pnl-main">
              {pnl && (
                <>
                  <dl className="info-list horizontal">
                    <div><dt>실현손익 합계</dt>
                      <dd className={changeClass(pnl.totalPnl)}>{won(pnl.totalPnl)}</dd></div>
                    <div><dt>거래 횟수</dt><dd>{pnl.tradeCount}회</dd></div>
                  </dl>
                  <table className="data-table">
                    <thead><tr><th>종목</th><th>구분</th><th>실현손익</th><th>거래</th></tr></thead>
                    <tbody>
                      {pnl.byAsset.map((r) => (
                        <tr key={r.assetId} onClick={() => openModal('asset', { assetId: r.assetId })}>
                          <td>{r.name}</td>
                          <td>{{ stock: '주식', bond: '채권', coin: '코인' }[r.assetType]}</td>
                          <td className={changeClass(r.pnl)}>{won(r.pnl)}</td>
                          <td>{r.tradeCount}회</td>
                        </tr>
                      ))}
                      {pnl.byAsset.length === 0 && (
                        <tr><td colSpan="4" className="news-empty">해당 기간 실현손익이 없다.</td></tr>
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
