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

// 참고지표별 설명 (각 카드의 ? 버튼으로 토글) — 코드 기준 매핑
const INDICATOR_HELP = {
  kospi: '국내 대형주 중심의 대표 주가지수. 시장 전체가 오르는지 내리는지 보는 기준이다.',
  kosdaq: '중소·기술·성장주 중심 지수. 코스피보다 변동 폭이 크다.',
  kr_policy_rate: '한국은행 기준금리. 오르면 자금 조달 비용이 커져 주식엔 부담, 내리면 유동성이 풀린다.',
  usdkrw: '원/달러 환율. 오르면(원화 약세) 수출주엔 유리하지만 외국인 자금 이탈 신호일 수 있다.',
  cpi: '소비자물가지수. 물가가 급등하면 금리 인상 압력이 커져 시장에 부담이 된다.',
  ktb_3y_rate: '국고채 3년 금리(단기 시중금리의 기준). 금리가 오르면 채권 가격은 내린다.',
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
      <li><b>자산군</b> — 왼쪽에서 주식·채권·코인·참고지표를 전환한다. (코인은 세션마다 종목이 다르다)</li>
      <li><b>정렬</b> — 거래대금·거래량·상승률·하락률로 순위를 바꾼다.</li>
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

  useEffect(() => {
    api.getMacro(turn.date).then(setMacro).catch(console.error);
  }, [turn.date]);

  useEffect(() => {
    if (cat === 'ref') return;
    // 서버는 등락률 DESC 정렬만 지원 — 상승률은 그대로, 하락률은 같은 결과를 뒤집어 재사용
    const serverSort = sort === 'up' || sort === 'down' ? 'change' : sort;
    // sessionId를 넘겨야 코인 탭이 이 세션의 층화추출 20종을 받는다 (migration 005)
    api.listAssets({ type: cat, sort: serverSort, date: turn.date, sessionId })
      .then((rows) => setAssets(sort === 'down' ? [...rows].reverse() : rows))
      .catch(console.error);
  }, [cat, sort, turn.date, sessionId]);

  const strip = STRIP_CODES.map((code) => macro.find((m) => m.code === code)).filter(Boolean);

  return (
    <Modal title="마켓" wide xwide help={MARKET_HELP}>
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
