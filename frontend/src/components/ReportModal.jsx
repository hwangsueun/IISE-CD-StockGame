import { useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';
import { won } from '../utils/format.js';

// 섹션 8-2/9-2/10 월간 리포트 + 월말 상환(POST /api/game/:id/repay)
export default function ReportModal() {
  const { turnData, repay, closeModal } = useGame();
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const state = turnData?.state;

  async function submit() {
    setBusy(true);
    try {
      const res = await repay(Number(amount));
      setDone(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${turnData?.monthIndex}개월차 리포트 · 상환`}>
      <div className="card" style={{ marginBottom: 14 }}>
        <Row label="현금" value={won(state?.cash)} />
        <Row label="총자산" value={won(state?.totalAsset)} />
        <Row label="남은 부채" value={won(state?.debt)} />
      </div>

      {done ? (
        <div className="ok" style={{ textAlign: 'center', padding: 12 }}>
          {won(done.paid)} 상환 완료. 남은 부채 {won(done.state.debt)}
          <button className="next-turn" style={{ width: '100%', marginTop: 14 }} onClick={closeModal}>
            확인
          </button>
        </div>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span className="dim" style={{ fontSize: 12 }}>상환 금액</span>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: '100%', padding: 10, marginTop: 4, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            />
          </label>
          <button className="next-turn" style={{ width: '100%' }} disabled={busy} onClick={submit}>
            {busy ? '상환 중…' : '상환하기'}
          </button>
        </>
      )}
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span className="dim">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
