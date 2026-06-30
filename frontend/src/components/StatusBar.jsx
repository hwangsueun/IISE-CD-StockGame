import { won } from '../utils/format.js';

// 섹션 10: 상태바는 game_sessions의 현금/총자산/부채/스트레스/신뢰도와 1:1로 맞춘다.
export default function StatusBar({ state }) {
  if (!state) return null;
  return (
    <div className="status-bar">
      <Cell label="현금" value={won(state.cash)} />
      <Cell label="총자산" value={won(state.totalAsset)} />
      <Cell label="부채" value={won(state.debt)} />
      <Meter label="스트레스" value={state.stress} color="var(--warn)" />
      <Meter label="신뢰도" value={state.trust} color="var(--ok)" />
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="status-cell">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function Meter({ label, value, color }) {
  return (
    <div className="status-cell">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="meter">
        <span style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
