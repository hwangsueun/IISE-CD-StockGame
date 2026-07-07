// 최종 결산/엔딩 화면 (§10) — GET /result + /report/final
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { won, pct } from '../utils/format';

export default function ResultPage() {
  const { sessionId, status, resetGame } = useGameStore();
  const [result, setResult] = useState(null);
  const [report, setReport] = useState(null);

  useEffect(() => {
    api.getResult(sessionId).then(setResult).catch(console.error);
    api.getFinalReport(sessionId).then(setReport).catch(console.error);
  }, [sessionId]);

  if (!result) return <div className="loading-screen">결산 중...</div>;

  return (
    <div className="result-page">
      <h1>{status === 'success' ? '🎉 상환 성공!' : '💀 파산...'}</h1>
      <p className="result-sub">
        {status === 'success'
          ? `${result.turnsPlayed}턴 만에 빚을 모두 갚았다.`
          : '빚을 갚지 못한 채 1년이 끝났다.'}
      </p>

      <dl className="result-stats">
        <div><dt>최종 총자산</dt><dd>{won(result.finalTotalAsset)}</dd></div>
        <div><dt>남은 부채</dt><dd>{won(result.debtRemaining)}</dd></div>
        <div><dt>총 거래 횟수</dt><dd>{result.tradeCount}회</dd></div>
        <div><dt>실현손익 합계</dt><dd>{won(result.realizedPnlSum)}</dd></div>
        {report && <div><dt>총 수익률</dt><dd>{pct(report.totalReturn)}</dd></div>}
      </dl>

      {/* TODO(frontend): 월별 자산 추이 차트 (report.monthlyTrend), AI 투자성향 분석 (report.aiAnalysis) */}

      <button className="btn-primary" onClick={resetGame}>다시 하기</button>
    </div>
  );
}
