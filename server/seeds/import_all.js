// 전체 적재 오케스트레이터 (ARCHITECTURE.md §6 적재 순서)
// 사용:
//   node seeds/import_all.js --stub          # 합성 스텁 데이터 (개발용)
//   DATA_DIR=... node seeds/import_all.js    # 실데이터 전체 적재
// 적재 순서: assets/시세(주식->거시->채권->코인) -> 뉴스 -> 종토방 -> 가명 적용 -> 상장기간 확정
// 마스킹 사전은 $DATA_DIR/data/processed/rename_map/{stock,coin,alias}_rename_map.csv
// (정본, data-pipeline이 관리)이다 - DATA_DIR만 맞으면 별도 생성/커밋 단계 없이 매 실행마다
// 그대로 다시 읽는다(src/services/maskingService.js). 뉴스/종토방 본문 마스킹(import_news.js,
// import_community.js)과 assets.masked_name 적용(apply_masking.js) 모두 같은 CSV를 원천으로
// 쓰므로 항상 서로 일치한다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('./lib/db');

async function main() {
  if (process.argv.includes('--stub')) {
    const { seedStub } = require('./stub');
    await seedStub();
    return;
  }

  const DATA_DIR = process.env.DATA_DIR;
  if (!DATA_DIR) {
    throw new Error('DATA_DIR 환경변수가 필요합니다 (data-pipeline 루트 경로)');
  }

  const { importStocks } = require('./import_stocks');
  const { importMacro } = require('./import_macro');
  const { importBonds } = require('./import_bonds');
  const { importCoins } = require('./import_coins');
  const { importNews } = require('./import_news');
  const { importCommunity } = require('./import_community');
  const { applyMasking } = require('./apply_masking');
  const { finalizeListingRange } = require('./finalize_listing_range');

  // 1. 주식 (assets + asset_prices + stock_price_detail)
  await importStocks(path.join(DATA_DIR, 'data/raw/stock/stock_price-volume_npq.xlsx'));
  // 2. 거시 (macro_daily) - 채권/코인 환산의 선행 조건
  await importMacro(path.join(DATA_DIR, 'market_indicator/data/processed/macro_context_daily.csv'));
  // 3. 채권 (국고채 CSV + 회사채 macro_daily)
  await importBonds(path.join(DATA_DIR, 'bond_universe/data/kr_treasury_yields_long.csv'));
  // 4. 코인 (universe + history, usdkrw 환산)
  await importCoins(
    path.join(DATA_DIR, 'crypto_universe/data/processed/coin_universe_selected.csv'),
    path.join(DATA_DIR, 'crypto_universe/data/processed/coin_history_selected.csv')
  );
  // 5. 뉴스 4종 JSONL (stock_code -> asset_id 매칭 + maskingService로 본문 마스킹 포함)
  await importNews(path.join(DATA_DIR, 'news_generator/data/interim/game_publish_calendar'));
  // 6. 종토방: 스레드 JSONL 단일 원천 (target_kind/target_id -> asset_id 직접 매핑, 003 계약)
  await importCommunity(
    path.join(
      DATA_DIR,
      'npc_generator/data/processed/dci_board_rewritten/board_threads_validated_final_screened.jsonl'
    )
  );
  // TODO(data): stock_financials/stock_valuation 반기 재무 적재기 (DataGuide 재무 파일 확정 시 추가)

  // --- 마무리 단계 (모든 자산/시세 적재가 끝난 뒤에만 실행) ---
  // 7. 가명 사전(rename_map) 적용 -> assets.masked_name / is_masked (apply_masking.js)
  await applyMasking();
  // 8. 상장기간(listed_from/listed_to) 확정 - 런타임 코인 강제청산 계약의 단일 기준 (003)
  await finalizeListingRange();
}

main()
  .then(() => {
    console.log('[import_all] 완료');
    return pool.end();
  })
  .catch((e) => {
    console.error('[import_all] 실패:', e);
    process.exit(1);
  });
