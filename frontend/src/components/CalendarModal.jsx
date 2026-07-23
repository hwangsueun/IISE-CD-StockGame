// 캘린더 모달: 월 그리드 + 과거 노출 뉴스 + 메모 CRUD (§10)
// 디자인 원본: public/game/Main Screen.html의 cal-overlay (월 그리드/요일 헤더/메모 사이드)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

// 캘린더 화면 도움말 (Modal의 ? 버튼으로 토글)
const CALENDAR_HELP = (
  <>
    <p>지난 날짜를 눌러 <b>그날의 뉴스와 메모</b>를 다시 확인할 수 있다. <b>◀ ▶</b>로 달을 옮긴다 (게임 시작월 ~ 오늘).</p>
    <ul>
      <li><b>이전 뉴스</b> — 날짜를 선택하면 그날 <b>실제로 봤던 뉴스</b>가 오른쪽에 뜬다. 놓친 소식이나 투자 판단 근거를 되짚을 때 쓴다.</li>
      <li><b>메모</b> — <b>오늘</b>은 투자 메모를 100자까지 쓰고 저장·삭제할 수 있다. 지난 날짜의 메모는 <b>읽기 전용</b>이다.</li>
      <li>메모를 남긴 날은 달력 칸에 <b>점</b>으로 표시된다.</li>
    </ul>
  </>
);

export default function CalendarModal() {
  const { sessionId, turn } = useGameStore();
  const startDate = useGameStore((s) => (s.state?.startDate ? String(s.state.startDate).slice(0, 10) : null));
  const [memos, setMemos] = useState([]);
  const [selectedDate, setSelectedDate] = useState(turn.date);
  const [dayNews, setDayNews] = useState([]);
  const [editing, setEditing] = useState('');

  // 보이는 달 (게임 시작월 ~ 현재월 사이만 이동 가능)
  const [ty, tm] = turn.date.split('-').map(Number);
  const [view, setView] = useState({ y: ty, m: tm });
  const viewYm = `${view.y}-${pad(view.m)}`;
  const minYm = (startDate || turn.date).slice(0, 7);
  const maxYm = turn.date.slice(0, 7);
  const moveMonth = (delta) => {
    const d = new Date(Date.UTC(view.y, view.m - 1 + delta, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };

  const reloadMemos = () => api.getMemos(sessionId).then(setMemos).catch(console.error);
  useEffect(() => { reloadMemos(); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 선택 날짜에 실제 노출됐던 뉴스 (news_exposure 기준)
    api.getNews(selectedDate, sessionId).then((r) => setDayNews(r.news)).catch(console.error);
    const memo = memos.find((m) => String(m.game_date).slice(0, 10) === selectedDate);
    setEditing(memo?.content || '');
  }, [selectedDate, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentMemo = memos.find((m) => String(m.game_date).slice(0, 10) === selectedDate);
  const isToday = selectedDate === turn.date;
  const memoDates = new Set(memos.map((m) => String(m.game_date).slice(0, 10)));

  const saveMemo = async () => {
    if (currentMemo) await api.updateMemo(sessionId, currentMemo.id, editing);
    else await api.createMemo(sessionId, selectedDate, editing);
    reloadMemos();
  };
  const deleteMemo = async () => {
    if (!currentMemo) return;
    await api.deleteMemo(sessionId, currentMemo.id);
    setEditing('');
    reloadMemos();
  };

  // 월 그리드 셀 (앞쪽 빈 칸 + 1..말일)
  const firstDow = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <Modal title={`★ ${pad(view.m)}월 · 게임 캘린더`} wide help={CALENDAR_HELP}>
      <div className="cal-body">
        <div className="cal-grid-wrap">
          <div className="cal-month-nav">
            <button className="cal-nav" disabled={viewYm <= minYm} onClick={() => moveMonth(-1)}>◀</button>
            <div className="cal-month-name">{view.y} {MONTH_EN[view.m - 1]}</div>
            <button className="cal-nav" disabled={viewYm >= maxYm} onClick={() => moveMonth(1)}>▶</button>
          </div>
          <div className="cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-grid">
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} className="cal-cell empty" />;
              const iso = `${view.y}-${pad(view.m)}-${pad(d)}`;
              const dow = (firstDow + d - 1) % 7;
              const out = (startDate && iso < startDate) || iso > turn.date; // 게임 범위 밖/미래
              const cls = [
                'cal-cell',
                dow === 0 && 'sun', dow === 6 && 'sat',
                out && 'future',
                iso === turn.date && 'today',
                iso === selectedDate && 'selected',
              ].filter(Boolean).join(' ');
              return (
                <button key={iso} className={cls} disabled={out} onClick={() => setSelectedDate(iso)}>
                  <span className="num">{d}</span>
                  <span className="dots">{memoDates.has(iso) && <i className="dot memo" />}</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="cal-memo-side">
          <div>
            <div className="cal-side-head">
              <span className="t">▶ NEWS</span>
              <span className="d">{selectedDate.slice(5).replace('-', '/')}</span>
            </div>
            <ul className="cal-side-news-list">
              {dayNews.length === 0 && <li className="empty">이 날 본 뉴스 기록 없음</li>}
              {dayNews.map((n) => <li key={n.newsId}>{n.headline}</li>)}
            </ul>
          </div>

          <div>
            <div className="cal-side-head">
              <span className="t">★ MEMO</span>
              <span className="d">{isToday ? '오늘' : '읽기 전용'}</span>
            </div>
            {isToday ? (
              <>
                <textarea
                  maxLength={100}
                  value={editing}
                  onChange={(e) => setEditing(e.target.value)}
                  placeholder="오늘의 투자 메모 (100자)"
                />
                <div className="quick-buttons">
                  <button className="btn-primary" onClick={saveMemo}>저장</button>
                  {currentMemo && <button onClick={deleteMemo}>삭제</button>}
                </div>
              </>
            ) : (
              <p className="cal-memo-read">{currentMemo?.content || '메모 없음'}</p>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
