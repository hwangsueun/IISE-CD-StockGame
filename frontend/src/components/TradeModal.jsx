import { useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';
import { won } from '../utils/format.js';

// 섹션 9-3/10 매수·매도: 수량 입력 → 예상금액 → 확정. 체결은 서버(mock) 권위.
export default function TradeModal() {
  const { turnData, modalContext, doTrade, closeModal } = useGame();
  const assetId = modalContext?.assetId;
  const asset = turnData?.assets?.find((a) => a.assetId === assetId);
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!asset) return null;
  const amount = asset.price * Number(qty || 0);
  const cash = turnData.state.cash;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await doTrade({ assetId, tradeType: side, quantity: Number(qty) });
      closeModal();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${asset.name} ${side === 'buy' ? '매수' : '매도'}`}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          className="tag"
          style={side === 'buy' ? { background: 'var(--up)', color: '#fff' } : undefined}
          onClick={() => setSide('buy')}
        >
          매수
        </button>
        <button
          className="tag"
          style={side === 'sell' ? { background: 'var(--down)', color: '#fff' } : undefined}
          onClick={() => setSide('sell')}
        >
          매도
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="dim">현재가</span>
        <strong>{won(asset.price)}</strong>
      </div>

      <label style={{ display: 'block', marginBottom: 8 }}>
        <span className="dim" style={{ fontSize: 12 }}>수량</span>
        <input
          type="number"
          min="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          style={{ width: '100%', padding: 10, marginTop: 4, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
        />
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0' }}>
        <span className="dim">예상금액</span>
        <strong>{won(amount)}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="dim">보유현금</span>
        <span>{won(cash)}</span>
      </div>

      {error && <div className="up" style={{ marginBottom: 8 }}>{error}</div>}

      <button className="next-turn" style={{ width: '100%' }} disabled={busy || qty < 1} onClick={submit}>
        {busy ? '체결 중…' : `${side === 'buy' ? '매수' : '매도'} 확정`}
      </button>
    </Modal>
  );
}
