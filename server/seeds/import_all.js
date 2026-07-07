// 전체 적재 오케스트레이터 (ARCHITECTURE.md §6 적재 순서)
// 사용:
//   node seeds/import_all.js --stub          # 합성 스텁 데이터 (개발용)
//   DATA_DIR=... node seeds/import_all.js    # 실데이터 전체 적재
// 적재 순서: assets/시세(주식->거시->채권->코인) -> 뉴스 -> 종토방
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
  // 5. 뉴스 4종 JSONL (stock_code -> asset_id 매칭 포함)
  await importNews(path.join(DATA_DIR, 'news_generator/data/interim/game_publish_calendar'));
  // 6. 종토방 (갤러리-종목 매핑 필요, import_community.js 참조)
  await importCommunity(
    path.join(DATA_DIR, 'npc_generator/data/processed/dci_posts_ready.csv'),
    path.join(DATA_DIR, 'npc_generator/data/processed/dci_comments_ready.csv')
  );
  // TODO(data): stock_financials/stock_valuation 반기 재무 적재기 (DataGuide 재무 파일 확정 시 추가)
  // TODO(data): 마스킹 사전 적용 (assets.masked_name, news 본문) - maskingService.CANONICAL_TO_MASKED
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
