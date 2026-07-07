// 코인 적재
// 메타: $DATA_DIR/crypto_universe/data/processed/coin_universe_selected.csv
// 시세: $DATA_DIR/crypto_universe/data/processed/coin_history_selected.csv (USD)
// 게임 거래가격(KRW) = price(USD) * usdkrw(macro_daily) -> import_macro 이후 실행
const path = require('path');
const { readCsv, iterateCsv } = require('./lib/csv');
const { bulkInsert, pool } = require('./lib/db');

const toAssetId = (coinId) => `COIN_${coinId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`.slice(0, 30);

async function importCoins(universeCsv, historyCsv) {
  // --- 1) 자산 마스터 + coin_info ---
  const universe = await readCsv(universeCsv);
  const idMap = new Map(); // coin_id -> asset_id
  const assetRows = [];
  const infoRows = [];
  for (const c of universe) {
    const assetId = toAssetId(c.id);
    idMap.set(c.id, assetId);
    // 코인은 실명 그대로 노출 (마스킹 대상은 상장사만)
    assetRows.push([assetId, 'coin', c.id, c.name, c.name, null, 'KRW']);
    infoRows.push([
      assetId,
      c.symbol,
      null, // market_cap_tier: TODO(data) 층화추출 티어 라벨 확정 시 채움
      c.first_observed_date || null,
      c.last_observed_date || null,
      c.max_market_cap ? Number(c.max_market_cap) : null,
      c.last_observed_date ? c.last_observed_date >= '2023-12-01' : null,
    ]);
  }
  await bulkInsert('assets', ['asset_id', 'asset_type', 'code', 'name', 'masked_name', 'sector', 'currency'], assetRows);
  await bulkInsert(
    'coin_info',
    ['asset_id', 'symbol', 'market_cap_tier', 'first_observed_date', 'last_observed_date', 'max_market_cap', 'survived_to_2023'],
    infoRows
  );
  console.log(`[import_coins] assets ${assetRows.length}코인`);

  // --- 2) 환율 로드 (USD -> KRW) ---
  const { rows: fxRows } = await pool.query(
    `SELECT trade_date, value FROM macro_daily WHERE indicator_code = 'usdkrw' ORDER BY trade_date`
  );
  if (fxRows.length === 0) throw new Error('macro_daily에 usdkrw 없음 - import_macro 먼저 실행');
  const fx = new Map(fxRows.map((r) => [r.trade_date.toISOString().slice(0, 10), Number(r.value)]));
  const fxAt = (date) => fx.get(date) ?? null;

  // --- 3) 시세 ---
  let count = 0;
  const lastPrice = new Map();
  await iterateCsv(historyCsv, async (batch) => {
    const priceRows = [];
    const detailRows = [];
    for (const r of batch) {
      const assetId = idMap.get(r.coin_id);
      if (!assetId) continue; // 선정 유니버스 외 코인 제외
      const usd = Number(r.price);
      const rate = fxAt(r.date);
      if (!usd || !rate) continue; // 환율 없는 날(주말 등)은 게임 달력 밖 -> 제외
      const krw = usd * rate;
      const prev = lastPrice.get(assetId);
      priceRows.push([assetId, r.date, krw, prev ? (krw - prev) / prev : null, 'KRW']);
      lastPrice.set(assetId, krw);
      detailRows.push([assetId, r.date, usd, Number(r.market_cap) || null, Number(r.total_volume) || null]);
    }
    count += await bulkInsert('asset_prices', ['asset_id', 'trade_date', 'close_price', 'change_rate', 'currency'], priceRows);
    await bulkInsert('coin_price_detail', ['asset_id', 'trade_date', 'price_usd', 'market_cap_usd', 'volume_usd'], detailRows);
  });
  console.log(`[import_coins] asset_prices ${count}행`);
  return count;
}

module.exports = { importCoins };

if (require.main === module) {
  const base = path.join(process.env.DATA_DIR || '.', 'crypto_universe/data/processed');
  importCoins(
    process.env.COIN_UNIVERSE_CSV || path.join(base, 'coin_universe_selected.csv'),
    process.env.COIN_HISTORY_CSV || path.join(base, 'coin_history_selected.csv')
  )
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
