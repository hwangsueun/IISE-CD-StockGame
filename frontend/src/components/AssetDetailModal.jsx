// 종목 상세 모달: 차트 / 뉴스 / 종토방 / 타입별 정보 탭 + 매수·매도 진입 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import PriceChart from './PriceChart';
import CommunityBoard from './CommunityBoard';
import { won } from '../utils/format';

// 조회 기간 — 증권사 차트의 기간 버튼과 같은 구성. 'all'은 그 종목 상장일부터
// 현재 턴까지 전 구간이다(assets.listed_from, migration 003).
const RANGES = [
  { key: 30, label: '1개월' },
  { key: 90, label: '3개월' },
  { key: 180, label: '6개월' },
  { key: 365, label: '1년' },
  { key: 1095, label: '3년' },
  { key: 'all', label: '전체' },
];

// 봉 단위 — 증권사 HTS/MTS의 일·주·월봉과 같은 구성. 틱/분봉은 1턴=1거래일이라 원천이 없고,
// 년봉은 240턴(약 1년) 게임에서 봉이 하나뿐이라 뺐다.
// 일봉은 봉 하나에 종가 하나뿐이라 캔들이 성립하지 않아 라인으로 그려진다
// (PriceChart가 OHLC 유무로 자동 판별). 주봉부터 캔들.
const BAR_UNITS = [
  { key: 'day', label: '일' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
];

export default function AssetDetailModal({ assetId }) {
  const { turn, openModal } = useGameStore();
  const [tab, setTab] = useState('chart'); // chart | news | community | info
  const [rangeDays, setRangeDays] = useState(90);
  const [barUnit, setBarUnit] = useState('day');
  const [detail, setDetail] = useState(null);
  const [series, setSeries] = useState([]);
  const [news, setNews] = useState([]);
  // 기술적 지표 토글 (미팅5 §1: 주식·코인 차트에 MA/볼린저/RSI 제공)
  const [showMa, setShowMa] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showRsi, setShowRsi] = useState(false);

  useEffect(() => {
    api.getAssetDetail(assetId, turn.date).then(setDetail).catch(console.error);
  }, [assetId, turn.date]);

  useEffect(() => {
    if (tab === 'chart') {
      // 'all'이면 상장일부터. detail이 아직 안 왔으면 이 effect는 건너뛴다(아래 가드).
      let fromStr;
      if (rangeDays === 'all') {
        fromStr = detail?.listedFrom?.slice(0, 10);
        if (!fromStr) return;
      } else {
        const from = new Date(turn.date);
        from.setDate(from.getDate() - rangeDays);
        fromStr = from.toISOString().slice(0, 10);
      }
      api.getPriceSeries(assetId, fromStr, turn.date, barUnit)
        .then(setSeries).catch(console.error);
    } else if (tab === 'news') {
      api.getAssetNews(turn.date, assetId).then(setNews).catch(console.error);
    }
  }, [tab, rangeDays, barUnit, assetId, turn.date, detail?.listedFrom]);

  if (!detail) return <Modal title="로딩 중..." wide />;

  return (
    <Modal title={`${detail.name} ${detail.price ? '· ' + won(detail.price) : ''}`} wide>
      <div className="filter-bar">
        {['chart', 'news', 'community', 'info'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ chart: '차트', news: '뉴스', community: '종토방', info: '정보' }[t]}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn-buy"
          disabled={turn.marketOpen === false}
          title={turn.marketOpen === false ? '휴장일에는 거래할 수 없습니다' : '매수'}
          onClick={() => openModal('trade', { assetId, tradeType: 'buy' })}
        >매수</button>
        <button
          className="btn-sell"
          disabled={turn.marketOpen === false}
          title={turn.marketOpen === false ? '휴장일에는 거래할 수 없습니다' : '매도'}
          onClick={() => openModal('trade', { assetId, tradeType: 'sell' })}
        >매도</button>
      </div>

      {tab === 'chart' && (
        <>
          <div className="filter-bar sub">
            {RANGES.map((r) => (
              <button key={r.key} className={rangeDays === r.key ? 'active' : ''} onClick={() => setRangeDays(r.key)}>
                {r.label}
              </button>
            ))}
            <span className="divider" />
            {BAR_UNITS.map((u) => (
              <button key={u.key} className={barUnit === u.key ? 'active' : ''} onClick={() => setBarUnit(u.key)}>
                {u.label}
              </button>
            ))}
            {detail.assetType !== 'bond' && (
              <>
                <span className="spacer" />
                <button className={showMa ? 'active' : ''} onClick={() => setShowMa(!showMa)}>MA</button>
                <button className={showBb ? 'active' : ''} onClick={() => setShowBb(!showBb)}>볼린저</button>
                <button className={showRsi ? 'active' : ''} onClick={() => setShowRsi(!showRsi)}>RSI</button>
              </>
            )}
          </div>
          <PriceChart
            series={series}
            overlays={detail.assetType === 'bond' ? {} : {
              ma: showMa ? [5, 10, 60, 120] : null,
              bollinger: showBb,
              rsi: showRsi,
            }}
          />
        </>
      )}

      {tab === 'news' && (
        <div className="news-body">
          <ul className="news-list">
            {news.length === 0 && <p className="news-empty">관련 뉴스가 없다.</p>}
            {news.map((n) => (
              <li key={n.newsId}>
                <span className="news-date">{n.date}</span>
                <div>{n.lines.map((l, i) => <p key={i}>{l}</p>)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'community' && (
        <div className="news-body">
          <CommunityBoard assetId={assetId} date={turn.date} />
        </div>
      )}

      {tab === 'info' && <AssetInfo detail={detail} />}
    </Modal>
  );
}

/** 자산 타입별 정보 탭 (stock: 재무/밸류에이션, bond: 신용/만기, coin: 시총 등) */
function AssetInfo({ detail }) {
  const info = detail.info;
  if (!info) return <p>정보 없음</p>;

  if (detail.assetType === 'stock') {
    return (
      <div className="asset-info">
        <h4>반기 재무제표</h4>
        <table className="data-table">
          <thead><tr><th>연도/반기</th><th>매출액</th><th>영업이익</th><th>순이익</th></tr></thead>
          <tbody>
            {(info.financials || []).map((f) => (
              <tr key={`${f.fiscal_year}-${f.half}`}>
                <td>{f.fiscal_year} H{f.half}</td>
                <td>{won(f.revenue)}</td>
                <td>{won(f.operating_income)}</td>
                <td>{won(f.net_income)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>밸류에이션</h4>
        <table className="data-table">
          <thead><tr><th>연도/반기</th><th>PER</th><th>PBR</th><th>ROE</th><th>EPS</th></tr></thead>
          <tbody>
            {(info.valuation || []).map((v) => (
              <tr key={`${v.fiscal_year}-${v.half}`}>
                <td>{v.fiscal_year} H{v.half}</td>
                <td>{v.per ?? '-'}</td><td>{v.pbr ?? '-'}</td><td>{v.roe ?? '-'}</td><td>{v.eps ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (detail.assetType === 'bond') {
    return (
      <dl className="info-list">
        <div><dt>종류</dt><dd>{info.bond_type}</dd></div>
        <div><dt>신용등급</dt><dd>{info.credit_rating || '-'}</dd></div>
        <div><dt>만기</dt><dd>{info.maturity || '-'}</dd></div>
        <div><dt>오늘 수익률</dt><dd>{info.today?.yield_rate ?? '-'}%</dd></div>
      </dl>
    );
  }
  return (
    <dl className="info-list">
      <div><dt>심볼</dt><dd>{info.symbol}</dd></div>
      <div><dt>시총(USD)</dt><dd>{info.today?.market_cap_usd ? Number(info.today.market_cap_usd).toLocaleString() : '-'}</dd></div>
      <div><dt>거래량(USD)</dt><dd>{info.today?.volume_usd ? Number(info.today.volume_usd).toLocaleString() : '-'}</dd></div>
    </dl>
  );
}
