// 부업 모달 (기능명세서 §부업): 게임 선택 -> 미니게임 플레이 -> 결과 제출/보상
// 하루 1회 / 입원 중 불가 / 부업한 날은 투자 불가
// howtoOnly: 튜토리얼용. 미니게임 시작화면의 '게임방법'만 체험 가능, 실제 플레이는 잠금
//   (openModal('sidejob', { howtoOnly: true }), 또는 첫날 튜토리얼·카테고리 안내 진행 중이면 자동)
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import CatchWaxon from './minigames/CatchWaxon';
import AvoidProfessor from './minigames/AvoidProfessor';
import SortCharacters from './minigames/SortCharacters';
import { normalizeDifficulty, difficultyLabel } from './minigames/MinigameEmbed';
import { won } from '../utils/format';

const GAMES = {
  catch_waxon: { label: '왝슨을 잡아라', desc: '날아다니는 왝슨을 클릭으로 포획', icon: '🦢', Component: CatchWaxon, howto: true },
  avoid_professor: { label: '교수님을 피해라', desc: '낙하하는 과제를 방향키로 회피', icon: '🏃', Component: AvoidProfessor, howto: true },
  sort_characters: { label: '상자에 캐릭터 분류하기', desc: '분류표에서 캐릭터를 찾아 알맞은 상자에 분류', icon: '📦', Component: SortCharacters, howto: true },
};
const GRADE_LABEL = {
  great_success: '대성공', success: '성공', normal: '보통', fail: '실패', great_fail: '대실패',
};

// 부업 화면 도움말 (Modal의 ? 버튼으로 토글)
const SIDEJOB_HELP = (
  <>
    <p>급하게 <b>현금</b>이 필요할 때 <b>부업</b>으로 벌 수 있다. 부업을 하면 스트레스가 오른다.</p>
    <ul>
      <li><b>하루 1회</b>만 할 수 있다.</li>
      <li>직접 플레이 성적(등급)에 따라 <b>일당</b>과 <b>스트레스</b>가 정해진다 — 잘할수록 일당이 늘고 스트레스 증가량은 줄어든다.</li>
      <li>자동 진행은 직접 플레이보다 적은 고정 일당을 받는다.</li>
      <li>부업을 한 날은 <b>직접 주문과 자동 투자를 쉰다.</b> 미체결 주문은 취소된다.</li>
      <li>자동 투자 설정은 유지된다. 다음 날부터 다시 판단할 수 있다.</li>
      <li><b>입원 중</b>에는 부업을 할 수 없다.</li>
    </ul>
  </>
);

