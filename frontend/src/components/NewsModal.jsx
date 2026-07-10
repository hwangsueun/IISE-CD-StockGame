// 뉴스 모달: 카테고리 필터 + 기사 상세 (news_lines 전문 출력) (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';

const FILTERS = [
  { key: '', label: '전체' },
  { key: 'market_macro', label: '거시' },
  { key: 'market_sector', label: '업종' },
  { key: 'stock_disclosure', label: '공시' },
  { key: 'annual_earnings', label: '실적' },
  { key: 'split_article', label: '기사' },
];

export default function NewsModal() {
  const { sessionId, turn, openModal } = useGameStore();
  const [category, setCategory] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null); // 기사 상세

  useEffect(() => {
    api.getNews(turn.date, sessionId, category || undefined).then(setData).catch(console.error);
  }, [turn.date, sessionId, category]);

  return (
    <Modal title={`뉴스 — ${turn.date}`} wide>
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={category === f.key ? 'active' : ''}
            onClick={() => { setCategory(f.key); setSelected(null); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="news-body">
        {selected ? (
          <article className="news-article">
            <button className="btn-back" onClick={() => setSelected(null)}>← 목록</button>
            <h3>{selected.headline}</h3>
            {selected.lines.map((line, i) => <p key={i}>{line}</p>)}
            {selected.assetId && (
              <button className="btn-link" onClick={() => openModal('asset', { assetId: selected.assetId })}>
                관련 종목 보기: {selected.assetName} →
              </button>
            )}
          </article>
        ) : (
          <ul className="news-list">
            {(data?.news || []).map((n) => (
              <li key={n.newsId}>
                <button onClick={() => setSelected(n)}>
                  <span className={`news-dir ${n.direction || ''}`}>{n.headline}</span>
                  {n.strength >= 5 && <b className="news-strong">중요</b>}
                </button>
              </li>
            ))}
            {(data?.news || []).length === 0 && <p className="news-empty">오늘은 뉴스가 없다.</p>}
          </ul>
        )}
      </div>
      {data && data.hiddenCount > 0 && (
        <p className="news-hidden">😵 스트레스로 못 본 뉴스 {data.hiddenCount}건</p>
      )}
    </Modal>
  );
}
