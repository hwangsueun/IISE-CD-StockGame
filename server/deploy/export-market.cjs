// Export schema and market data only; user accounts, tokens and saved games stay local.
// Usage: node server/deploy/export-market.cjs /absolute/new/market.dump
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw new Error('An absolute new dump path is required');
const marketTables = new Set(['assets', 'asset_prices', 'stock_price_detail', 'bond_price_detail',
  'coin_price_detail', 'stock_financials', 'stock_valuation', 'bond_info', 'coin_info',
  'macro_indicators', 'macro_daily', 'news', 'news_tags', 'community_posts', 'community_comments', 'market_data_versions']);
function sql(query) {
  const result = spawnSync('docker', ['exec', 'antsurvival_db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'admin', '-d', 'antsurvival', '-Atc', query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Database query failed');
  return result.stdout.trim();
}
const tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split('\n');
if (tables.some(name => !/^[a-z_]+$/.test(name))) throw new Error('Unexpected table identifier');
for (const name of marketTables) if (!tables.includes(name)) throw new Error(`Missing market table: ${name}`);
const excluded = tables.filter(name => !marketTables.has(name));
fs.mkdirSync(path.dirname(destination), { recursive: true });
const fd = fs.openSync(destination, 'wx', 0o600);
try {
  const result = spawnSync('docker', ['exec', 'antsurvival_db', 'pg_dump', '-U', 'admin', '-d', 'antsurvival',
    '--format=custom', '--no-owner', '--no-acl', ...excluded.map(name => `--exclude-table-data=public.${name}`)],
    { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Dump failed');
} finally { fs.closeSync(fd); }
const manifest = { exportedAt: new Date().toISOString(), bytes: fs.statSync(destination).size,
  includedMarketTables: [...marketTables], excludedTableData: excluded };
fs.writeFileSync(`${destination}.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(manifest, null, 2));
