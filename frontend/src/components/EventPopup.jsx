// 이벤트 팝업 — 선택형(choice) 이벤트는 해결 전 턴 진행 불가 (§10)
// 독촉전화 '일부 상환' 등 금액 입력이 필요한 선택지는 payload로 전달한다.
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

const EVENT_ICON = {
  loan_shark_call: '📞', invest_study: '📚', travel: '✈️',
  condolence: '💌', holiday: '🎑',
};
// 금액 입력이 필요한 선택지 (eventType:choiceKey)
const AMOUNT_CHOICES = new Set(['loan_shark_call:pay']);

export default function EventPopup({ event }) {
  const resolveEvent = useGameStore((s) => s.resolveEvent);
  const dismissEvent = useGameStore((s) => s.dismissEvent);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);

  const detail = event.detail || {};
  const prompt = event.prompt || detail.prompt;
  const choices = event.choices || detail.choices || [];
  const needsAmount = (key) => AMOUNT_CHOICES.has(`${event.eventType || event.event_type}:${key}`);

  const choose = async (key) => {
    setSubmitting(true);
    try {
      const payload = needsAmount(key) ? { amount: Number(amount) || 0 } : undefined;
      setResult(await resolveEvent(event.eventLogId || event.event_log_id, key, payload));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay event-overlay">
      <div className="modal event-popup">
        <h3>{EVENT_ICON[event.eventType || event.event_type] || '⚡'} 이벤트</h3>
        {result ? (
          <>
            {result.detail?.paid !== undefined && <p>{won(result.detail.paid)} 상환했다.</p>}
            {result.detail?.insight && <p>💡 {result.detail.insight}</p>}
            {result.detail?.directionHint && <p>🧭 {result.detail.directionHint.text}</p>}
            {result.detail?.omenHint && <p>🔮 {result.detail.omenHint.text}</p>}
            {!result.detail && <p>처리 완료</p>}
            <button className="btn-primary" onClick={() => dismissEvent(event.eventLogId || event.event_log_id)}>
              확인
            </button>
          </>
        ) : (
          <>
            <p className="event-prompt">{prompt}</p>
            {detail.label && <p className="minigame-help">{detail.label} (스트레스 반영됨)</p>}
            {choices.some((c) => needsAmount(c.key)) && (
              <label className="field">
                상환 금액
                <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            <div className="event-choices">
              {choices.map((c) => (
                <button key={c.key} disabled={submitting} onClick={() => choose(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