export default function SideJobModal({ howtoOnly: howtoOnlyProp = false }) {
  const { sessionId, loadTurn, turn, state } = useGameStore();
  const difficulty = normalizeDifficulty(state?.difficulty);
  const inTutorial = useGameStore((s) => s.tutorialStep !== null || s.firstDayStep !== null);
  const howtoOnly = howtoOnlyProp || inTutorial;
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [playing, setPlaying] = useState(null);
  const [submitting, setSubmitting] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const isCurrent = (sid, requestGeneration) => generation.current === requestGeneration && useGameStore.getState().sessionId === sid;

  async function refreshStatus() {
    const sid = sessionId, requestGeneration = generation.current;
    setChecking(true);
    try {
      const fresh = await api.getSideJobStatus(sid);
      if (isCurrent(sid, requestGeneration)) setStatus(fresh);
      return fresh;
    } catch (e) {
      if (isCurrent(sid, requestGeneration)) {
        setStatus(null);
        setError(`부업 가능 여부를 확인하지 못했습니다. ${e.message}`);
      }
    } finally {
      if (isCurrent(sid, requestGeneration)) setChecking(false);
    }
  }

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setStatus(null); setPlaying(null); setSubmitting(null); setResult(null); setError(null);
    const requestGeneration = generation.current;
    refreshStatus().then(fresh => {
      if (!isCurrent(sessionId, requestGeneration) || !fresh || fresh.available || howtoOnly) return;
      return fresh.reason === 'already_done' ? restoreResult() : refreshTurn();
    });
    return () => { generation.current += 1; };
  }, [sessionId]);

  async function refreshTurn() {
    const sid = sessionId, requestGeneration = generation.current;
    setChecking(true);
    try {
      await loadTurn(useGameStore.getState().turn?.turnNumber ?? turn.turnNumber);
      if (isCurrent(sid, requestGeneration)) setError(null);
    } catch {
      if (isCurrent(sid, requestGeneration)) setError('부업은 완료되었습니다. 계좌 상태를 다시 불러와 주세요.');
    } finally {
      if (isCurrent(sid, requestGeneration)) setChecking(false);
    }
  }

  async function restoreResult(actionTurn = turn.turnNumber) {
    const sid = sessionId, requestGeneration = generation.current;
    setChecking(true);
    try {
      const history = await api.getSideJobHistory(sid);
      if (!isCurrent(sid, requestGeneration)) return;
      const row = history.find(item => Number(item.turn_number) === Number(actionTurn));
      if (!row || !Number.isFinite(Number(row.cash_reward)) || !Number.isFinite(Number(row.stress_delta))) {
        throw new Error('완료된 부업 결과를 찾지 못했습니다.');
      }
      setResult({ gameKey: row.game_key, mode: row.mode, grade: row.grade,
        rawScore: row.raw_score === null ? null : Number(row.raw_score),
        cashReward: Number(row.cash_reward), stressDelta: Number(row.stress_delta) });
      setError(null);
      await refreshTurn();
    } catch (e) {
      if (!isCurrent(sid, requestGeneration)) return;
      await refreshTurn();
      if (isCurrent(sid, requestGeneration)) setError(`부업 결과를 다시 확인해 주세요. ${e.message}`);
    } finally {
      if (isCurrent(sid, requestGeneration)) setChecking(false);
    }
  }

  // Manual scores and auto mode both use the same server-authoritative daily action.
  async function submit(gameKey, rawScore, mode = 'manual') {
    const auto = status?.auto;
    if (howtoOnly || inFlight.current || checking || !status?.available || !GAMES[gameKey] || (mode === 'auto' && !auto)) return;
    inFlight.current = true;
    const sid = sessionId, requestGeneration = generation.current;
    const actionTurn = turn.turnNumber;
    setSubmitting({ gameKey, mode }); setError(null);
    try {
      const response = await api.playSideJob(sid, gameKey, rawScore, mode);
      if (!isCurrent(sid, requestGeneration)) {
        // Closing the modal does not undo a completed same-session payment.
        const current = useGameStore.getState();
        if (current.sessionId === sid) {
          try { await current.loadTurn(current.turn?.turnNumber ?? actionTurn); } catch { /* Reopening retries the confirmed state. */ }
        }
        return;
      }
      setResult(response); setPlaying(null);
      setStatus(previous => ({ ...previous, available: false, reason: 'already_done' }));
      await refreshTurn();
    } catch (e) {
      if (!isCurrent(sid, requestGeneration)) return;
      setError(e.message);
      // A lost response may already have consumed today's action. Confirm status
      // before enabling either mode again; never invent a reward locally.
      setStatus(null); setPlaying(null);
      const fresh = await refreshStatus();
      if (isCurrent(sid, requestGeneration) && fresh && !fresh.available) await restoreResult(actionTurn);
    } finally {
      if (isCurrent(sid, requestGeneration)) {
        inFlight.current = false;
        setSubmitting(null);
      }
    }
  }

  if (result) {
    const automatic = result.mode === 'auto' || result.grade === 'auto';
    return (
      <Modal title="부업 결과" showTutorial={false}>
        <h3 className="sidejob-grade">{automatic ? '자동 진행 완료' : `${GRADE_LABEL[result.grade]}!`}</h3>
        <dl className="info-list">
          {!automatic && <div><dt>점수</dt><dd>{result.rawScore}</dd></div>}
          <div><dt>일당</dt><dd>{won(result.cashReward)}</dd></div>
          <div><dt>스트레스</dt><dd>+{result.stressDelta}</dd></div>
        </dl>
        <p className="minigame-help">오늘은 직접 주문과 자동 투자를 쉽니다. 자동 투자 설정은 유지됩니다.</p>
        {result.cancelledOrderCount > 0 && <p className="minigame-help">미체결 주문 {result.cancelledOrderCount}건을 취소했습니다. 이미 보유한 주식은 유지합니다.</p>}
        <p className="minigame-help">{result.investmentRestriction?.code === 'stress_limit'
          ? '스트레스가 한계에 도달했습니다. 입원 기간이 끝나야 투자를 재개할 수 있습니다.'
          : '다음 날부터 다시 판단할 수 있습니다. 입원하게 되면 입원 기간도 쉬어야 합니다.'}</p>
        {error && <><p className="error-text" role="alert">{error}</p><button type="button" disabled={checking} onClick={refreshTurn}>계좌 상태 다시 불러오기</button></>}
      </Modal>
    );
  }

  if (playing) {
    const { label, Component } = GAMES[playing];
    return (
      <Modal title={`부업 — ${label}`} wide showTutorial={false}>
        <Component onFinish={rawScore => submit(playing, rawScore)} howtoOnly={howtoOnly} difficulty={difficulty} />
        {submitting && <p className="minigame-help" role="status">결과를 확인하고 있습니다…</p>}
      </Modal>
    );
  }

  const manualDisabled = Boolean(submitting) || (!howtoOnly && (checking || !status?.available));
  const auto = status?.auto;
  const autoReady = auto && Number.isFinite(auto.cashReward) && Number.isFinite(auto.stressDelta) &&
    Number.isFinite(auto.manualMinReward) && auto.cashReward >= 0 && auto.stressDelta >= 0 && auto.cashReward < auto.manualMinReward;
  const autoDisabled = howtoOnly || manualDisabled || !autoReady;
  return (
    <Modal title="부업 (하루 1회)" help={SIDEJOB_HELP}>
      {status && !status.available && (
        <p className="error-text">
          {status.reason === 'already_done' ? '오늘은 이미 부업을 했다.'
            : status.reason === 'hospitalized' ? '입원 중에는 부업을 할 수 없다.'
            : status.reason === 'stress_limit' ? '스트레스가 한계에 도달해 부업을 할 수 없다.'
            : '지금은 부업을 할 수 없다.'}
        </p>
      )}
      <p className="minigame-help">부업 난이도: {difficultyLabel(difficulty)} · 게임 시작 시 선택한 난이도를 따릅니다.</p>
      <p className="minigame-help">직접 플레이는 잘할수록 일당이 늘고 스트레스 증가량은 줄어든다. (기본급 {won(status?.basePay)})</p>
      {autoReady && <p className="minigame-help">자동 진행: 일당 {won(auto.cashReward)} · 스트레스 +{auto.stressDelta}. 직접 플레이 최저 일당 {won(auto.manualMinReward)}보다 적습니다.</p>}
      <p className="minigame-help">직접 플레이와 자동 진행을 합쳐 하루 1회입니다. 부업을 마치면 오늘의 직접 주문과 자동 투자를 쉽니다. 미체결 주문은 취소됩니다.</p>
      <div className="sidejob-list" aria-busy={Boolean(submitting)}>
        {Object.entries(GAMES).map(([key, g]) => (
          <article key={key} className="sidejob-card" aria-label={g.label}>
            <span className="sidejob-icon" aria-hidden="true">{g.icon}</span>
            <strong>{g.label}</strong><span>{g.desc}</span>
            <div className="filter-bar" style={{ margin: '8px 0 0' }}>
              <button type="button" className="active" style={{ opacity: manualDisabled ? 0.45 : 1 }} disabled={manualDisabled}
                aria-label={`${g.label} ${howtoOnly ? '게임방법 보기' : '직접 플레이'}`} onClick={() => { if (!inFlight.current && (howtoOnly || (!checking && status?.available))) setPlaying(key); }}>
                {howtoOnly ? '게임방법 보기' : '직접 플레이'}
              </button>
              <button type="button" style={{ opacity: autoDisabled ? 0.45 : 1 }} disabled={autoDisabled}
                aria-label={`${g.label} 자동 진행`} onClick={() => submit(key, undefined, 'auto')}>
                {submitting?.gameKey === key && submitting.mode === 'auto' ? '자동 진행 중…' : '자동 진행'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {checking && <p className="minigame-help" role="status">부업 가능 여부를 확인하고 있습니다…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {status && !status.available && (error || status.reason === 'already_done') && <button type="button" disabled={checking || Boolean(submitting)} onClick={() => restoreResult()}>오늘 부업 결과 다시 확인</button>}
      {!status && !checking && <button type="button" disabled={Boolean(submitting)} onClick={async () => {
        const sid = sessionId, requestGeneration = generation.current;
        setError(null);
        const fresh = await refreshStatus();
        if (isCurrent(sid, requestGeneration) && fresh && !fresh.available) await restoreResult();
      }}>부업 가능 여부 다시 확인</button>}
    </Modal>
  );
}
