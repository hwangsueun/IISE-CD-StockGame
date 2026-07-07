// 부업 미니게임 2: 교수님을 피해라 (미팅5 §6 / 기능명세서 §부업)
// 낙하하는 단어(대학원/과제/랩미팅...)를 좌우 이동으로 회피. 원점수 = 생존 시간(초).
// 시간이 지날수록 낙하 속도 증가 (기능명세서: 난이도 조정).
import { useEffect, useRef, useState } from 'react';

const WORDS = ['대학원', '과제', '랩미팅', '논문', '조교', '시험', '발표'];
const FIELD_W = 100; // %
const PLAYER_W = 12;

export default function AvoidProfessor({ onFinish }) {
  const [playerX, setPlayerX] = useState(44);
  const [words, setWords] = useState([]); // {id, x, y, text, speed}
  const [seconds, setSeconds] = useState(0);
  const [dead, setDead] = useState(false);
  const nextId = useRef(0);
  const playerRef = useRef(44);
  playerRef.current = playerX;
  const doneRef = useRef(false);

  // 키 입력 (←/→)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setPlayerX((x) => Math.max(0, x - 5));
      if (e.key === 'ArrowRight') setPlayerX((x) => Math.min(FIELD_W - PLAYER_W, x + 5));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 생존 시간
  useEffect(() => {
    if (dead) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [dead]);

  // 낙하 루프 (틱 80ms)
  useEffect(() => {
    if (dead) return undefined;
    const tick = setInterval(() => {
      setWords((prev) => {
        const difficulty = 1 + seconds / 20; // 시간 경과 -> 속도 증가
        let next = prev.map((w) => ({ ...w, y: w.y + w.speed * difficulty }));

        // 충돌 판정 (바닥 근처에서 플레이어와 겹치면 종료)
        const px = playerRef.current;
        for (const w of next) {
          if (w.y > 82 && w.y < 95 && w.x + 10 > px && w.x < px + PLAYER_W) {
            if (!doneRef.current) {
              doneRef.current = true;
              setDead(true);
              onFinish(seconds); // 원점수 = 생존 시간
            }
            return next;
          }
        }
        next = next.filter((w) => w.y < 100);
        if (Math.random() < 0.08 * difficulty) {
          next = [...next, {
            id: nextId.current++,
            x: Math.random() * (FIELD_W - 12),
            y: -5,
            text: WORDS[Math.floor(Math.random() * WORDS.length)],
            speed: 1.2 + Math.random() * 1.2,
          }];
        }
        return next;
      });
    }, 80);
    return () => clearInterval(tick);
  }, [dead, seconds, onFinish]);

  return (
    <div className="minigame-board">
      <div className="minigame-hud">
        <span>⏱ 생존 {seconds}초</span>
        {dead && <span>💥 잡혔다!</span>}
      </div>
      <div className="minigame-field">
        {words.map((w) => (
          <span key={w.id} className="falling-word" style={{ left: `${w.x}%`, top: `${w.y}%` }}>
            {w.text}
          </span>
        ))}
        <span className="player-char" style={{ left: `${playerX}%` }}>🏃</span>
        {dead && <div className="minigame-over">게임 오버</div>}
      </div>
      <p className="minigame-help">←/→ 방향키로 교수님의 과제 폭탄을 피해라!</p>
    </div>
  );
}
