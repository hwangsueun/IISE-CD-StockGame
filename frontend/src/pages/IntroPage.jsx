import { useState } from 'react';
import { useGame } from '../state/gameStore.jsx';

// 섹션 1/10: 난이도(부채) 선택 후 세션 시작 → POST /api/game/start
const DIFFICULTIES = [
  { key: 'easy', name: '쉬움', debt: '5,000만 원' },
  { key: 'normal', name: '보통', debt: '1억 원' },
  { key: 'hard', name: '어려움', debt: '1억 5,000만 원' },
];

export default function IntroPage() {
  const { startGame, loading } = useGame();
  const [selected, setSelected] = useState('normal');

  return (
    <div className="intro">
      <h1>동학개미 서바이벌</h1>
      <p>
        240거래일(1년) 동안 자산을 매매하며 부채를 상환하세요. 스트레스와 신뢰도를 관리하지 못하면
        게임은 끝납니다. 초기 자금은 5,000만 원입니다.
      </p>

      <div className="difficulty-grid">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`difficulty-card ${selected === d.key ? 'selected' : ''}`}
            onClick={() => setSelected(d.key)}
          >
            <div className="diff-name">{d.name}</div>
            <div className="diff-debt">부채 {d.debt}</div>
          </button>
        ))}
      </div>

      <button className="next-turn" style={{ minWidth: 220 }} disabled={loading} onClick={() => startGame(selected)}>
        {loading ? '시작하는 중…' : '게임 시작'}
      </button>
    </div>
  );
}
