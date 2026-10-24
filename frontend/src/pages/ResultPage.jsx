// 최종 결산/엔딩 화면 (§10) — GET /result + /report/final
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Ending from '../components/Ending';

// [개발용] ?ending=happy | bad 로 게임을 끝내지 않고 엔딩 컷신을 확인한다 (App.jsx)
const DEV_MOCK_BASE = {
  difficulty: 'normal', challenge: { enrolled: true, rounds: [{ outcome: 'win' }, { outcome: 'loss' }, { outcome: 'win' }], totalClaimed: 1_240_000 },
  initialCash: 50_000_000, debtInitial: 100_000_000, tradeCount: 57,
};
const DEV_MOCKS = {
  happy: { kind: 'happy', result: { ...DEV_MOCK_BASE, status: 'success', turnsPlayed: 240, debtRemaining: 0,
    finalCash: 12_300_000, finalTotalAsset: 18_750_000, stress: 42, trust: 88, realizedPnlSum: 31_480_000 }, report: { totalReturn: 0.6295 } },
  bad: { kind: 'bad', result: { ...DEV_MOCK_BASE, status: 'failed', turnsPlayed: 240, debtRemaining: 35_000_000,
    finalCash: 2_100_000, finalTotalAsset: 4_800_000, stress: 81, trust: 30, realizedPnlSum: -18_200_000 }, report: { totalReturn: -0.4120 } },
};

export function DevEndingPreview({ kind }) {
  const mock = DEV_MOCKS[kind];
  if (!mock) return <div className="loading-screen">알 수 없는 엔딩: {kind} (happy · bad)</div>;
  return <Ending kind={mock.kind} result={mock.result} report={mock.report} onRestart={() => window.location.assign('/?reset')} />;
}

export default function ResultPage() {
  const { sessionId, status, resetGame } = useGameStore();
  const [result, setResult] = useState(null);
  const [report, setReport] = useState(null);

  useEffect(() => {
    api.getResult(sessionId).then(setResult).catch(console.error);
    api.getFinalReport(sessionId).then(setReport).catch(console.error);
  }, [sessionId]);

  if (!result) return <div className="loading-screen">결산 중...</div>;

  return <Ending kind={status === 'success' ? 'happy' : 'bad'} result={result} report={report} onRestart={resetGame} />;
}
