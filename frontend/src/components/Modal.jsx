import { useGame } from '../state/gameStore.jsx';

// 공용 모달 래퍼. 오버레이 클릭 또는 ✕ 로 닫힌다.
export default function Modal({ title, children, onClose }) {
  const { closeModal } = useGame();
  const close = onClose ?? closeModal;
  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="close-btn" onClick={close} aria-label="닫기">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
