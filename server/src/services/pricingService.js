// 현재가/기간 시세/종목 목록·상세 (ARCHITECTURE.md §11)
// 게임 응답에는 masked_name만 노출한다 (원 회사명 노출 금지, §6 마스킹).
const { query } = require('../db');
const { notFound, badRequest } = require('../utils/errors');
const { EXECUTION_RULES } = require('./executionService');

/** 특정 자산의 특정 날짜 종가. 없으면 null. */
async function getPriceAt(assetId, date, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT close_price FROM asset_prices WHERE asset_id = $1 AND trade_date = $2`,
    [assetId, date]
  );
  return rows[0] ? Number(rows[0].close_price) : null;
}

/** 특정 날짜의 전 자산 시세 맵 { assetId: {price, changeRate} } */
async function getPricesAt(date, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT p.asset_id, p.close_price, p.change_rate FROM asset_prices p
     JOIN assets a USING(asset_id) WHERE p.trade_date = $1 AND a.asset_type = 'stock'`,
    [date]
  );
  const map = {};
  for (const r of rows) {
    map[r.asset_id] = { price: Number(r.close_price), changeRate: r.change_rate === null ? null : Number(r.change_rate) };
  }
  return map;
}

/**
 * 종목 목록 (마켓 모달). date 기준 시세를 붙이고 sort 기준으로 정렬.
 * sort: change(상승률) | decline(하락률) | volume(거래량, 주식만) | amount(거래대금 근사) | name
 */
async function listAssets({ type = 'stock', sort, date }) {
  if (type !== 'stock') throw badRequest('이 게임에서는 주식만 조회할 수 있습니다');
  const params = ['stock'];
  let where = `a.is_active = TRUE AND a.asset_type = $1`;
  let priceJoin = '';
  let priceCols = `NULL AS price, NULL AS change_rate, NULL AS volume`;
  if (date) {
    params.push(date);
    const d = `$${params.length}`;
    // 게임 날짜에 실제로 거래 가능한 종목만 보여준다. 상장 전·폐지 후 자산을 남기면
    // 시세가 없는 행이 순위에 섞이고, 상세 화면에서 거래할 수도 없다.
    where += ` AND (a.listed_from IS NULL OR a.listed_from <= ${d})
      AND (a.listed_to IS NULL OR a.listed_to >= ${d})`;
    priceJoin = `
      LEFT JOIN asset_prices p ON p.asset_id = a.asset_id AND p.trade_date = ${d}
      LEFT JOIN stock_price_detail sd ON sd.asset_id = a.asset_id AND sd.trade_date = ${d}`;
    priceCols = `p.close_price AS price, p.change_rate, sd.volume`;
  }
  const orderBy =
    sort === 'change' ? 'p.change_rate DESC NULLS LAST'
    : sort === 'decline' ? 'p.change_rate ASC NULLS LAST'
    : sort === 'volume' ? 'sd.volume DESC NULLS LAST'
    : sort === 'amount' ? '(sd.volume * p.close_price) DESC NULLS LAST'
    : 'a.asset_type, a.masked_name';

  const { rows } = await query(
    `SELECT a.asset_id, a.asset_type, a.masked_name AS name, a.sector, a.currency, ${priceCols}
     FROM assets a ${priceJoin}
     WHERE ${where}
     ORDER BY ${date ? orderBy : 'a.asset_type, a.masked_name'}`,
    params
  );
  return rows.map((r) => ({
    assetId: r.asset_id,
    assetType: r.asset_type,
    name: r.name,
    sector: r.sector,
    currency: r.currency,
    price: r.price === null ? null : Number(r.price),
    changeRate: r.change_rate === null ? null : Number(r.change_rate),
    volume: r.volume === null ? null : Number(r.volume),
  }));
}

/** 종목 상세 + 자산 타입별 정보 탭 (§10 종목 상세 화면) */
async function getAssetDetail(assetId, date) {
  const { rows } = await query(
    `SELECT asset_id, asset_type, masked_name AS name, sector, currency, listed_from, listed_to
     FROM assets WHERE asset_id = $1 AND asset_type = 'stock'`,
    [assetId]
  );
  const asset = rows[0];
  if (!asset) throw notFound('자산을 찾을 수 없습니다');

  const detail = {
    assetId: asset.asset_id,
    assetType: asset.asset_type,
    name: asset.name,
    sector: asset.sector,
    currency: asset.currency,
    orderSupported: Boolean(EXECUTION_RULES[asset.asset_type]),
    executionRule: EXECUTION_RULES[asset.asset_type] || null,
    // 상장기간(migration 003). 차트 "전체" 범위가 이 값을 시작점으로 쓴다.
    // 게임 시점 이후는 어차피 to=현재 턴 날짜로 잘리므로 미래 정보가 새지 않는다.
    listedFrom: asset.listed_from,
    listedTo: asset.listed_to,
    price: date ? await getPriceAt(assetId, date) : null,
    info: null,
  };

  if (asset.asset_type === 'stock') {
    // 반기 재무/밸류에이션: date 이전 공시분만 노출해야 미래 정보 누출이 없다.
    // TODO(gamelogic): fiscal_year/half -> 공시 가능 시점 매핑 규칙 확정 (현재는 date 연도 - 1까지 노출)
    const cutYear = date ? new Date(date).getFullYear() - 1 : 9999;
    const [fin, val, priceDetail] = await Promise.all([
      query(
        `SELECT * FROM stock_financials WHERE asset_id = $1 AND fiscal_year <= $2
         ORDER BY fiscal_year DESC, half DESC LIMIT 4`,
        [assetId, cutYear]
      ),
      query(
        `SELECT * FROM stock_valuation WHERE asset_id = $1 AND fiscal_year <= $2
         ORDER BY fiscal_year DESC, half DESC LIMIT 4`,
        [assetId, cutYear]
      ),
      date
        ? query(`SELECT * FROM stock_price_detail WHERE asset_id = $1 AND trade_date = $2`, [assetId, date])
        : { rows: [] },
    ]);
    detail.info = {
      financials: fin.rows,
      valuation: val.rows,
      priceDetail: priceDetail.rows[0] || null, // 거래량/수급/시총
    };
  }
  return detail;
}

