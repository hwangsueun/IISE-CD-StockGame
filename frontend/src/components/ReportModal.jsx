// 리포트 모달: 주간 평가 + 월간 리포트 (§10, 기획서 §7)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, pct, changeClass } from '../utils/format';

export default function ReportModal({ monthIndex }) {
  const { sessionId, turn } = useGameStore();
  const [tab, setTab] = useState('monthly');
  const [monthly, setMonthly] = useState(null);
  const [weekly, setWeekly] = useState(null);

  const weekIndex = Math.max(1, Math.floor((turn.turnNumber - 1) / 5)); // 지난주
  const targetMonth = Math.max(1, monthIndex - (turn.isRepaymentTurn ? 0 : 1)); // 완료된 달 우선

  useEffect(() => {
    api.getMonthlyReport(sessionId, targetMonth).then(setMonthly).catch(() => setMonthly(null));
    api.getWeeklyReport(sessionId, weekIndex).then(setWeekly).catch(() => setWeekly(null));
  }, [sessionId, targetMonth, weekIndex]);

  return (
    <Modal title="리포트" wide>
      <div className="filter-bar">
        <button className={tab === 'monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>월간</button>
        <button className={tab === 'weekly' ? 'active' : ''} onClick={() => setTab('weekly')}>주간 평가</button>
      </div>

      {tab === 'monthly' && (
        monthly ? (
          <dl className="info-list">
            <div><dt>대상</dt><dd>{monthly.monthIndex}개월차 ({monthly.fromTurn}~{monthly.toTurn}턴)</dd></div>
            <div><dt>월 수익률</dt>
              <dd className={changeClass(monthly.monthReturn)}>{pct(monthly.monthReturn)}</dd></div>
            <div><dt>거래 횟수</dt><dd>{monthly.tradeCount}회</dd></div>
            <div><dt>실현손익</dt><dd className={changeClass(monthly.realizedPnl)}>{won(monthly.realizedPnl)}</dd></div>
            {monthly.repayment && (
              <div><dt>상환</dt><dd>{won(Number(monthly.repayment.paid_amount))} / {won(Number(monthly.repayment.due_amount))}</dd></div>
            )}
          </dl>
        ) : <p className="news-empty">아직 월간 기록이 없다.</p>
      )}

      {tab === 'weekly' && (
        weekly ? (
          <div>
            <dl className="info-list">
              <div><dt>주차</dt><dd>{weekly.weekIndex}주차</dd></div>
              <div><dt>주간 수익률</dt>
                <dd className={changeClass(weekly.weekReturn)}>{pct(weekly.weekReturn)}</dd></div>
            </dl>
            {/* LLM 평가문 (reportService TODO 연동 후 실문장) */}
            <blockquote className="weekly-comment">{weekly.comment}</blockquote>
          </div>
        ) : <p className="news-empty">아직 주간 기록이 없다.</p>
      )}
    </Modal>
  );
}
