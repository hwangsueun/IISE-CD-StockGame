// 공용 모달 셸 — 모든 게임 모달의 껍데기
// help prop을 넘기면 헤더에 ? 버튼이 생기고, 누르면 그 화면 설명이 토글로 펼쳐진다.
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';

export default function Modal({ title, children, wide, xwide, help }) {
  const closeModal = useGameStore((s) => s.closeModal);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className={`modal ${wide ? 'modal-wide' : ''} ${xwide ? 'modal-xwide' : ''}`}>
          <header className="modal-header">
            <h2>{title}</h2>
            <div className="modal-header-actions">
              {help && (
                <button
                  type="button"
                  className={`modal-help-btn ${showHelp ? 'active' : ''}`}
                  onClick={() => setShowHelp((v) => !v)}
                  aria-label="도움말"
                  aria-expanded={showHelp}
                  title="도움말"
                >?</button>
              )}
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
          </header>
          <div className="modal-body">{children}</div>
        </div>
        {help && showHelp && (
          <aside className="modal-help-panel">
            <div className="modal-help-panel-title">도움말</div>
            {help}
          </aside>
        )}
      </div>
    </div>
  );
}
