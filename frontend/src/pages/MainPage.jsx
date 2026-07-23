// 메인 게임 화면: 픽셀아트 방(stage) + 상태바 + 오브젝트 버튼 + 다음 턴 (§10)
// 디자인 원본: public/game/Main Screen.html (Phase D 이식 — 레이아웃/에셋/좌표 동일)
import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import StatusBar from '../components/StatusBar';
import EventPopup from '../components/EventPopup';
import MarketModal from '../components/MarketModal';
import AssetDetailModal from '../components/AssetDetailModal';
import TradeModal from '../components/TradeModal';
import PortfolioModal from '../components/PortfolioModal';
import NewsModal from '../components/NewsModal';
import CalendarModal from '../components/CalendarModal';
import RepaymentModal from '../components/RepaymentModal';
import ReportModal from '../components/ReportModal';
import SideJobModal from '../components/SideJobModal';
import { SurgeStockPopup, SurgeResultPopup } from '../components/SurgeStockPopup';
import FaintOverlay from '../components/FaintOverlay';
import GuideModal from '../components/GuideModal';

const MODALS = {
  market: MarketModal,
  asset: AssetDetailModal,
  trade: TradeModal,
  portfolio: PortfolioModal,
  news: NewsModal,
  calendar: CalendarModal,
  repay: RepaymentModal,
  report: ReportModal,
  sidejob: SideJobModal,
  guide: GuideModal,
};

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' -> { md: 'MM / DD', dow: '화요일' } (로컬 타임존 영향 없이) */
function dateParts(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return { md: `${String(m).padStart(2, '0')} / ${String(d).padStart(2, '0')}`, dow: `${dow}요일` };
}

export default function MainPage() {
  const { turn, loading, error, advanceTurn, openModal, activeModal, modalProps, pendingEvents,
    lastTurnResult, dismissFaint } = useGameStore();

  const faintEvent = lastTurnResult?.events?.find((e) => e.eventType === 'faint');

  // 상환일(20턴 주기)엔 버튼 없이 자동으로 상환 컷신을 띄운다 (기획서 §7).
  // 입원(actionLocked) 중이면 띄우지 않는다 — 서버가 다음 턴 진행 시 자동 미상환 처리한다.
  const autoOpenedRepayTurnRef = useRef(null);
  useEffect(() => {
    if (!turn || !turn.isRepaymentTurn || turn.actionLocked) return;
    if (pendingEvents.length > 0 || faintEvent || activeModal) return;
    if (autoOpenedRepayTurnRef.current === turn.turnNumber) return;
    autoOpenedRepayTurnRef.current = turn.turnNumber;
    openModal('repay');
  }, [turn, pendingEvents, faintEvent, activeModal, openModal]);

  if (!turn) return <div className="loading-screen">불러오는 중...</div>;

  const ActiveModal = activeModal ? MODALS[activeModal] : null;
  const { md, dow } = dateParts(turn.date);
  const repayDday = Math.max(0, turn.monthIndex * 20 - turn.turnNumber);

  return (
    <div className="main-page">
      <div className="game-frame">
        <div className="title-plate">★ ANT SURVIVAL ★</div>
        <StatusBar />

        <div className="stage">
          {/* HUD: 날짜판 (우상단) */}
          <div className="hud-clock">
            <div className="row"><span className="k">날짜</span><span className="v">{md}</span></div>
            <div className="row"><span className="k">요일</span><span className="v">{dow}</span></div>
            <div className="row"><span className="k">남은 일수</span><span className="v">{240 - turn.turnNumber}일</span></div>
            <div className="row"><span className="k">상환까지</span><span className="v">{turn.isRepaymentTurn ? '오늘!' : `D-${repayDday}`}</span></div>
          </div>

          {/* 상태 배지 + HUD 액션 (날짜판 아래) */}
          <div className="hud-side">
            {turn.isRepaymentTurn && <span className="px-badge repay">★ 상환일</span>}
            {turn.actionLocked && <span className="px-badge lock">입원 중</span>}
            {turn.sideJobDoneToday && <span className="px-badge lock">부업으로 투자 불가</span>}
            <button className="hud-btn" onClick={() => openModal('report', { monthIndex: turn.monthIndex })}>
              📊 리포트
            </button>
          </div>

          {/* 오브젝트 버튼 (좌표: 디자인 Main Screen.html LAYOUT 그대로) */}
          <button className="pbtn b-calendar" title="캘린더" onClick={() => openModal('calendar')}>
            <img src="/game/assets/btn_calendar.png" alt="캘린더" />
            <span className="lbl">캘린더</span>
          </button>
          <button className="pbtn b-news" title="뉴스" onClick={() => openModal('news')}>
            <img src="/game/assets/btn_news.png" alt="뉴스" />
            <span className="lbl">뉴스</span>
          </button>
          <button className="pbtn b-portfolio" title="포트폴리오" onClick={() => openModal('portfolio')}>
            <img src="/game/assets/btn_portfolio.png" alt="포트폴리오" />
            <span className="lbl">포트폴리오</span>
          </button>
          <button className="pbtn b-market" title="마켓" onClick={() => openModal('market')}>
            <img src="/game/assets/btn_market.png" alt="마켓" />
            <span className="lbl">마켓</span>
          </button>
          <div className="monitor-ring" />
          <button className="pbtn b-game" title="부업" onClick={() => openModal('sidejob')}>
            <img src="/game/assets/btn_game.png" alt="부업" />
            <span className="lbl">부업</span>
          </button>

          {/* 오늘의 핵심 뉴스 패널은 디자인 원본(Main Screen.html)에서 display:none 처리 —
              뉴스는 좌측 '뉴스' 오브젝트 버튼(NewsModal)으로만 접근한다. */}

          {/* NEXT TURN CTA (우하단) */}
          <div className="nextturn-wrap">
            <button
              className="nextturn-btn"
              disabled={loading || pendingEvents.length > 0}
              onClick={advanceTurn}
              title="다음 턴"
            >
              <img src="/game/assets/btn_nextturn.png" alt="" />
              <span className="nt-text">
                <span className="nt-en">NEXT TURN</span>
                <span className="nt-ko">{loading ? '진행 중...' : '다음 날 ▶'}</span>
              </span>
            </button>
            {error && <p className="error-text">{error}</p>}
          </div>

          <div className="crt" />
        </div>
      </div>

      {/* 선택형 이벤트 팝업 (해결 전 턴 진행 불가) */}
      {pendingEvents.length > 0 && <EventPopup key={pendingEvents[0].eventLogId} event={pendingEvents[0]} />}

      {/* 급등주: 정산 결과 -> 신규 등장 순으로 표시 */}
      <SurgeResultPopup />
      {pendingEvents.length === 0 && <SurgeStockPopup />}

      {ActiveModal && <ActiveModal {...modalProps} />}

      {/* 기절(입원): 강제 페널티형 즉시 이벤트 — 확인 전까지 최상단에 표시 */}
      {faintEvent && <FaintOverlay event={faintEvent} onDismiss={dismissFaint} />}
    </div>
  );
}
