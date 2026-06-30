import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';
import { won, rate } from '../utils/format.js';

// 섹션 10 종목 상세: 차트(간이) · 정보 · 종토방. 매수/매도 진입.
export default function AssetDetailModal() {
  const { api, turnData, modalContext, openModal } = useGame();
  const assetId = modalContext?.assetId;
  const [info, setInfo] = useState(null);
  const [prices, setPrices] = useState([]);
  const [posts, setPosts] = useState([]);

  const snapshot = turnData?.assets?.find((a) => a.assetId === assetId);

  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    Promise.all([api.getAsset(assetId), api.getAssetPrices(assetId, {}), api.getCommunity(assetId)]).then(
      ([i, p, c]) => {
        if (!alive) return;
        setInfo(i);
        setPrices(p);
        setPosts(c);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, assetId]);

  if (!assetId) return null;
  const r = rate(snapshot?.changeRate);
  const max = Math.max(...prices.map((p) => p.close), 1);

  return (
    <Modal title={info?.name ?? assetId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{won(snapshot?.price)}</div>
        <div className={r.cls}>{r.text}</div>
      </div>

      {/* 간이 스파크라인 차트 (asset_prices 기반) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, margin: '14px 0' }}>
        {prices.slice(-30).map((p, i) => (
          <div
            key={i}
            title={`${p.date}: ${won(p.close)}`}
            style={{ flex: 1, height: `${(p.close / max) * 100}%`, background: 'var(--accent)', opacity: 0.6, borderRadius: 2 }}
          />
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>정보</div>
        <div>업종: {info?.sector ?? '-'} · 유형: {snapshot?.assetType ?? '-'}</div>
      </div>

      <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>종목토론방</div>
      {posts.map((p) => (
        <div key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span className={`tag ${p.sentiment}`}>{p.npcNickname}</span> {p.title}{' '}
          <span className="dim">추천 {p.recommendCount}</span>
        </div>
      ))}

      <button
        className="next-turn"
        style={{ width: '100%', marginTop: 16 }}
        onClick={() => openModal('trade', { assetId })}
      >
        매수 / 매도
      </button>
    </Modal>
  );
}
