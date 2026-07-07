// 오늘의 뉴스 목록 (메인 화면 요약 / 뉴스 모달 공용)
// 서버가 스트레스 열람 제한을 적용해 내려준다 (newsLimit, hiddenCount)
import { useGameStore } from '../state/gameStore';

const DIRECTION_ICON = { positive: '🔺', negative: '🔻', neutral: '▪️' };
const CATEGORY_LABEL = {
  market_sector: '업종',
  market_macro: '거시',
  stock_disclosure: '공시',
  annual_earnings: '실적',
  split_article: '기사',
};

export default function NewsPanel({ compact }) {
  const { turn, openModal } = useGameStore();
  if (!turn) return null;
  const news = compact ? turn.news.slice(0, 3) : turn.news;

  return (
    <div className={`news-panel ${compact ? 'compact' : ''}`}>
      {news.length === 0 && (
        <p className="news-empty">
          {turn.newsLimit === 0 ? '스트레스가 심해 눈이 침침하다... 뉴스를 읽을 수 없다.' : '오늘은 뉴스가 없다.'}
        </p>
      )}
      <ul>
        {news.map((n) => (
          <li key={n.newsId} className="news-item">
            <span className="news-tag">{CATEGORY_LABEL[n.category] || n.category}</span>
            <span className={`news-dir ${n.direction || ''}`}>{DIRECTION_ICON[n.direction] || ''}</span>
            <button
              className="news-headline"
              onClick={() =>
                n.assetId
                  ? openModal('asset', { assetId: n.assetId })
                  : openModal('news')
              }
              title={n.lines?.join('\n')}
            >
              {n.headline}
              {n.assetName && <em className="news-asset"> · {n.assetName}</em>}
            </button>
          </li>
        ))}
      </ul>
      {!compact && turn.news.length < turn.totalCount && (
        <p className="news-hidden">스트레스로 못 본 뉴스 {turn.totalCount - turn.news.length}건</p>
      )}
    </div>
  );
}
