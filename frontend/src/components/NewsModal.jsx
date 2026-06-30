import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';

// 섹션 8-4/10 뉴스: 당일 뉴스 목록. 스트레스 제한(newsLimit) 반영.
const SENT_LABEL = { positive: '호재', negative: '악재', neutral: '중립' };

export default function NewsModal() {
  const { turnData } = useGame();
  const news = turnData?.news ?? [];
  const limit = turnData?.newsLimit ?? news.length;
  const shown = news.slice(0, limit);
  const hidden = news.length - shown.length;

  return (
    <Modal title={`뉴스 · ${turnData?.date}`}>
      {shown.length === 0 && <div className="empty">오늘은 뉴스가 없습니다.</div>}
      {shown.map((n) => (
        <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span className={`tag ${n.sentiment}`}>{SENT_LABEL[n.sentiment] ?? n.type}</span>
          <span style={{ marginLeft: 6 }}>{n.headline}</span>
        </div>
      ))}
      {hidden > 0 && (
        <div className="dim" style={{ marginTop: 12, fontSize: 13 }}>
          스트레스 제한으로 {hidden}건의 뉴스를 더 볼 수 없습니다.
        </div>
      )}
    </Modal>
  );
}
