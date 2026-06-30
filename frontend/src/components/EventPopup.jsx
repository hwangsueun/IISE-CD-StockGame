import { useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';

// 섹션 9-5/10 이벤트 팝업: 선택형 이벤트(수락/거절) → POST /api/game/:id/event
export default function EventPopup() {
  const { modalContext, resolveEvent, closeModal } = useGame();
  const event = modalContext?.event ?? {
    title: '부업 제안',
    body: '주말 동안 부업을 하면 현금을 벌 수 있지만 스트레스가 늘어납니다. 수락하시겠습니까?',
  };
  const [busy, setBusy] = useState(false);

  async function choose(choice) {
    setBusy(true);
    try {
      await resolveEvent(choice);
      closeModal();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={event.title} onClose={() => choose('decline')}>
      <p style={{ lineHeight: 1.6 }}>{event.body}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="menu-btn" style={{ flex: 1 }} disabled={busy} onClick={() => choose('decline')}>
          거절
        </button>
        <button className="next-turn" style={{ flex: 1 }} disabled={busy} onClick={() => choose('accept')}>
          수락
        </button>
      </div>
    </Modal>
  );
}
