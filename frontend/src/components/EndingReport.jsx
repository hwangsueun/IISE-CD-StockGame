// 엔딩 중간의 최종 리포트 패널 (해피/배드 엔딩 공용)
// 임시 구현: GET /result + /report/final 값을 그대로 보여준다. 최종 리포트 모듈이 완성되면 이 파일을 교체한다.
import { won, pct } from '../utils/format';
import { gameDuration } from '../utils/ending';

export default function EndingReport({ result, report, onNext }) {
  const duration = gameDuration(result.turnsPlayed);
  const rows = [
    ['갚은 빚', won(result.debtInitial - result.debtRemaining)],
    ['남은 빚', won(result.debtRemaining)],
    [result.status === 'success' ? '걸린 기간' : '버틴 기간', result.turnsPlayed < 20 ? duration : `${duration} (${result.turnsPlayed}일)`],
    ['최종 총자산', won(result.finalTotalAsset)],
    ['투자 수익률', report ? (report.totalReturn === null ? '계산 불가' : pct(report.totalReturn)) : '-'],
    ['실현손익 합계', won(result.realizedPnlSum)],
    ['총 거래 횟수', `${result.tradeCount}회`],
    ['마지막 신뢰도 · 스트레스', `${result.trust} · ${result.stress}`],
  ];
  if (result.challenge?.enrolled) {
    const wins = result.challenge.rounds.filter((r) => r.outcome === 'win').length;
    rows.push(['투자 챌린지', `${wins}승 / ${result.challenge.rounds.length}회 · 상금 ${won(result.challenge.totalClaimed)}`]);
  }

  return (
    <div className="ending-report" onClick={(e) => e.stopPropagation()}>
      <div className="er-head">
        <span className="er-en">FINAL REPORT</span>
        <span className="er-ko">최종 리포트</span>
      </div>
      <dl className="er-rows">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <button className="choice-btn gold er-next" onClick={onNext}>
        <span className="text">계속 ▶</span>
      </button>
    </div>
  );
}
