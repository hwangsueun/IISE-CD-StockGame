import { useGameStore } from '../state/gameStore';

/** 진행 중이거나 불러오기에 실패한 게임에서도 새 게임으로 돌아갈 수 있다. */
export default function ResetGameButton() {
  const resetGame = useGameStore((s) => s.resetGame);

  function handleReset() {
    if (window.confirm('처음 화면으로 돌아가 새 게임을 시작할까요?\n새 게임에는 현재 자산과 진행 기록이 이어지지 않습니다.')) {
      resetGame();
    }
  }

  return (
    <button type="button" onClick={handleReset} title="게임 리셋" aria-label="게임 리셋">
      ↺ 리셋
    </button>
  );
}
