// 공용 모달 셸 — 모든 게임 모달의 껍데기
import { useGameStore } from '../state/gameStore';

export default function Modal({ title, children, wide }) {
  const closeModal = useGameStore((s) => s.closeModal);
  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={closeModal}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
