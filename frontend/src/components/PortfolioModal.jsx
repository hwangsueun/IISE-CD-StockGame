import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';
import { won, rate } from '../utils/format.js';

// 섹션 8-2/10 포트폴리오: 보유자산 · 평가손익 · 비중
export default function PortfolioModal() {
  const { api, sessionId } = useGame();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getPortfolio(sessionId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [api, sessionId]);

  if (!data) {
    return (
      <Modal title="포트폴리오">
        <div className="loading">불러오는 중…</div>
      </Modal>
    );
  }

  return (
    <Modal title="포트폴리오">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="dim">총자산</span>
        <strong>{won(data.totalAsset)}</strong>
      </div>

      {data.rows.length === 0 ? (
        <div className="empty">보유 중인 자산이 없습니다.</div>
      ) : (
        <table className="list-table">
          <thead>
            <tr>
              <th>종목</th>
              <th>수량</th>
              <th>평가금액</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const pr = rate(r.profitRate);
              return (
                <tr key={r.assetId}>
                  <td>{r.name}</td>
                  <td>{r.quantity}</td>
                  <td>{won(r.evalValue)}</td>
                  <td className={pr.cls}>{pr.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <span className="dim">현금</span>
        <span>{won(data.cash)}</span>
      </div>
    </Modal>
  );
}
