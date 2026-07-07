// 포트폴리오 모달: 보유자산/평가손익/자산군 비중 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, pct, changeClass } from '../utils/format';

const TYPE_LABEL = { cash: '현금', stock: '주식', bond: '채권', coin: '코인' };
const TYPE_COLOR = { cash: '#8a8f98', stock: '#e2504c', bond: '#3b6fd4', coin: '#e8a33d' };

const PNL_PERIODS = [
  { key: 'daily', label: '일간' }, { key: 'weekly', label: '주간' },
  { key: 'monthly', label: '월간' }, { key: 'yearly', label: '연간' }, { key: 'all', label: '전체' },
];

export default function PortfolioModal() {
  const { sessionId, openModal } = useGameStore();
  const [pf, setPf] = useState(null);
  const [tab, setTab] = useState('holdings'); // holdings | pnl
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
        <button className={tab === 'holdings' ? 'active' : ''} onClick={() => setTab('holdings')}>보유자산</button>
        <button className={tab === 'pnl' ? 'active' : ''} onClick={() => setTab('pnl')}>수익분석</button>
      </div>

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
            <select value={pnlType} onChange={(e) => setPnlType(e.target.value)}>
              <option value="">전체 자산</option>
              <option value="stock">주식</option>
              <option value="bond">채권</option>
              <option value="coin">코인</option>
            </select>
          </div>
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
        </>
      )}
    </Modal>
  );
}
