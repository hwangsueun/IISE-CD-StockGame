// 현재가/기간 시세/종목 목록·상세 (ARCHITECTURE.md §11)
// 게임 응답에는 masked_name만 노출한다 (원 회사명 노출 금지, §6 마스킹).
const { query } = require('../db');
const { notFound } = require('../utils/errors');

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
    `SELECT asset_id, close_price, change_rate FROM asset_prices WHERE trade_date = $1`,
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
 * sort: change(상승률) | volume(거래량, 주식만) | amount(거래대금 근사) | name
 * sessionId: 코인은 이 세션이 층화추출한 20개 유니버스로 제한한다(migration 005). 주식/채권은
 *   전역이라 영향받지 않는다(asset_type <> 'coin' 분기로 그대로 통과).
 *
 * sessionId 미전달 시 결정: 코인을 결과에서 아예 제외한다(주식/채권만 반환).
 * 근거 — 게임이 실제 거래 대상으로 노출하는 코인은 세션마다 다른 20개뿐이므로(작업 배경),
 * sessionId 없이 a.is_active만으로 걸러 전체 코인(1,267개, 참조 유니버스)을 그대로 보여주면
 * "마켓 목록에 보이는 것 = 실제로 살 수 있는 것"이라는 전제가 깨지고 대부분 거래 불가능한
 * 코인 목록을 노출하게 된다. sessionId 없는 호출은 세션 스코프가 정의되지 않은 상황(세션
 * 시작 전 등)이므로 안전한 기본값(코인 비노출)을 택했다. 프론트 api/client.js는 현재
 * sessionId를 넘기지 않지만, 호출 자체는 에러 없이 200으로 응답한다(주식/채권 탭은 기존과
 * 동일, 코인 탭만 빈 배열) — sessionId를 넘기도록 프론트를 갱신하면 원래 의도대로 복원된다.
 */
async function listAssets({ type, sort, date, sessionId }) {
  const params = [];
  let where = `a.is_active = TRUE`;
  if (type) {
    params.push(type);
    where += ` AND a.asset_type = $${params.length}`;
  }
  if (sessionId) {
    params.push(sessionId);
    where += ` AND (a.asset_type <> 'coin' OR EXISTS (
      SELECT 1 FROM session_coin_universe scu
      WHERE scu.session_id = $${params.length} AND scu.asset_id = a.asset_id
    ))`;
  } else {
    where += ` AND a.asset_type <> 'coin'`;
  }
  let priceJoin = '';
  let priceCols = `NULL AS price, NULL AS change_rate, NULL AS volume`;
  if (date) {
    params.push(date);
    const d = `$${params.length}`;
    priceJoin = `
      LEFT JOIN asset_prices p ON p.asset_id = a.asset_id AND p.trade_date = ${d}
      LEFT JOIN stock_price_detail sd ON sd.asset_id = a.asset_id AND sd.trade_date = ${d}`;
    priceCols = `p.close_price AS price, p.change_rate, sd.volume`;
  }
  const orderBy =
    sort === 'change' ? 'p.change_rate DESC NULLS LAST'
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
    `SELECT asset_id, asset_type, masked_name AS name, sector, currency
     FROM assets WHERE asset_id = $1`,
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
  } else if (asset.asset_type === 'bond') {
    const [info, yieldRow] = await Promise.all([
      query(`SELECT * FROM bond_info WHERE asset_id = $1`, [assetId]),
      date
        ? query(`SELECT * FROM bond_price_detail WHERE asset_id = $1 AND trade_date = $2`, [assetId, date])
        : { rows: [] },
    ]);
    detail.info = { ...info.rows[0], today: yieldRow.rows[0] || null };
  } else if (asset.asset_type === 'coin') {
    const [info, coinRow] = await Promise.all([
      query(`SELECT * FROM coin_info WHERE asset_id = $1`, [assetId]),
      date
        ? query(`SELECT * FROM coin_price_detail WHERE asset_id = $1 AND trade_date = $2`, [assetId, date])
        : { rows: [] },
    ]);
    detail.info = { ...info.rows[0], today: coinRow.rows[0] || null };
  }
  return detail;
}

/** 차트용 기간 시세 (asset_prices 기준) */
async function getPriceSeries(assetId, from, to) {
  const { rows } = await query(
    `SELECT trade_date, close_price, change_rate
     FROM asset_prices
     WHERE asset_id = $1 AND trade_date BETWEEN $2 AND $3
     ORDER BY trade_date`,
    [assetId, from, to]
  );
  return rows.map((r) => ({
    date: r.trade_date,
    price: Number(r.close_price),
    changeRate: r.change_rate === null ? null : Number(r.change_rate),
  }));
}

module.exports = { getPriceAt, getPricesAt, listAssets, getAssetDetail, getPriceSeries };
