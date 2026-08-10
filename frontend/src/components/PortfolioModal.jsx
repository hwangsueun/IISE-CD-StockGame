// 포트폴리오 모달: 전체/주식/채권/코인별 구성과 일/주/월/전체 성과
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import ReturnsDashboard from './ReturnsDashboard';
import { won, pct, changeClass } from '../utils/format';

const ASSET_TABS = [
  { key: 'all', label: '전체', icon: '◆' },
  { key: 'stock', label: '주식', icon: '▥' },
  { key: 'bond', label: '채권', icon: '▤' },
  { key: 'coin', label: '코인', icon: '●' },
];
const TYPE_LABEL = { stock: '주식', bond: '채권', coin: '코인' };

export default function PortfolioModal() {
  const { sessionId, openModal } = useGameStore();
  const [pf, setPf] = useState(null);
  const [assetType, setAssetType] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.getPortfolio(sessionId)
      .then((result) => { if (active) setPf(result); })
      .catch((err) => { if (active) setError(err.message || '포트폴리오를 불러오지 못했다.'); });
    return () => { active = false; };
  }, [sessionId]);

  const holdings = pf?.holdings.filter((holding) => assetType === 'all' || holding.assetType === assetType) || [];

  return (
    <Modal title="포트폴리오 대시보드" xwide>
      {error && <p className="dash-error">{error}</p>}
      {!pf && !error && <p className="dash-empty">포트폴리오를 불러오는 중…</p>}
      {pf && (
        <div className="pf-dashboard-layout">
          <aside className="pf-scope-side" aria-label="자산 구분">
            <span className="pf-scope-title">자산 구분</span>
            {ASSET_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={assetType === tab.key ? 'active' : ''}
                onClick={() => setAssetType(tab.key)}
              >
                <i>{tab.icon}</i><span>{tab.label}</span>
              </button>
            ))}
          </aside>

          <div className="pf-dashboard-main">
            <ReturnsDashboard sessionId={sessionId} assetType={assetType} />

            <section className="pf-holdings">
              <h4 className="dash-h">
                {assetType === 'all' ? '전체' : ASSET_TABS.find((tab) => tab.key === assetType)?.label} 보유자산
                <small>{holdings.length}종목</small>
              </h4>
              <div className="pf-holdings-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>종목</th><th>구분</th><th>수량</th><th>현재가</th><th>평가액</th><th>수익률</th></tr>
                  </thead>
                  <tbody>
                    {holdings.map((holding) => (
                      <tr key={holding.assetId} onClick={() => openModal('asset', { assetId: holding.assetId })}>
                        <td>{holding.name}</td>
                        <td>{TYPE_LABEL[holding.assetType]}</td>
                        <td>{holding.quantity.toLocaleString('ko-KR')}</td>
                        <td>{won(holding.price)}</td>
                        <td>{won(holding.value)}</td>
                        <td className={changeClass(holding.returnRate)}>{pct(holding.returnRate)}</td>
                      </tr>
                    ))}
                    {holdings.length === 0 && (
                      <tr><td colSpan="6" className="news-empty">해당 자산군에 보유 자산이 없다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
