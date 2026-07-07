// 상태바: 현금/총자산/부채/스트레스/신뢰도 — game_sessions와 1:1 (§10 UI-데이터 정합)
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

export default function StatusBar() {
  const state = useGameStore((s) => s.turn?.state || s.state);
  if (!state) return null;

  return (
    <header className="status-bar">
      <div className="status-item"><label>현금</label><span>{won(state.cash)}</span></div>
      <div className="status-item"><label>총자산</label><span>{won(state.totalAsset)}</span></div>
      <div className="status-item debt"><label>부채</label><span>{won(state.debt)}</span></div>
      <div className="status-item">
        <label>스트레스</label>
        <div className="gauge"><div className="gauge-fill stress" style={{ width: `${state.stress}%` }} /></div>
        <span>{state.stress}</span>
      </div>
      <div className="status-item">
        <label>신뢰도</label>
        <div className="gauge"><div className="gauge-fill trust" style={{ width: `${state.trust}%` }} /></div>
        <span>{state.trust}</span>
      </div>
    </header>
  );
}