/** 차트 봉 단위. 증권사 HTS/MTS의 일·주·월봉과 같은 구성이다.
 *  틱/분봉은 1턴=1거래일인 게임 구조상 원천 데이터가 없어 제공하지 않고,
 *  년봉은 240턴(약 1년) 게임에서 봉이 하나뿐이라 뺐다. */
const BAR_UNITS = ['day', 'week', 'month'];

/**
 * 기간 시세. unit이 'week'/'month'면 **달력 경계**로 묶어 OHLC 봉을 만든다.
 *
 * 증권사 주봉은 "5거래일 묶음"이 아니라 월~금 한 주이고, 월봉도 그 달의 첫 거래일부터
 * 마지막 거래일까지다. 휴장일이 끼면 한 주가 4일, 한 달이 18~23일로 달라진다.
 * PostgreSQL date_trunc('week')는 월요일 시작이라 국내 시장 주 구분과 일치한다.
 *
 * **원천에 OHLC가 없다.** DataGuide 시세 시트는 종가와 거래량뿐이다. 그래서
 *   - `day`는 봉 하나에 종가 하나뿐이라 캔들이 성립하지 않는다 → 종가 시계열(라인)로 준다.
 *   - `week`/`month`는 구간 내 종가들을 모아 OHLC로 집계한다.
 *
 * 집계 규칙:
 *   open  = **직전 봉의 종가** (구간 첫날 종가가 아니다)
 *           시가가 없으니 가장 가까운 대용값이 직전 종가다. 이래야 봉의 몸통이
 *           "구간 수익률"과 일치하고 봉 사이에 인위적인 갭이 생기지 않는다.
 *           첫 봉만 직전 데이터가 없어 그 구간 첫 종가를 open으로 쓴다.
 *   high  = max(open, 구간 종가들)   low = min(open, 구간 종가들)
 *           장중 고저가 없으므로 **실제 캔들보다 꼬리가 짧다.**
 *   close = 구간 마지막 종가,  date = 구간 마지막 거래일
 *
 * @param {'day'|'week'|'month'} [unit='day']
 */
async function getPriceSeries(assetId, from, to, unit = 'day') {
  const u = BAR_UNITS.includes(unit) ? unit : 'day';
  const bucketExpr = u === 'day' ? 'p.trade_date' : `date_trunc('${u}', p.trade_date)::date`;

  const { rows } = await query(
    `SELECT p.trade_date, p.close_price, p.change_rate, sd.volume, ${bucketExpr} AS bucket
     FROM asset_prices p
     LEFT JOIN stock_price_detail sd ON sd.asset_id = p.asset_id AND sd.trade_date = p.trade_date
     WHERE p.asset_id = $1 AND p.trade_date BETWEEN $2 AND $3
       AND EXISTS (SELECT 1 FROM assets a WHERE a.asset_id = $1 AND a.asset_type = 'stock')
     ORDER BY p.trade_date`,
    [assetId, from, to]
  );

  if (u === 'day') {
    return rows.map((r) => ({
      date: r.trade_date,
      price: Number(r.close_price),
      changeRate: r.change_rate === null ? null : Number(r.change_rate),
      volume: r.volume == null ? null : Number(r.volume),
    }));
  }

  // 달력 경계별로 묶는다 (SQL이 이미 정렬해 줬으므로 순차 그룹핑으로 충분)
  const buckets = [];
  for (const r of rows) {
    const key = String(r.bucket);
    const last = buckets[buckets.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else buckets.push({ key, rows: [r] });
  }

  let prevClose = null;
  return buckets.map((b) => {
    const closes = b.rows.map((r) => Number(r.close_price));
    const open = prevClose === null ? closes[0] : prevClose;
    const close = closes[closes.length - 1];
    prevClose = close;
    return {
      date: b.rows[b.rows.length - 1].trade_date,
      from: b.rows[0].trade_date,
      days: b.rows.length,
      unit: u,
      open,
      high: Math.max(open, ...closes),
      low: Math.min(open, ...closes),
      close,
      price: close, // 라인/지표 계산이 price를 그대로 쓸 수 있게 유지
      // 누락된 날을 0으로 간주하면 거래량 지표가 왜곡되므로 합계도 미제공한다.
      volume: b.rows.every((r) => r.volume != null)
        ? b.rows.reduce((sum, r) => sum + Number(r.volume), 0)
        : null,
      changeRate: open ? (close - open) / open : null,
    };
  });
}

module.exports = { getPriceAt, getPricesAt, listAssets, getAssetDetail, getPriceSeries, BAR_UNITS };
