// 종목 상세 모달: 차트 / 뉴스 / 종토방 / 타입별 정보 탭 + 매수·매도 진입 (§10)
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import PriceChart from './PriceChart';
import CommunityBoard from './CommunityBoard';
import { won } from '../utils/format';

const RANGES = [
  { key: 30, label: '1개월' },
  { key: 90, label: '3개월' },
  { key: 365, label: '1년' },
];

export default function AssetDetailModal({ assetId }) {
  const { turn, openModal } = useGameStore();
  const [tab, setTab] = useState('chart'); // chart | news | community | info
  const [rangeDays, setRangeDays] = useState(90);
  const [detail, setDetail] = useState(null);
  const [series, setSeries] = useState([]);
  const [news, setNews] = useState([]);

  useEffect(() => {
    api.getAssetDetail(assetId, turn.date).then(setDetail).catch(console.error);
  }, [assetId, turn.date]);

  useEffect(() => {
    if (tab === 'chart') {
      const from = new Date(turn.date);
      from.setDate(from.getDate() - rangeDays);
      api.getPriceSeries(assetId, from.toISOString().slice(0, 10), turn.date)
        .then(setSeries).catch(console.error);
    } else if (tab === 'news') {
      api.getAssetNews(turn.date, assetId).then(setNews).catch(console.error);
    }
  }, [tab, rangeDays, assetId, turn.date]);

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
        <button className="btn-buy" onClick={() => openModal('trade', { assetId, tradeType: 'buy' })}>매수</button>
        <button className="btn-sell" onClick={() => openModal('trade', { assetId, tradeType: 'sell' })}>매도</button>
      </div>

      {tab === 'chart' && (
        <>
          <div className="filter-bar sub">
            {RANGES.map((r) => (
              <button key={r.key} className={rangeDays === r.key ? 'active' : ''} onClick={() => setRangeDays(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          <PriceChart series={series} />
        </>
      )}

      {tab === 'news' && (
        <ul className="news-list">
          {news.length === 0 && <p className="news-empty">관련 뉴스가 없다.</p>}
          {news.map((n) => (
            <li key={n.newsId}>
              <span className="news-date">{n.date}</span>
              <div>{n.lines.map((l, i) => <p key={i}>{l}</p>)}</div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'community' && <CommunityBoard assetId={assetId} date={turn.date} />}

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
