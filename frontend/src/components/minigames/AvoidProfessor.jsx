// 부업 미니게임 2: 교수님을 피해라 (미팅5 §6 / 기능명세서 §부업)
// 디자인 원본(public/game/Minigame_Professor_Proposal_v2.html)을 iframe으로 그대로 실행해 100% 동일하게 유지한다.
// 게임 종료 시 원본이 postMessage로 보낸 원점수(버틴 시간 초)를 받아 onFinish로 서버에 제출한다.
import { useEffect, useRef } from 'react';

export default function AvoidProfessor({ onFinish }) {
  const submitted = useRef(false);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.source !== 'antsurvival-minigame' || d.game !== 'avoid_professor') return;
      if (submitted.current) return;
      submitted.current = true;
      onFinish(d.rawScore); // 원점수 = 버틴 시간(초)
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onFinish]);

  return (
    <div className="minigame-board">
      <iframe className="minigame-iframe" title="교수님을 피해라" src="/game/Minigame_Professor_Proposal_v2.html" />
    </div>
  );
}
