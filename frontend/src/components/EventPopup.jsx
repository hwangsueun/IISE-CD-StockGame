// 이벤트 팝업 — 선택형(choice) 이벤트는 해결 전 턴 진행 불가 (§10)
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';

export default function EventPopup({ event }) {
  const resolveEvent = useGameStore((s) => s.resolveEvent);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const choose = async (key) => {
    setSubmitting(true);
    try {
      setResult(await resolveEvent(event.eventLogId, key));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay event-overlay">
      <div className="modal event-popup">
        <h3>⚡ 이벤트</h3>
        {result ? (
          <p>처리 완료</p>
        ) : (
          <>
            <p className="event-prompt">{event.prompt || event.detail?.prompt}</p>
            <div className="event-choices">
              {(event.choices || event.detail?.choices || []).map((c) => (
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
