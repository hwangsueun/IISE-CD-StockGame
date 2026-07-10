// 급등주 이벤트 팝업 (미팅5 §4)
// 등장: 매수(수량 입력) / 관망 — 다음 턴 결과는 SurgeResultPopup으로 연출
// 서버 API는 금액(amount)만 받으므로 수량 × 현재가로 환산해서 전송한다.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { won, pct } from '../utils/format';

export function SurgeStockPopup() {
  const { sessionId, turn } = useGameStore();
  const [active, setActive] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [bought, setBought] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDismissed(false);
    setBought(null);
    api.getActiveSurge(sessionId).then(setActive).catch(console.error);
  }, [sessionId, turn?.turnNumber]);

  if (!active || !active.canBuy || dismissed) return null;

  const qty = Number(quantity) || 0;
  const estAmount = Math.round(active.buyPrice * qty);

  const buy = async () => {
    try {
      await api.buySurge(sessionId, active.surgeStockId, estAmount);
      setBought({ qty, amount: estAmount });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-overlay event-overlay">
      <div className="modal event-popup surge-popup">
        <h3>🚀 급등주 소문</h3>
        {bought ? (
          <>
            <p><b>{active.displayName}</b> {bought.qty}주 × {won(active.buyPrice)} = {won(bought.amount)} 매수 완료. 결과는 내일 공개된다...</p>
            <button className="btn-primary" onClick={() => setDismissed(true)}>확인</button>
          </>
        ) : (
          <>
            <p>
              "<b>{active.displayName}</b>가 곧 터진다던데..."<br />
              현재가 {won(active.buyPrice)}. 오늘만 매수할 수 있다.
            </p>
            <label className="field">
              매수 수량
              <input type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <p className="est-amount">예상 매수금액: <b>{won(estAmount)}</b></p>
            <div className="event-choices">
              <button disabled={!(qty > 0)} onClick={buy}>매수한다</button>
              <button onClick={() => setDismissed(true)}>관망한다</button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** 다음 턴 급등주 정산 결과 팝업 */
export function SurgeResultPopup() {
  const { surgeResults, dismissSurgeResults } = useGameStore();
  if (surgeResults.length === 0) return null;
  const r = surgeResults[0];
  const win = r.pnl >= 0;

  return (
    <div className="modal-overlay event-overlay">
      <div className="modal event-popup surge-popup">
        <h3>{win ? '📈 급등주 결과' : '📉 급등주 결과'}</h3>
        <p>
          <b>{r.displayName}</b> — {pct(r.returnRate)} ({won(r.pnl)})<br />
          {win ? '소문이 맞았다! 자동 매도로 수익 실현.' : '작전주에 물렸다... 자동 매도로 손절.'}
        </p>
        <p className="minigame-help">급등주는 시장에서 사라졌다. (스트레스 {r.stressDelta > 0 ? '+' : ''}{r.stressDelta})</p>
        <button className="btn-primary" onClick={dismissSurgeResults}>확인</button>
      </div>
    </div>
  );
}
