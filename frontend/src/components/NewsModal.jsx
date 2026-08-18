// 뉴스 모달: 현재 게임 턴의 뉴스 목록 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { relativeYearDate } from '../utils/format';
import Modal from './Modal';

// 뉴스 화면 도움말 (Modal의 ? 버튼으로 토글)
const NEWS_HELP = (
  <>
    <p>그날 시장에 나온 <b>뉴스</b>를 읽고 투자 판단에 활용한다.</p>
    <ul>
      <li><b>중요</b> 표시가 붙은 뉴스는 시장에 영향이 큰 소식이다.</li>
      <li><b>스트레스가 높으면 일부 뉴스를 놓친다</b> — 하단에 못 본 뉴스 수가 뜬다. 스트레스 관리가 곧 정보력이다.</li>
    </ul>
  </>
);

export default function NewsModal() {
  const { sessionId, turn } = useGameStore();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getNews(turn.date, sessionId, undefined, turn.date).then(setData).catch(console.error);
  }, [turn.date, sessionId]);

  return (
    <Modal title={`뉴스 — ${relativeYearDate(turn.date, turn.date)}`} wide help={NEWS_HELP}>
      <div className="news-body">
        <ul className="news-list">
          {(data?.news || []).map((n) => (
            <li key={n.newsId}>
              <span className="news-date">{relativeYearDate(n.date || turn.date, turn.date)}</span>
              <span className={`news-dir ${n.direction || ''}`}>{n.headline}</span>
              {n.strength >= 5 && <b className="news-strong">중요</b>}
            </li>
          ))}
          {(data?.news || []).length === 0 && <p className="news-empty">오늘은 뉴스가 없다.</p>}
        </ul>
      </div>
      {data && data.hiddenCount > 0 && (
        <p className="news-hidden">😵 스트레스로 못 본 뉴스 {data.hiddenCount}건</p>
      )}
    </Modal>
  );
}
