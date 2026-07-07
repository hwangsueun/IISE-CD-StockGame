// 메인 게임 화면: 상태바 + 날짜 + 헤드라인 + 메뉴 버튼 + 다음 턴 (§10)
import { useGameStore } from '../state/gameStore';
import StatusBar from '../components/StatusBar';
import NewsPanel from '../components/NewsPanel';
import EventPopup from '../components/EventPopup';
import MarketModal from '../components/MarketModal';
import AssetDetailModal from '../components/AssetDetailModal';
import TradeModal from '../components/TradeModal';
import PortfolioModal from '../components/PortfolioModal';
import NewsModal from '../components/NewsModal';
import CalendarModal from '../components/CalendarModal';
import RepaymentModal from '../components/RepaymentModal';
import ReportModal from '../components/ReportModal';

const MODALS = {
  market: MarketModal,
  asset: AssetDetailModal,
  trade: TradeModal,
  portfolio: PortfolioModal,
  news: NewsModal,
  calendar: CalendarModal,
  repay: RepaymentModal,
  report: ReportModal,
};

export default function MainPage() {
  const { turn, loading, error, advanceTurn, openModal, activeModal, modalProps, pendingEvents } =
    useGameStore();

  if (!turn) return <div className="loading-screen">불러오는 중...</div>;

  const ActiveModal = activeModal ? MODALS[activeModal] : null;
  const headline = turn.news?.[0];

  return (
    <div className="main-page">
      <StatusBar />

      <div className="main-center">
        <div className="date-chip">
          {turn.date} · {turn.turnNumber}/240턴 · {turn.monthIndex}월차
          {turn.isRepaymentTurn && <span className="repay-badge">상환일</span>}
          {turn.actionLocked && <span className="lock-badge">행동제한</span>}
        </div>

        {/* 오늘의 헤드라인 (클릭 -> 뉴스 모달) */}
        {headline && (
          <button className="headline" onClick={() => openModal('news')}>
            📰 {headline.headline}
          </button>
        )}

        <NewsPanel compact />
      </div>

      {/* 메뉴 버튼 (방 화면의 오브젝트 버튼) */}
      <nav className="menu-bar">
        <button onClick={() => openModal('market')}>📈 마켓</button>
        <button onClick={() => openModal('portfolio')}>💼 포트폴리오</button>
        <button onClick={() => openModal('news')}>📰 뉴스</button>
        <button onClick={() => openModal('calendar')}>📅 캘린더</button>
        <button onClick={() => openModal('report', { monthIndex: turn.monthIndex })}>📊 리포트</button>
        {turn.isRepaymentTurn && (
          <button className="btn-repay" onClick={() => openModal('repay')}>💸 상환</button>
        )}
      </nav>

      {/* 다음 턴 */}
      <button className="btn-next-turn" disabled={loading || pendingEvents.length > 0} onClick={advanceTurn}>
        {loading ? '진행 중...' : '다음 날 ▶'}
      </button>
      {error && <p className="error-text">{error}</p>}

      {/* 선택형 이벤트 팝업 (해결 전 턴 진행 불가) */}
      {pendingEvents.length > 0 && <EventPopup event={pendingEvents[0]} />}

      {ActiveModal && <ActiveModal {...modalProps} />}
    </div>
  );
}
