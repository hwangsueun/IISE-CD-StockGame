// 종목 상세 모달: 차트 / 뉴스 / 종토방 / 타입별 정보 탭 + 매수·매도 진입 (§10)
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import Modal from './Modal';
import PriceChart from './PriceChart';
import CommunityBoard from './CommunityBoard';
import { relativeDateValue, relativeYearDate, relativeYearLabel, won } from '../utils/format';

// 봉 단위 — 증권사 HTS/MTS의 일·주·월봉과 같은 구성. 틱/분봉은 1턴=1거래일이라 원천이 없고,
// 년봉은 240턴(약 1년) 게임에서 봉이 하나뿐이라 뺐다.
// 일봉은 봉 하나에 종가 하나뿐이라 캔들이 성립하지 않아 라인으로 그려진다
// (PriceChart가 OHLC 유무로 자동 판별). 주봉부터 캔들.
const BAR_UNITS = [
  { key: 'day', label: '일' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
];

const DEFAULT_VISIBLE_POINTS = 60;
const MIN_VISIBLE_POINTS = 2;
const MA_DEFAULTS = [5, 20];
const MA_PRESETS = [5, 10, 20, 60, 120];
const MA_MIN = 2;
const MA_MAX = 240;
const MA_MAX_COUNT = 8;
// 실제 API는 listedFrom을 주지만 mock은 주지 않는다. 충분히 이른 날짜를 보내면 두 구현 모두
// 동일하게 "현재 턴까지 존재하는 전체 이력"을 반환한다.
const FULL_HISTORY_FALLBACK_FROM = '1900-01-01';

const INDICATOR_HELP = (
  <>
    <p><b>차트 지표</b>는 가격 흐름을 읽는 참고 도구다. 하나의 신호만으로 방향을 단정할 수는 없다.</p>
    <ul>
      <li>
        <b>이동평균선(MA)</b> — 일정 기간의 가격 평균을 이어 흐름을 부드럽게 보여준다.
        짧은 기간선은 최근 변화에 민감하고, 긴 기간선은 큰 흐름을 살피는 데 유용하다.
      </li>
      <li>
        <b>볼린저 밴드</b> — 이동평균선을 중심으로 최근 변동 폭을 위아래 밴드로 표시한다.
        폭이 넓을수록 변동이 크고, 좁을수록 비교적 잔잔한 흐름이다.
      </li>
      <li>
        <b>상대강도지수(RSI)</b> — 최근 상승과 하락의 힘을 0~100으로 나타낸다.
        보통 70 이상은 과열, 30 이하는 위축을 살피는 구간이지만 반전을 보장하지 않는다.
      </li>
    </ul>
    <p>일·주·월봉을 바꾸면 각 지표도 선택한 봉 단위로 다시 표시된다.</p>
  </>
);

function normalizePriceSeries(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const price = Number(row?.price ?? row?.close ?? row?.value);
    if (!Number.isFinite(price)) return [];
    const normalized = { ...row, price };
    for (const key of ['open', 'high', 'low', 'close']) {
      if (row[key] != null) normalized[key] = Number(row[key]);
    }
    return [normalized];
  });
}

