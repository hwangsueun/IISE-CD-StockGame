// 마켓 모달: 주식/참고지표 사이드바 + 랭킹 리스트 (§10)
// 디자인 원본: public/game/Main Screen.html #mkOverlay 구조 이식.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import { won, signed, changeClass, relativeYearDate } from '../utils/format';

const CATS = [
  { key: 'stock', label: '주식' },
  { key: 'sector', label: '업종별' },
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

// 참고지표별 설명 (각 카드의 ? 버튼으로 토글) — 코드 기준 매핑
const INDICATOR_HELP = {
  kospi: '국내 대형주 중심의 대표 주가지수. 시장 전체가 오르는지 내리는지 보는 기준이다.',
  kosdaq: '중소·기술·성장주 중심 지수. 코스피보다 변동 폭이 크다.',
  kr_policy_rate: '한국은행 기준금리. 오르면 자금 조달 비용이 커져 주식에 부담이 될 수 있다. 내리면 유동성이 늘어날 수 있다.',
  usdkrw: '원/달러 환율. 오르면(원화 약세) 수출주엔 유리하지만 외국인 자금 이탈 신호일 수 있다.',
  cpi: '소비자물가지수. 물가가 급등하면 금리 인상 압력이 커져 시장에 부담이 된다.',
  ktb_3y_rate: '국고채 3년 금리. 기업과 가계가 돈을 빌릴 때 드는 비용을 가늠하는 참고지표다.',
  ktb_10y_rate: '국고채 10년 금리(장기금리). 3년물과의 차이로 경기 방향을 가늠한다.',
  wti_price: '국제 유가(WTI). 오르면 물가·에너지·항공·정유 등 여러 업종에 영향을 준다.',
  gold_price: '금 시세. 시장이 불안할 때 자금이 몰리는 대표 안전자산이다.',
  leading_index: '경기선행지수. 몇 달 뒤 경기 방향을 미리 보여준다 — 오르면 경기 회복 기대.',
};

// 마켓 화면 도움말 (Modal의 ? 버튼으로 토글)
const MARKET_HELP = (
  <>
    <p>투자할 <b>종목을 찾는 화면</b>이다. 종목을 누르면 상세·차트를 보고 <b>사고팔 수 있다.</b></p>
    <ul>
      <li><b>상단 지수</b> — 코스피·코스닥·환율로 그날 시장 분위기를 읽는다.</li>
      <li><b>화면 선택</b> — 왼쪽에서 주식 종목과 시장 참고지표를 확인한다.</li>
      <li><b>정렬</b> — 거래대금·거래량·상승률·하락률로 순위를 바꾼다.</li>
      <li><b>업종별</b> — 코스피·코스닥 업종 지수가 전 개장일보다 얼마나 올랐는지 확인한다.</li>
      <li>가격 옆 등락률은 <b>오르면 빨강, 내리면 파랑</b>이다.</li>
    </ul>
  </>
);

export default function MarketModal() {
  const { turn, openModal, sessionId } = useGameStore();
  const [cat, setCat] = useState('stock');
  const [sort, setSort] = useState('amount');
  const [assets, setAssets] = useState([]);
  const [macro, setMacro] = useState([]);
  const [openRef, setOpenRef] = useState(null); // 참고지표 카드별 설명 토글 (code)
  const [sectorData, setSectorData] = useState(null);
  const [sectorError, setSectorError] = useState('');
  const [sectorMarket, setSectorMarket] = useState('KOSPI');

  useEffect(() => {
    let active = true;
    setSectorData(null); setSectorError('');
    api.getSectors(sessionId, turn.date).then(data => { if (active) setSectorData(data); })
      .catch(() => { if (active) setSectorError('업종별 등락률을 불러오지 못했어요.'); });
    return () => { active = false; };
  }, [sessionId, turn.date]);

  useEffect(() => {
    api.getMacro(turn.date).then(setMacro).catch(console.error);
  }, [turn.date]);

  useEffect(() => {
    if (cat !== 'stock') return;
    let cancelled = false;
    const serverSort = sort === 'up' ? 'change' : sort === 'down' ? 'decline' : sort;
    api.listAssets({ type: cat, sort: serverSort, date: turn.date, sessionId })
      .then((rows) => {
        if (!cancelled) setAssets(rows);
      })
      .catch((error) => {
        if (!cancelled) console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [cat, sort, turn.date, sessionId]);

  const strip = STRIP_CODES.map((code) => macro.find((m) => m.code === code)).filter(Boolean);
  const sectors = sectorData?.sectors.filter(s => s.market === sectorMarket) || [];

  return (
    <Modal title="마켓" wide xwide help={MARKET_HELP}>
      {turn.marketOpen === false && (
        <p className="market-closed-note">오늘은 주식 휴장일입니다. 주문 예약은 다음 개장일에 할 수 있습니다.</p>
      )}
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
          {cat === 'sector' ? (
            <div className="mk-sectors">
              <h3>오늘 어떤 업종이 올랐을까?</h3>
              <p>각 업종의 주가 흐름을 모은 지수예요. 전 개장일 종가보다 얼마나 올랐는지 비교해 보세요.</p>
              <div className="dash-unit-tabs" aria-label="업종 시장">
                {['KOSPI', 'KOSDAQ'].map(m => <button type="button" key={m}
                  className={sectorMarket === m ? 'active' : ''} aria-pressed={sectorMarket === m}
                  onClick={() => setSectorMarket(m)}>{m === 'KOSPI' ? '코스피' : '코스닥'}</button>)}
              </div>
              {sectorData?.asOfDate && <p className="mk-sector-date">
                {sectorData.marketOpen ? '전 개장일 대비' : '최근 개장일 기준'} · {relativeYearDate(sectorData.asOfDate, turn.date)}
                {' · '}상승 {sectors.filter(s => s.changeRate > 0).length}개 업종 · 하락 {sectors.filter(s => s.changeRate < 0).length}개 업종
              </p>}
              {sectorError && <p className="dash-error">{sectorError}</p>}
              {!sectorData && !sectorError && <p>업종별 흐름을 불러오는 중…</p>}
              {sectorData && sectors.length === 0 && <p>이 날짜에 확인할 수 있는 업종 자료가 없어요.</p>}
              <div className="mk-sector-grid">{sectors.map(s => <article key={s.code}
                className={`mk-sector-card ${changeClass(s.changeRate)}`}>
                <span className="mk-sector-title">{s.sector}</span>
                <strong>{signed(s.changeRate)}</strong>
                <span className="mk-sector-breadth">지수 {s.value?.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</span>
                <small>{s.previousDate ? relativeYearDate(s.previousDate, turn.date) : '이전 자료 없음'} → {relativeYearDate(s.date, turn.date)}</small>
              </article>)}</div>
            </div>
          ) : cat === 'ref' ? (
            <>
            <p className="mk-ref-note">
              📈 투자할 때 참고할 수 있는 지표들이다. 개별 종목이 아니라 <b>환율·금리·유가 같은 거시 흐름</b>으로 시장 전체 분위기를 읽는다.
            </p>
            <div className="mk-ref-grid">
              {macro.map((m) => (
                <div className="mk-ref-card" key={m.code}>
                  <div className="h">
                    <span className="nm">{m.name}</span>
                    {INDICATOR_HELP[m.code] && (
                      <button
                        type="button"
                        className={`mk-ref-help-btn ${openRef === m.code ? 'active' : ''}`}
                        onClick={() => setOpenRef((c) => (c === m.code ? null : m.code))}
                        aria-label={`${m.name} 설명`}
                        aria-expanded={openRef === m.code}
                        title="설명"
                      >?</button>
                    )}
                  </div>
                  <div className="b">
                    <span className="val">{m.value?.toLocaleString('ko-KR')}<span className="u">{m.unit}</span></span>
                    <span className={`ch ${changeClass(m.change)}`}>
                      {m.change === null ? '-' : `${m.change >= 0 ? '▲' : '▼'} ${Math.abs(m.change).toFixed(2)}`}
                    </span>
                  </div>
                  {openRef === m.code && INDICATOR_HELP[m.code] && (
                    <p className="mk-ref-desc">{INDICATOR_HELP[m.code]}</p>
                  )}
                </div>
              ))}
            </div>
            </>
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
