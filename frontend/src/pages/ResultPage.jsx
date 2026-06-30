import { useGame } from '../state/gameStore.jsx';
import { won } from '../utils/format.js';

// 섹션 1/10: 최종 결산 화면 (GET /api/game/:sessionId/result)
export default function ResultPage() {
  const { result, resetGame } = useGame();
  const success = result?.status === 'success';

  return (
    <div className="intro">
      <h1 style={{ color: success ? 'var(--ok)' : 'var(--up)' }}>
        {success ? '상환 성공!' : '게임 오버'}
      </h1>
      <p>
        {success
          ? '240턴 안에 부채를 모두 갚았습니다. 동학개미 생존에 성공했습니다.'
          : '부채를 다 갚지 못했습니다. 다음엔 더 신중하게 투자해 보세요.'}
      </p>

      {result && (
        <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'left' }}>
          <Row label="진행 턴" value={`${result.turnsPlayed} 턴`} />
          <Row label="최종 현금" value={won(result.finalCash)} />
          <Row label="최종 총자산" value={won(result.finalAsset)} />
          <Row label="남은 부채" value={won(result.debtRemaining)} />
        </div>
      )}

      <button className="next-turn" style={{ minWidth: 220 }} onClick={resetGame}>
        다시 시작
      </button>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="dim">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
