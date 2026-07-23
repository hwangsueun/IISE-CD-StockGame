// 부업 모달 (기능명세서 §부업): 게임 선택 -> 미니게임 플레이 -> 결과 제출/보상
// 하루 1회 / 입원 중 불가 / 부업한 날은 투자 불가
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import CatchWaxon from './minigames/CatchWaxon';
import AvoidProfessor from './minigames/AvoidProfessor';
import PassengerTetris from './minigames/PassengerTetris';
import { won } from '../utils/format';

const GAMES = {
  catch_waxon: { label: '왝슨을 잡아라', desc: '날아다니는 왝슨을 클릭으로 포획', icon: '🦢', Component: CatchWaxon },
  avoid_professor: { label: '교수님을 피해라', desc: '낙하하는 과제를 방향키로 회피', icon: '🏃', Component: AvoidProfessor },
  passenger_tetris: { label: '노원03 테트리스', desc: '버스 승객 블록을 쌓아 하차', icon: '🚌', Component: PassengerTetris },
};
const GRADE_LABEL = {
  great_success: '대성공', success: '성공', normal: '보통', fail: '실패', great_fail: '대실패',
};

// 부업 화면 도움말 (Modal의 ? 버튼으로 토글)
const SIDEJOB_HELP = (
  <>
    <p>급하게 <b>현금</b>이 필요할 때 <b>부업</b>으로 벌 수 있다. 단, 대가가 따른다.</p>
    <ul>
      <li><b>하루 1회</b>만 할 수 있다.</li>
      <li>미니게임 성적(등급)에 따라 <b>일당</b>과 <b>스트레스</b>가 정해진다 — 잘할수록 돈은 많이, 스트레스는 적게 오른다.</li>
      <li>부업을 한 날은 <b>그날 투자(매매)를 할 수 없다.</b></li>
      <li><b>입원 중</b>에는 부업을 할 수 없다.</li>
    </ul>
  </>
);

export default function SideJobModal() {
  const { sessionId, loadTurn, turn } = useGameStore();
  const [status, setStatus] = useState(null);
  const [playing, setPlaying] = useState(null);   // gameKey
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSideJobStatus(sessionId).then(setStatus).catch(console.error);
  }, [sessionId]);

  /** 미니게임 종료 -> 서버에 원점수 제출 (등급/보상은 서버 판정) */
  const onFinish = async (rawScore) => {
    try {
      const r = await api.playSideJob(sessionId, playing, rawScore);
      setResult(r);
      await loadTurn(turn.turnNumber); // 현금/스트레스/투자잠금 갱신
    } catch (e) {
      setError(e.message);
    } finally {
      setPlaying(null);
    }
  };

  if (result) {
    return (
      <Modal title="부업 결과">
        <h3 className="sidejob-grade">{GRADE_LABEL[result.grade]}!</h3>
        <dl className="info-list">
          <div><dt>점수</dt><dd>{result.rawScore}</dd></div>
          <div><dt>일당</dt><dd>{won(result.cashReward)}</dd></div>
          <div><dt>스트레스</dt><dd>+{result.stressDelta}</dd></div>
        </dl>
        <p className="minigame-help">오늘은 부업으로 지쳐서 투자를 할 수 없다.</p>
      </Modal>
    );
  }

  if (playing) {
    const { label, Component } = GAMES[playing];
    return (
      <Modal title={`부업 — ${label}`} wide>
        <Component onFinish={onFinish} />
      </Modal>
    );
  }

  return (
    <Modal title="부업 (하루 1회)" help={SIDEJOB_HELP}>
      {status && !status.available && (
        <p className="error-text">
          {status.reason === 'already_done' ? '오늘은 이미 부업을 했다.'
            : status.reason === 'hospitalized' ? '입원 중에는 부업을 할 수 없다.'
            : '지금은 부업을 할 수 없다.'}
        </p>
      )}
      <p className="minigame-help">잘할수록 돈은 많이 벌고, 스트레스는 적게 오른다. (기본급 {won(status?.basePay)})</p>
      <div className="sidejob-list">
        {Object.entries(GAMES).map(([key, g]) => (
          <button
            key={key}
            className="sidejob-card"
            disabled={!status?.available}
            onClick={() => setPlaying(key)}
          >
            <span className="sidejob-icon">{g.icon}</span>
            <strong>{g.label}</strong>
            <span>{g.desc}</span>
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
