// 부업 미니게임 1: 왝슨을 잡아라 (미팅5 §6 / 기능명세서 §부업)
// 제한시간 내 날아다니는 왝슨(왜가리)을 클릭해 포획. 원점수 = 포획 수.
import { useEffect, useRef, useState } from 'react';

const GAME_SECONDS = 30;
const MAX_BIRDS = 4;

export default function CatchWaxon({ onFinish }) {
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [caught, setCaught] = useState(0);
  const [birds, setBirds] = useState([]); // {id, x(%), y(%), dx, dy}
  const nextId = useRef(0);
  const done = useRef(false);

  // 타이머
  useEffect(() => {
    const t = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (timeLeft <= 0 && !done.current) {
      done.current = true;
      onFinish(caught); // 원점수 = 포획 수
    }
  }, [timeLeft, caught, onFinish]);

  // 왝슨 스폰 + 이동 (틱 100ms)
  useEffect(() => {
    const tick = setInterval(() => {
      setBirds((prev) => {
        let next = prev
          .map((b) => ({
            ...b,
            x: b.x + b.dx,
            y: b.y + b.dy,
            dx: b.x < 5 || b.x > 90 ? -b.dx : b.dx,
            dy: b.y < 5 || b.y > 80 ? -b.dy : b.dy,
          }));
        if (next.length < MAX_BIRDS && Math.random() < 0.15) {
          next = [...next, {
            id: nextId.current++,
            x: 10 + Math.random() * 75,
            y: 10 + Math.random() * 65,
            dx: (Math.random() - 0.5) * 6,
            dy: (Math.random() - 0.5) * 5,
          }];
        }
        return next;
      });
    }, 100);
    return () => clearInterval(tick);
  }, []);

  const catchBird = (id) => {
    setBirds((prev) => prev.filter((b) => b.id !== id));
    setCaught((c) => c + 1);
  };

  return (
    <div className="minigame-board">
      <div className="minigame-hud">
        <span>⏱ {Math.max(0, timeLeft)}초</span>
        <span>🕊 포획 {caught}마리</span>
      </div>
      <div className="minigame-field">
        {birds.map((b) => (
          <button
            key={b.id}
            className="waxon-bird"
            style={{ left: `${b.x}%`, top: `${b.y}%` }}
            onClick={() => catchBird(b.id)}
          >
            🦢
          </button>
        ))}
        {timeLeft <= 0 && <div className="minigame-over">종료!</div>}
      </div>
      <p className="minigame-help">마우스로 붕어방을 날아다니는 왝슨을 잡아라!</p>
    </div>
  );
}
