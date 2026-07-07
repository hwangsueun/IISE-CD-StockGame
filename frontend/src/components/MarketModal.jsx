// 마켓 모달: 자산군 필터 + 정렬 랭킹 + 거시지표 탭 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, signed, changeClass } from '../utils/format';

const TYPE_TABS = [
  { key: '', label: '전체' },
  { key: 'stock', label: '주식' },
  { key: 'bond', label: '채권' },
  { key: 'coin', label: '코인' },
  { key: 'macro', label: '지표' },
];
const SORTS = [
  { key: 'change', label: '등락률' },
  { key: 'volume', label: '거래량' },
  { key: 'amount', label: '거래대금' },
];

export default function MarketModal() {
  const { turn, openModal } = useGameStore();
  const [tab, setTab] = useState('');
  const [sort, setSort] = useState('change');
  const [assets, setAssets] = useState([]);
  const [macro, setMacro] = useState([]);

  useEffect(() => {
    if (tab === 'macro') {
      api.getMacro(turn.date).then(setMacro).catch(console.error);
    } else {
      api.listAssets({ type: tab || undefined, sort, date: turn.date })
        .then(setAssets)
        .catch(console.error);
    }
  }, [tab, sort, turn.date]);

  return (
    <Modal title="마켓" wide>
      <div className="filter-bar">
        {TYPE_TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        {tab !== 'macro' && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
      </div>

      {tab === 'macro' ? (
        <table className="data-table">
          <thead><tr><th>지표</th><th>값</th><th>전일 대비</th></tr></thead>
          <tbody>
            {macro.map((m) => (
              <tr key={m.code}>
                <td>{m.name}</td>
                <td>{m.value?.toLocaleString('ko-KR')} {m.unit}</td>
                <td className={changeClass(m.change)}>{m.change === null ? '-' : m.change.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead><tr><th>종목</th><th>업종</th><th>현재가</th><th>등락률</th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.assetId} onClick={() => openModal('asset', { assetId: a.assetId })}>
                <td>{a.name}</td>
                <td>{a.sector || (a.assetType === 'bond' ? '채권' : a.assetType === 'coin' ? '코인' : '-')}</td>
                <td>{won(a.price)}</td>
                <td className={changeClass(a.changeRate)}>{signed(a.changeRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
