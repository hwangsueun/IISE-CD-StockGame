import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { useGame } from '../state/gameStore.jsx';

// 섹션 8-4/10 캘린더: 당일 메모 CRUD(데모는 조회/작성만). 100자 제한.
export default function CalendarModal() {
  const { api, sessionId, turnData } = useGame();
  const date = turnData?.date;
  const [memo, setMemo] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getMemo(sessionId, date).then((list) => {
      if (alive && list?.[0]) setMemo(list[0].content ?? '');
    });
    return () => {
      alive = false;
    };
  }, [api, sessionId, date]);

  async function save() {
    await api.createMemo(sessionId, { date, content: memo.slice(0, 100) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Modal title={`캘린더 · ${date}`}>
      <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
        오늘의 메모 (최대 100자)
      </div>
      <textarea
        value={memo}
        maxLength={100}
        onChange={(e) => setMemo(e.target.value)}
        rows={4}
        style={{ width: '100%', padding: 10, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12 }}>{memo.length}/100</span>
        <button className="next-turn" style={{ padding: '10px 20px' }} onClick={save}>
          {saved ? '저장됨' : '메모 저장'}
        </button>
      </div>
    </Modal>
  );
}
