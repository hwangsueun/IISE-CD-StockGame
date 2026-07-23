// 상태바: 신뢰도/스트레스 게이지 + 총자산 + 빚 상환 진행 + DAY — game_sessions와 1:1 (§10)
// 디자인 원본: public/game/Main Screen.html의 .statusbar (Phase D 이식)
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

const GAUGE_CELLS = 20;

function PixelGauge({ kind, value }) {
  const on = Math.round((value / 100) * GAUGE_CELLS);
  return (
    <div className={`px-gauge ${kind}`}>
      {Array.from({ length: GAUGE_CELLS }, (_, i) => (
        <i key={i} className={i < on ? 'cell on' : 'cell'} />
      ))}
    </div>
  );
}

export default function StatusBar() {
  // 셀렉터는 스토어의 원본 참조만 반환 (새 객체 생성 시 무한 리렌더)
  const sessionState = useGameStore((s) => s.state);
  const turnState = useGameStore((s) => s.turn?.state);
  const turnNumber = useGameStore((s) => s.turn?.turnNumber);
  const openModal = useGameStore((s) => s.openModal);
  if (!sessionState && !turnState) return null;
  const state = { ...(sessionState || {}), ...(turnState || {}) }; // turn.state가 최신, debtInitial은 sessionState에만 있음

  const debtInitial = Number(state.debtInitial) || 0;
  const repaid = Math.max(0, debtInitial - Number(state.debt));
  const repaidPct = debtInitial > 0 ? Math.round((repaid / debtInitial) * 100) : 0;
  const man = (v) => Math.round(v / 10000).toLocaleString(); // 만원 단위

  return (
    <header className="px-statusbar">
      <div className="px-stat" data-tip="신뢰도 — 빚 갚을 능력에 대한 사채업자의 신뢰. 낮으면 독촉·불이익이 커지고, 제때 갚으면 오른다.">
        <div className="px-stat-icon trust-ic">♥</div>
        <div className="px-stat-body">
          <div className="px-stat-label"><span className="ko">신뢰도</span><span className="val">{state.trust}/100</span></div>
          <PixelGauge kind="trust" value={state.trust} />
        </div>
      </div>

      <div className="px-stat" data-tip="스트레스 — 높을수록 그날 뉴스를 일부 놓치고, 100이 되면 쓰러져(입원) 며칠간 투자할 수 없다.">
        <div className="px-stat-icon stress-ic">⚡</div>
        <div className="px-stat-body">
          <div className="px-stat-label"><span className="ko">스트레스</span><span className="val">{state.stress}/100</span></div>
          <PixelGauge kind="stress" value={state.stress} />
        </div>
      </div>

      <div className="px-money" data-tip="총자산 = 현금 + 보유 자산 평가액. 게임의 최종 성적이다. 현금이 있어야 매수·상환·생활비를 감당한다.">
        <div className="px-stat-icon gold-ic">₩</div>
        <div className="px-stat-body">
          <div className="px-money-amount">{Number(state.totalAsset).toLocaleString()}</div>
          <div className="px-money-sub">현금 {won(state.cash)}</div>
        </div>
      </div>

      <div className="px-debt" data-tip="사채업자에게 갚은 빚. 20일마다 상환일이 돌아오고, 이 막대를 끝까지 채우는 것이 목표다.">
        <div className="px-stat-icon stress-ic">☠</div>
        <div className="px-stat-body">
          <div className="px-stat-label">
            <span className="ko">빚 상환</span>
            <span className="val">{debtInitial > 0 ? `${man(repaid)} / ${man(debtInitial)}만` : won(state.debt)}</span>
          </div>
          <div className="px-debt-bar"><div className="px-debt-fill" style={{ width: `${repaidPct}%` }} /></div>
        </div>
      </div>

      <div className="px-turn-pill" data-tip="남은 일수 — 총 240일(턴) 안에 빚을 갚고 살아남아야 한다.">
        <span className="lbl">DAY</span>
        <span className="val">{String(turnNumber ?? 0).padStart(3, '0')} / 240</span>
      </div>

      <button
        type="button"
        className="px-guide-btn"
        onClick={() => openModal('guide')}
        aria-label="게임 도움말"
        title="게임 도움말"
      >?</button>
    </header>
  );
}
