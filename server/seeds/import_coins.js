// 코인 적재
// 메타: $DATA_DIR/crypto_universe/data/processed/coin_universe_selected.csv
// 시세: $DATA_DIR/crypto_universe/data/processed/coin_history_selected.csv (USD)
// 게임 거래가격(KRW) = price(USD) * usdkrw(macro_daily) -> import_macro 이후 실행
//
// masked_name/coin_info.symbol(가명)은 여기서 채우지 않는다 — assets.name/coin_info.symbol에
// coin_universe_selected.csv의 원값(c.name/c.symbol, 실명)을 그대로 적재하고 masked_name은
// NULL로 둔다. seeds/apply_masking.js가 모든 자산유형(주식/코인/채권)의 masked_name과
// coin_info.symbol을 coin_rename_map.csv 기준으로 채우는 유일한 지점이다(적재 마지막 단계).
// 예전에는 이 파일이 coin_rename_map.csv를 직접 읽어 masked_name/symbol까지 같이 넣었는데
// (심지어 assets.name에도 실명 대신 가명을 넣어서 - 원 이름이 DB 어디에도 안 남는 문제가
// 있었다), import_stocks.js도 같은 일을 자기 방식대로 하고 있어서 마스킹 적용 지점이 세 곳
// (여기 / import_stocks.js / apply_masking.js)으로 흩어져 있었다 - 한 곳(apply_masking.js)
// 으로 통일했다(보고서 참고). assets.name은 스키마 주석대로 "원 이름(내부용, 게임 응답
// 노출 금지)"이어야 하므로 이제 실명을 그대로 담는다.
const path = require('path');
const { readCsv, iterateCsv } = require('./lib/csv');
const { bulkInsert, pool, toIsoDate } = require('./lib/db');

// assets.asset_id는 VARCHAR(30)이라 긴 coingecko id는 잘린다(최대 44자 - migration 004 주석).
// 현재 유니버스 1,267개에서는 절단 충돌이 0건이지만, 유니버스가 바뀌면 서로 다른 코인이
// 같은 asset_id로 접혀 조용히 덮어써질 수 있다. 아래 assertNoAssetIdCollision이 그 경우를
// 적재 시작 전에 실패시킨다.
const toAssetId = (coinId) => `COIN_${coinId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`.slice(0, 30);

/** asset_id 절단으로 서로 다른 코인이 충돌하면 즉시 실패시킨다(조용한 덮어쓰기 방지). */
function assertNoAssetIdCollision(universe) {
  const seen = new Map(); // asset_id -> coin_id
  const collisions = [];
  for (const c of universe) {
    const assetId = toAssetId(c.id);
    if (seen.has(assetId) && seen.get(assetId) !== c.id) {
      collisions.push(`${assetId} <- ${seen.get(assetId)} / ${c.id}`);
    } else {
      seen.set(assetId, c.id);
    }
  }
  if (collisions.length) {
    throw new Error(
      `[import_coins] asset_id 절단 충돌 ${collisions.length}건 - assets.asset_id 확장 필요:\n  ` +
        collisions.slice(0, 10).join('\n  ')
    );
  }
}

async function importCoins(universeCsv, historyCsv) {
  // --- 1) 자산 마스터 + coin_info (전부 원값/실명) ---
  const universe = await readCsv(universeCsv);
  assertNoAssetIdCollision(universe);
  const idMap = new Map(); // coin_id -> asset_id
  const assetRows = [];
  const infoRows = [];
  for (const c of universe) {
    const assetId = toAssetId(c.id);
    idMap.set(c.id, assetId);
    // code(c.id)는 내부 키로 유지 - 프론트/응답에 별도로 노출되지 않음(pricingService 등은
    // masked_name만 SELECT). name은 실명 그대로(apply_masking.js가 masked_name을 채운다).
    assetRows.push([assetId, 'coin', c.id, c.name, null, null, 'KRW']);
    infoRows.push([
      assetId,
      c.symbol, // 실명 심볼 그대로 - apply_masking.js가 coin_rename_map.csv 기준으로 덮어쓴다
      c.market_cap_tier || null, // mega|large|mid|small — coin_universe_selected.csv 정본값 그대로 적재 (재계산 금지, coinUniverseService가 층화추출에 사용)
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
  console.log(`[import_coins] assets ${assetRows.length}코인 (실명 적재 - masked_name은 apply_masking.js가 채움)`);

  // --- 2) 환율 로드 (USD -> KRW) ---
  const { rows: fxRows } = await pool.query(
    `SELECT trade_date, value FROM macro_daily WHERE indicator_code = 'usdkrw' ORDER BY trade_date`
  );
  if (fxRows.length === 0) throw new Error('macro_daily에 usdkrw 없음 - import_macro 먼저 실행');
  const fx = new Map(fxRows.map((r) => [toIsoDate(r.trade_date), Number(r.value)]));
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
