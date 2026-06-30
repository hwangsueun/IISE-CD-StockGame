import { useGame } from '../state/gameStore.jsx';
import StatusBar from '../components/StatusBar.jsx';
import MarketModal from '../components/MarketModal.jsx';
import AssetDetailModal from '../components/AssetDetailModal.jsx';
import TradeModal from '../components/TradeModal.jsx';
import PortfolioModal from '../components/PortfolioModal.jsx';
import NewsModal from '../components/NewsModal.jsx';
import CalendarModal from '../components/CalendarModal.jsx';
import EventPopup from '../components/EventPopup.jsx';
import ReportModal from '../components/ReportModal.jsx';

// 섹션 10 메인 화면: 상태바 · 날짜 · 헤드라인 · 메뉴 · 다음 턴
const MENU = [
  { key: 'market', label: '주식 (시장)' },
  { key: 'portfolio', label: '포트폴리오' },
  { key: 'news', label: '뉴스' },
  { key: 'calendar', label: '캘린더' },
];

export default function MainPage() {
  const { turnData, maxTurns, loading, activeModal, openModal, advanceTurn } = useGame();

  if (!turnData) {
    return <div className="loading">턴 데이터를 불러오는 중…</div>;
  }

  const topNews = turnData.news?.[0];
  const isRepayment = turnData.isRepaymentTurn;

  return (
    <>
      <StatusBar state={turnData.state} />

      <div className="main-body">
        <div className="card">
          <div className="dim" style={{ fontSize: 13 }}>
            {turnData.date} · {turnData.turnNumber} / {maxTurns} 턴 (
            {turnData.monthIndex}개월차)
          </div>
          {topNews ? (
            <>
              <div className="headline" style={{ marginTop: 8 }}>
                {topNews.headline}
              </div>
              <div className="headline-sub">
                오늘 열람 가능한 뉴스 {turnData.newsLimit}건 ·{' '}
                <button className="tag" onClick={() => openModal('news')}>
                  전체 보기
                </button>
              </div>
            </>
          ) : (
            <div className="headline" style={{ marginTop: 8 }}>
              오늘은 특별한 뉴스가 없습니다.
            </div>
          )}
        </div>

        {isRepayment && (
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <strong style={{ color: 'var(--warn)' }}>월말 상환일입니다.</strong>
            <button className="tag" style={{ marginLeft: 8 }} onClick={() => openModal('report')}>
              월간 리포트 / 상환
            </button>
          </div>
        )}

        <div className="menu-grid">
          {MENU.map((m) => (
            <button key={m.key} className="menu-btn" onClick={() => openModal(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        <button
          className="next-turn"
          disabled={loading || turnData.actionLocked}
          onClick={advanceTurn}
        >
          {turnData.actionLocked ? '행동 제한 중' : loading ? '진행 중…' : '다음 턴 ▶'}
        </button>
      </div>

      {/* 섹션 10 모달들 */}
      {activeModal === 'market' && <MarketModal />}
      {activeModal === 'detail' && <AssetDetailModal />}
      {activeModal === 'trade' && <TradeModal />}
      {activeModal === 'portfolio' && <PortfolioModal />}
      {activeModal === 'news' && <NewsModal />}
      {activeModal === 'calendar' && <CalendarModal />}
      {activeModal === 'event' && <EventPopup />}
      {activeModal === 'report' && <ReportModal />}
    </>
  );
}
