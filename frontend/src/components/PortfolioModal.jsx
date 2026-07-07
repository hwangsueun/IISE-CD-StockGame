// 포트폴리오 모달: 보유자산/평가손익/자산군 비중 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, pct, changeClass } from '../utils/format';

const TYPE_LABEL = { cash: '현금', stock: '주식', bond: '채권', coin: '코인' };
const TYPE_COLOR = { cash: '#8a8f98', stock: '#e2504c', bond: '#3b6fd4', coin: '#e8a33d' };

export default function PortfolioModal() {
  const { sessionId, openModal } = useGameStore();
  const [pf, setPf] = useState(null);

  useEffect(() => {
    api.getPortfolio(sessionId).then(setPf).catch(console.error);
  }, [sessionId]);

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
    </Modal>
  );
}
