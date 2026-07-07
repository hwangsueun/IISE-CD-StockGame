// 인트로/빚 설정 화면 — 난이도 선택 후 POST /api/game/start (§10)
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';

const DIFFICULTIES = [
  { key: 'easy', label: '쉬움', debt: '빚 5,000만 원' },
  { key: 'normal', label: '보통', debt: '빚 1억 원' },
  { key: 'hard', label: '어려움', debt: '빚 1억 5,000만 원' },
];

export default function IntroPage() {
  const { startGame, loading, error } = useGameStore();
  const [selected, setSelected] = useState('normal');

  return (
    <div className="intro-page">
      <h1 className="intro-title">ANT SURVIVAL</h1>
      <p className="intro-sub">동학개미 서바이벌 — 240거래일 안에 빚을 모두 갚아라</p>

      <div className="difficulty-grid">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.key}
            className={`difficulty-card ${selected === d.key ? 'selected' : ''}`}
            onClick={() => setSelected(d.key)}
          >
            <strong>{d.label}</strong>
            <span>{d.debt}</span>
          </button>
        ))}
      </div>

      <button className="btn-primary" disabled={loading} onClick={() => startGame(selected)}>
        {loading ? '시작 중...' : '게임 시작'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