export default function AssetDetailModal({ assetId }) {
  const { turn, openModal } = useGameStore();
  const [tab, setTab] = useState('chart'); // chart | news | community | info
  const [barUnit, setBarUnit] = useState('day');
  const [detail, setDetail] = useState(null);
  const [fullSeries, setFullSeries] = useState([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');
  const [chartReloadKey, setChartReloadKey] = useState(0);
  const [news, setNews] = useState([]);
  const priceCacheRef = useRef(new Map());
  const chartWheelRegionRef = useRef(null);
  const wheelDeltaRef = useRef(0);
  // 기술적 지표 토글 (미팅5 §1: 주식·코인 차트에 MA/볼린저/RSI 제공)
  const [showMa, setShowMa] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [maPeriods, setMaPeriods] = useState(MA_DEFAULTS);
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [customMa, setCustomMa] = useState('');
  const [maError, setMaError] = useState('');

  useEffect(() => {
    let active = true;
    setDetail(null);
    api.getAssetDetail(assetId, turn.date)
      .then((nextDetail) => { if (active) setDetail(nextDetail); })
      .catch((error) => { if (active) console.error(error); });
    return () => { active = false; };
  }, [assetId, turn.date]);

  useEffect(() => {
    if (!detail || String(detail.assetId) !== String(assetId)) return undefined;

    let active = true;
    const from = detail.listedFrom?.slice(0, 10) || FULL_HISTORY_FALLBACK_FROM;
    const cacheKey = `${assetId}:${turn.date}:${barUnit}:${from}`;
    const applyRows = (rows) => {
      if (!active) return;
      setFullSeries(rows);
      setVisibleCount(Math.min(DEFAULT_VISIBLE_POINTS, rows.length));
      setChartLoading(false);
      setChartError('');
    };
    setChartLoading(true);
    setChartError('');
    setFullSeries([]);
    const cached = priceCacheRef.current.get(cacheKey);
    const request = cached || api.getPriceSeries(assetId, from, turn.date, barUnit)
      .then(normalizePriceSeries);
    // 진행 중 Promise도 캐시해 개발 StrictMode 재실행과 빠른 봉 전환의 중복 요청을 합친다.
    if (!cached) priceCacheRef.current.set(cacheKey, request);
    Promise.resolve(request)
      .then((rows) => {
        if (priceCacheRef.current.get(cacheKey) === request) {
          priceCacheRef.current.set(cacheKey, rows);
        }
        applyRows(rows);
      })
      .catch((error) => {
        if (priceCacheRef.current.get(cacheKey) === request) {
          priceCacheRef.current.delete(cacheKey);
        }
        if (!active) return;
        console.error(error);
        setChartLoading(false);
        setChartError('전체 가격 이력을 불러오지 못했습니다.');
      });
    return () => { active = false; };
  }, [assetId, barUnit, chartReloadKey, detail, turn.date]);

  useEffect(() => {
    if (tab !== 'news') return undefined;
    let active = true;
    setNews([]);
    api.getAssetNews(turn.date, assetId)
      .then((rows) => { if (active) setNews(rows); })
      .catch((error) => { if (active) console.error(error); });
    return () => { active = false; };
  }, [assetId, tab, turn.date]);

  const minVisibleCount = fullSeries.length > 0
    ? Math.min(MIN_VISIBLE_POINTS, fullSeries.length)
    : 0;
  const safeVisibleCount = fullSeries.length > 0
    ? Math.min(fullSeries.length, Math.max(minVisibleCount, visibleCount || minVisibleCount))
    : 0;
  const visibleStart = Math.max(0, fullSeries.length - safeVisibleCount);
  const visibleSeries = useMemo(
    () => fullSeries.slice(visibleStart),
    [fullSeries, visibleStart],
  );
  const barUnitLabel = BAR_UNITS.find((unit) => unit.key === barUnit)?.label || '일';
  const visibleRangeLabel = visibleSeries.length > 0
    ? `${safeVisibleCount}개 ${barUnitLabel}봉${safeVisibleCount === fullSeries.length ? ' · 전체' : ''} · ${relativeYearDate(visibleSeries[0].date, turn.date)} ~ ${relativeYearDate(visibleSeries[visibleSeries.length - 1].date, turn.date)}`
    : '표시할 가격 이력 없음';

  const toggleMaPeriod = (period) => {
    const exists = maPeriods.includes(period);
    if (!exists && maPeriods.length >= MA_MAX_COUNT) {
      setMaError(`이동평균선은 최대 ${MA_MAX_COUNT}개까지 표시할 수 있습니다.`);
      return;
    }
    const next = exists
      ? maPeriods.filter((item) => item !== period)
      : [...maPeriods, period].sort((a, b) => a - b);
    setMaPeriods(next);
    setShowMa(next.length > 0);
    setMaError('');
  };

  const addCustomMa = (event) => {
    event.preventDefault();
    const period = Number(customMa);
    if (!Number.isInteger(period) || period < MA_MIN || period > MA_MAX) {
      setMaError(`${MA_MIN}~${MA_MAX} 사이의 정수를 입력해 주세요.`);
      return;
    }
    if (!maPeriods.includes(period) && maPeriods.length >= MA_MAX_COUNT) {
      setMaError(`이동평균선은 최대 ${MA_MAX_COUNT}개까지 표시할 수 있습니다.`);
      return;
    }
    setMaPeriods((current) => [...new Set([...current, period])].sort((a, b) => a - b));
    setShowMa(true);
    setCustomMa('');
    setMaError('');
  };

  const resetIndicators = () => {
    setMaPeriods(MA_DEFAULTS);
    setShowMa(true);
    setShowBb(false);
    setShowRsi(false);
    setCustomMa('');
    setMaError('');
  };

  const changeZoom = (direction, steps = 1) => {
    if (fullSeries.length <= minVisibleCount) return;
    setVisibleCount((current) => {
      const safeCurrent = Math.min(
        fullSeries.length,
        Math.max(minVisibleCount, current || minVisibleCount),
      );
      const factor = 1.18 ** Math.max(1, steps);
      const next = direction > 0
        ? Math.ceil(safeCurrent * factor)
        : Math.floor(safeCurrent / factor);
      return Math.min(fullSeries.length, Math.max(minVisibleCount, next));
    });
  };

  const handleChartWheel = (event) => {
    if (fullSeries.length <= minVisibleCount || chartLoading) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });

    const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    wheelDeltaRef.current += event.deltaY * modeScale;
    const threshold = 24;
    if (Math.abs(wheelDeltaRef.current) < threshold) return;

    const direction = Math.sign(wheelDeltaRef.current); // 아래(+)=축소, 위(-)=확대
    const steps = Math.min(4, Math.max(1, Math.floor(Math.abs(wheelDeltaRef.current) / threshold)));
    wheelDeltaRef.current = 0;
    changeZoom(direction, steps);
  };

  const handleChartKeyDown = (event) => {
    if (['ArrowUp', 'ArrowLeft', '+', '='].includes(event.key)) {
      event.preventDefault();
      changeZoom(-1);
    } else if (['ArrowDown', 'ArrowRight', '-', '_'].includes(event.key)) {
      event.preventDefault();
      changeZoom(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setVisibleCount(minVisibleCount);
    } else if (event.key === 'End') {
      event.preventDefault();
      setVisibleCount(fullSeries.length);
    }
  };

  // React의 wheel 위임 리스너는 passive로 등록될 수 있으므로, 차트 확대·축소 중 모달까지
  // 같이 스크롤되지 않도록 이 영역만 명시적인 non-passive 네이티브 리스너를 사용한다.
  useEffect(() => {
    const node = chartWheelRegionRef.current;
    if (!node) return undefined;
    node.addEventListener('wheel', handleChartWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleChartWheel);
  });

  if (!detail) return <Modal title="로딩 중..." wide />;

  return (
    <Modal
      title={`${detail.name} ${detail.price ? '· ' + won(detail.price) : ''}`}
      wide
      help={tab === 'chart' && detail.assetType !== 'bond' ? INDICATOR_HELP : null}
    >
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
            {BAR_UNITS.map((u) => (
              <button
                key={u.key}
                type="button"
                className={barUnit === u.key ? 'active' : ''}
                aria-pressed={barUnit === u.key}
                onClick={() => setBarUnit(u.key)}
              >
                {u.label}
              </button>
            ))}
            {detail.assetType !== 'bond' && (
              <>
                <span className="spacer" />
                <button type="button" title="이동평균선(MA)" className={showMa ? 'active' : ''} aria-pressed={showMa} disabled={maPeriods.length === 0} onClick={() => setShowMa(!showMa)}>MA</button>
                <button type="button" title="볼린저 밴드" className={showBb ? 'active' : ''} aria-pressed={showBb} onClick={() => setShowBb(!showBb)}>볼린저</button>
                <button type="button" title="상대강도지수(RSI)" className={showRsi ? 'active' : ''} aria-pressed={showRsi} onClick={() => setShowRsi(!showRsi)}>RSI</button>
                <button
                  type="button"
                  className={showIndicatorSettings ? 'active' : ''}
                  aria-expanded={showIndicatorSettings}
                  aria-controls="indicator-settings"
                  onClick={() => setShowIndicatorSettings(!showIndicatorSettings)}
                >상세 설정</button>
              </>
            )}
          </div>
          {detail.assetType !== 'bond' && showIndicatorSettings && (
            <section id="indicator-settings" className="indicator-settings" aria-label="차트 지표 상세 설정">
              <div className="indicator-settings-head">
                <b>이동평균선</b>
                <button type="button" onClick={resetIndicators}>지표 초기화</button>
              </div>
              <div className="indicator-presets" aria-label="이동평균선 프리셋">
                {MA_PRESETS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={maPeriods.includes(period) ? 'active' : ''}
                    aria-pressed={maPeriods.includes(period)}
                    onClick={() => toggleMaPeriod(period)}
                  >MA {period}{barUnitLabel}봉</button>
                ))}
              </div>
              <form className="ma-custom-form" onSubmit={addCustomMa}>
                <label htmlFor="custom-ma-period">사용자 MA</label>
                <input
                  id="custom-ma-period"
                  type="number"
                  min={MA_MIN}
                  max={MA_MAX}
                  step="1"
                  inputMode="numeric"
                  value={customMa}
                  onChange={(event) => setCustomMa(event.target.value)}
                  placeholder={`${MA_MIN}~${MA_MAX}`}
                />
                <span>{barUnitLabel}봉</span>
                <button type="submit">추가</button>
              </form>
              {maError && <p className="error-text" role="alert">{maError}</p>}
              <div className="ma-chip-list" aria-label="선택된 이동평균선">
                {maPeriods.length === 0 && <span>선택된 이동평균선 없음</span>}
                {maPeriods.map((period) => (
                  <button key={period} type="button" onClick={() => toggleMaPeriod(period)} aria-label={`MA ${period}${barUnitLabel}봉 제거`}>
                    MA {period}{barUnitLabel}봉 ×
                  </button>
                ))}
              </div>
            </section>
          )}
          {chartLoading ? (
            <div className="chart-empty" role="status">전체 가격 이력을 불러오는 중...</div>
          ) : chartError ? (
            <div className="chart-empty chart-load-error" role="alert">
              <p>{chartError}</p>
              <button type="button" onClick={() => setChartReloadKey((key) => key + 1)}>다시 시도</button>
            </div>
          ) : (
            <div
              ref={chartWheelRegionRef}
              className="chart-wheel-region"
              role="slider"
              tabIndex={fullSeries.length > minVisibleCount ? 0 : -1}
              aria-label="차트 표시 기간 확대 축소"
              aria-valuemin={minVisibleCount}
              aria-valuemax={fullSeries.length}
              aria-valuenow={safeVisibleCount}
              aria-valuetext={visibleRangeLabel}
              onKeyDown={handleChartKeyDown}
            >
              <div className="chart-wheel-status" aria-hidden="true">
                <span>휠 ↑ 확대 · ↓ 축소</span>
                <span>{visibleRangeLabel}</span>
              </div>
              <PriceChart
                series={visibleSeries}
                indicatorSeries={fullSeries}
                visibleStart={visibleStart}
                barUnitLabel={barUnitLabel}
                referenceDate={turn.date}
                overlays={detail.assetType === 'bond' ? {} : {
                  ma: showMa ? maPeriods : null,
                  bollinger: showBb,
                  rsi: showRsi,
                }}
              />
            </div>
          )}
        </>
      )}

      {tab === 'news' && (
        <div className="news-body">
          <ul className="news-list">
            {news.length === 0 && <p className="news-empty">관련 뉴스가 없다.</p>}
            {news.map((n) => (
              <li key={n.newsId}>
                <span className="news-date">{relativeYearDate(n.date, turn.date)}</span>
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

      {tab === 'info' && <AssetInfo detail={detail} referenceDate={turn.date} />}
    </Modal>
  );
}

/** 자산 타입별 정보 탭 (stock: 재무/밸류에이션, bond: 신용/만기, coin: 시총 등) */
function AssetInfo({ detail, referenceDate }) {
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
                <td>{relativeYearLabel(f.fiscal_year, referenceDate)} H{f.half}</td>
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
                <td>{relativeYearLabel(v.fiscal_year, referenceDate)} H{v.half}</td>
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
        <div><dt>만기</dt><dd>{relativeDateValue(info.maturity, referenceDate)}</dd></div>
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
