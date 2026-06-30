import { useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';
import { won, rate } from '../utils/format.js';

// 섹션 10 마켓 모달: 자산군 필터 + 시세 목록. 행 클릭 시 종목 상세로.
const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'stock', label: '주식' },
  { key: 'bond', label: '채권' },
  { key: 'coin', label: '코인' },
];

export default function MarketModal() {
  const { turnData, openModal } = useGame();
  const [filter, setFilter] = useState('all');
  const assets = turnData?.assets ?? [];
  const rows = filter === 'all' ? assets : assets.filter((a) => a.assetType === filter);

  return (
    <Modal title="시장">
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="tag"
            style={filter === f.key ? { background: 'var(--accent)', color: '#fff' } : undefined}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <table className="list-table">
        <thead>
          <tr>
            <th>종목</th>
            <th>현재가</th>
            <th>등락률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const r = rate(a.changeRate);
            return (
              <tr key={a.assetId} onClick={() => openModal('detail', { assetId: a.assetId })}>
                <td>
                  {a.name} <span className="dim" style={{ fontSize: 11 }}>{a.sector}</span>
                </td>
                <td>{won(a.price)}</td>
                <td className={r.cls}>{r.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
