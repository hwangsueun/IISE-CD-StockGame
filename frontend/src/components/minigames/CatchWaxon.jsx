// 부업 미니게임 1: 왝슨을 잡아라 (미팅5 §6 / 기능명세서 §부업)
// 디자인 원본(public/game/Minigame_Catch_Waxon.html)을 iframe으로 그대로 실행해 100% 동일하게 유지한다.
// 게임 종료 시 원본이 postMessage로 보낸 원점수(포획 수)를 받아 onFinish로 서버에 제출한다.
import { useEffect, useRef } from 'react';

export default function CatchWaxon({ onFinish }) {
  const submitted = useRef(false);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.source !== 'antsurvival-minigame' || d.game !== 'catch_waxon') return;
      if (submitted.current) return;
      submitted.current = true;
      onFinish(d.rawScore); // 원점수 = 포획 수
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onFinish]);

  return (
    <div className="minigame-board">
      <iframe className="minigame-iframe" title="왝슨을 잡아라" src="/game/Minigame_Catch_Waxon.html" />
    </div>
  );
}
