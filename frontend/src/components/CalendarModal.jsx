// 캘린더 모달: 과거 노출 뉴스 + 메모 CRUD (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';

export default function CalendarModal() {
  const { sessionId, turn } = useGameStore();
  const [memos, setMemos] = useState([]);
  const [selectedDate, setSelectedDate] = useState(turn.date);
  const [dayNews, setDayNews] = useState([]);
  const [editing, setEditing] = useState('');

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

  return (
    <Modal title="캘린더" wide>
      {/* TODO(frontend): 월 그리드 캘린더 UI로 교체. 지금은 날짜 선택 + 메모/뉴스 목록 */}
      <label className="field">
        날짜
        <input
          type="date"
          value={selectedDate}
          max={turn.date}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </label>

      <h4>이 날 본 뉴스</h4>
      <ul className="news-list">
        {dayNews.length === 0 && <p className="news-empty">기록 없음</p>}
        {dayNews.map((n) => <li key={n.newsId}>{n.headline}</li>)}
      </ul>

      <h4>메모 {isToday ? '(오늘)' : '(지난 날짜는 읽기 전용)'}</h4>
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
        <p>{currentMemo?.content || '메모 없음'}</p>
      )}
    </Modal>
  );
}
