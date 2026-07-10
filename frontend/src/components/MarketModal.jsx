// 마켓 모달: 좌측 자산군(주식/채권/코인/참고지표) 사이드바 + 랭킹 리스트 (§10)
// 디자인 원본: public/game/Main Screen.html #mkOverlay 구조 이식.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, signed, changeClass } from '../utils/format';

const CATS = [
  { key: 'stock', label: '주식' },
  { key: 'bond', label: '채권' },
  { key: 'coin', label: '코인' },
  { key: 'ref', label: '참고지표' },
];
const SORTS = [
  { key: 'amount', label: '거래대금' },
  { key: 'volume', label: '거래량' },
  { key: 'up', label: '상승률' },
  { key: 'down', label: '하락률' },
];
// 마켓 최상단 지수 스트립 — 참고지표(macro) 중 상시 노출할 코드
const STRIP_CODES = ['kospi', 'kosdaq', 'usdkrw'];

export default function MarketModal() {
  const { turn, openModal } = useGameStore();
  const [cat, setCat] = useState('stock');
  const [sort, setSort] = useState('amount');
  const [assets, setAssets] = useState([]);
  const [macro, setMacro] = useState([]);

  useEffect(() => {
    api.getMacro(turn.date).then(setMacro).catch(console.error);
  }, [turn.date]);

  useEffect(() => {
    if (cat === 'ref') return;
    // 서버는 등락률 DESC 정렬만 지원 — 상승률은 그대로, 하락률은 같은 결과를 뒤집어 재사용
    const serverSort = sort === 'up' || sort === 'down' ? 'change' : sort;
    api.listAssets({ type: cat, sort: serverSort, date: turn.date })
      .then((rows) => setAssets(sort === 'down' ? [...rows].reverse() : rows))
      .catch(console.error);
  }, [cat, sort, turn.date]);

  const strip = STRIP_CODES.map((code) => macro.find((m) => m.code === code)).filter(Boolean);

  return (
    <Modal title="마켓" wide xwide>
      {strip.length > 0 && (
        <div className="mk-strip">
          {strip.map((m) => (
            <div className="mk-idx" key={m.code}>
              <span className="lbl">{m.name}</span>
              <span className={`val ${changeClass(m.change)}`}>{m.value?.toLocaleString('ko-KR')}</span>
              {m.change !== null && (
                <span className={`dlt ${changeClass(m.change)}`}>
                  {m.change >= 0 ? '▲' : '▼'} {Math.abs(m.change).toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mk-body">
        <aside className="mk-side">
          {CATS.map((c) => (
            <button key={c.key} className={`mk-tab ${cat === c.key ? 'active' : ''}`} onClick={() => setCat(c.key)}>
              <span>{c.label}</span>
            </button>
          ))}
        </aside>

        <div className="mk-main">
          {cat === 'ref' ? (
            <div className="mk-ref-grid">
              {macro.map((m) => (
                <div className="mk-ref-card" key={m.code}>
                  <div className="h"><span className="nm">{m.name}</span></div>
                  <div className="b">
                    <span className="val">{m.value?.toLocaleString('ko-KR')}<span className="u">{m.unit}</span></span>
                    <span className={`ch ${changeClass(m.change)}`}>
                      {m.change === null ? '-' : `${m.change >= 0 ? '▲' : '▼'} ${Math.abs(m.change).toFixed(2)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="mk-rank-tabs">
                {SORTS.map((s) => (
                  <button key={s.key} className={sort === s.key ? 'active' : ''} onClick={() => setSort(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="mk-list">
                {assets.map((a, i) => (
                  <div className="mk-row" key={a.assetId} onClick={() => openModal('asset', { assetId: a.assetId })}>
                    <span className={`rnk ${i < 3 ? 'top' : ''}`}>{i + 1}</span>
                    <span className="nm">{a.name}<small>{a.sector || '-'}</small></span>
                    <span className="px">{won(a.price)}</span>
                    <span className={`ch ${changeClass(a.changeRate)}`}>{signed(a.changeRate)}</span>
                    <span className="vol">{a.volume ? Math.round(a.volume).toLocaleString('ko-KR') : '-'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
