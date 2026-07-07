// 부업 미니게임 3: 노원03 승객 테트리스 (미팅5 §6 / 기능명세서 §부업)
// 버스 승객(블록)을 쌓아 줄을 완성하면 제거. 원점수 = 점수(줄 100점 + 낙하 보너스).
// 조작: ←/→ 이동, ↑ 회전, ↓ 소프트드롭, 스페이스 하드드롭
import { useEffect, useRef, useState, useCallback } from 'react';

const COLS = 10;
const ROWS = 14;
const PASSENGERS = ['🧑', '👵', '🧒', '👨‍🦱', '👩‍🦰', '🧔', '👶'];

// 테트로미노 (회전 상태별 좌표)
const SHAPES = {
  I: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]]],
  O: [[[1, 0], [2, 0], [1, 1], [2, 1]]],
  T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
  L: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
  S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]]],
};
const SHAPE_KEYS = Object.keys(SHAPES);

const emptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const randomPiece = () => ({
  shape: SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)],
  rot: 0,
  x: 3,
  y: 0,
  face: PASSENGERS[Math.floor(Math.random() * PASSENGERS.length)],
});

function cellsOf(piece) {
  const rots = SHAPES[piece.shape];
  return rots[piece.rot % rots.length].map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
}
function collides(grid, piece) {
  return cellsOf(piece).some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && grid[y][x]));
}

export default function PassengerTetris({ onFinish }) {
  const [grid, setGrid] = useState(emptyGrid);
  const [piece, setPiece] = useState(randomPiece);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback((finalScore) => {
    if (!doneRef.current) {
      doneRef.current = true;
      setOver(true);
      onFinish(finalScore);
    }
  }, [onFinish]);

  /** 조각 고정 -> 줄 제거 -> 다음 조각 */
  const lockPiece = useCallback((g, p, s) => {
    const next = g.map((row) => [...row]);
    for (const [x, y] of cellsOf(p)) {
      if (y < 0) { finish(s); return; } // 천장 초과 = 만차 종료
      next[y][x] = p.face;
    }
    // 완성 줄 제거 (승객 하차)
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (next[y].every((c) => c)) {
        next.splice(y, 1);
        next.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    const newScore = s + cleared * 100 + 4; // 줄 100점 + 배치 4점
    setScore(newScore);
    setGrid(next);
    const np = randomPiece();
    if (collides(next, np)) finish(newScore);
    else setPiece(np);
  }, [finish]);

  /** 이동/회전/드롭 */
  const move = useCallback((dx, dy, drot = 0) => {
    if (over) return;
    setPiece((p) => {
      const rots = SHAPES[p.shape];
      const cand = { ...p, x: p.x + dx, y: p.y + dy, rot: (p.rot + drot) % rots.length };
      if (!collides(grid, cand)) return cand;
      if (dy > 0) lockPiece(grid, p, score); // 아래로 못 가면 고정
      return p;
    });
  }, [grid, score, over, lockPiece]);

  // 자동 낙하 (600ms)
  useEffect(() => {
    if (over) return undefined;
    const t = setInterval(() => move(0, 1), 600);
    return () => clearInterval(t);
  }, [move, over]);

  // 키 입력
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') move(-1, 0);
      else if (e.key === 'ArrowRight') move(1, 0);
      else if (e.key === 'ArrowDown') move(0, 1);
      else if (e.key === 'ArrowUp') move(0, 0, 1);
      else if (e.key === ' ') { e.preventDefault(); for (let i = 0; i < ROWS; i++) move(0, 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  // 렌더용: 현재 조각을 그리드에 겹침
  const view = grid.map((row) => [...row]);
  if (!over) {
    for (const [x, y] of cellsOf(piece)) {
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) view[y][x] = piece.face;
    }
  }

  return (
    <div className="minigame-board">
      <div className="minigame-hud">
        <span>🚌 노원03</span>
        <span>점수 {score}</span>
      </div>
      <div className="tetris-grid">
        {view.map((row, y) => (
          <div key={y} className="tetris-row">
            {row.map((cell, x) => (
              <span key={x} className={`tetris-cell ${cell ? 'filled' : ''}`}>{cell || ''}</span>
            ))}
          </div>
        ))}
        {over && <div className="minigame-over">만차! 운행 종료</div>}
      </div>
      <p className="minigame-help">←/→ 이동, ↑ 회전, ↓ 내리기, 스페이스 급정거. 줄을 채워 승객을 하차시켜라!</p>
    </div>
  );
}
