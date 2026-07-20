// 상장기간(assets.listed_from / listed_to) 채우기 — 003_final_data_alignment.sql
// 런타임의 코인 강제청산 로직은 이 두 컬럼만 보고 동작하며 coin_info를 조인하지 않는다
// (003 마이그레이션 주석 참조). ETL이 반드시 채워야 하는 계약이다.
// ARCHITECTURE.md §6 적재 순서: 모든 시세 적재(주식/채권/코인)가 끝난 뒤 실행하는 마무리 단계.
// import_all.js 맨 끝에서 호출한다.
const { pool } = require('./lib/db');

async function finalizeListingRange() {
  // 1) 전 자산: asset_prices 실측 min/max trade_date로 채운다 (타입 분기 없이 공통 규칙).
  const { rowCount } = await pool.query(`
    UPDATE assets a
    SET listed_from = p.min_date,
        listed_to   = p.max_date
    FROM (
      SELECT asset_id, MIN(trade_date) AS min_date, MAX(trade_date) AS max_date
      FROM asset_prices
      GROUP BY asset_id
    ) p
    WHERE a.asset_id = p.asset_id
  `);
  console.log(`[finalize_listing_range] listed_from/listed_to 갱신 ${rowCount}건 (asset_prices 실측 기준)`);

  // 2) asset_prices가 아예 없는 자산: 상장기간이 NULL로 남는다 -> 런타임에서 "상시 미상장" 취급될
  //    수 있으므로 명시적으로 경고한다(시세 적재 누락 여부를 데이터 담당이 바로 알 수 있도록).
  const { rows: noPrice } = await pool.query(`SELECT asset_id FROM assets WHERE listed_from IS NULL`);
  if (noPrice.length) {
    console.warn(
      `[finalize_listing_range] asset_prices가 없어 상장기간이 NULL인 자산 ${noPrice.length}건: ` +
        noPrice.slice(0, 30).map((r) => r.asset_id).join(', ') +
        (noPrice.length > 30 ? ` 외 ${noPrice.length - 30}건` : '')
    );
  }

  // 3) 코인: coin_info.first_observed_date/last_observed_date와 교차 검증. 불일치 시 경고만 남기고
  //    asset_prices 실측값(위에서 이미 반영됨)을 그대로 우선한다 - coin_info는 참고용 메타데이터.
  const { rows: coinRows } = await pool.query(`
    SELECT a.asset_id, a.listed_from, a.listed_to,
           c.first_observed_date, c.last_observed_date
    FROM assets a
    JOIN coin_info c ON c.asset_id = a.asset_id
    WHERE a.asset_type = 'coin'
  `);
  let mismatchCount = 0;
  for (const r of coinRows) {
    const fromMismatch = r.first_observed_date && r.listed_from && r.first_observed_date !== r.listed_from;
    const toMismatch = r.last_observed_date && r.listed_to && r.last_observed_date !== r.listed_to;
    if (fromMismatch || toMismatch) {
      mismatchCount++;
      console.warn(
        `[finalize_listing_range] 코인 상장기간 불일치(asset_prices 실측 우선 적용): ${r.asset_id} ` +
          `coin_info[${r.first_observed_date} ~ ${r.last_observed_date}] vs asset_prices[${r.listed_from} ~ ${r.listed_to}]`
      );
    }
  }
  console.log(
    `[finalize_listing_range] 코인 coin_info 교차검증 ${coinRows.length}건 중 불일치 ${mismatchCount}건 (asset_prices 실측값 유지)`
  );

  return rowCount;
}

module.exports = { finalizeListingRange };

if (require.main === module) {
  finalizeListingRange()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
