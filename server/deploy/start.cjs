// Fail closed if the bundled model or restored market data is missing/mismatched.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const metadata = JSON.parse(fs.readFileSync(path.join(__dirname, 'quant-manifest.json'), 'utf8'));
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'quant-signals.json.gz')));
  if (crypto.createHash('sha256').update(raw).digest('hex') !== metadata.sha256) throw new Error('Quant checksum mismatch');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antsurvival-'));
  process.env.QUANT_SIGNALS_FILE = path.join(runtimeDir, 'signals.json');
  fs.writeFileSync(process.env.QUANT_SIGNALS_FILE, raw, { mode: 0o600 });
  const { prepareAnalysis, prepareSectors } = require('./prepare-assets.cjs');
  const analysisManifest = await prepareAnalysis(runtimeDir, metadata.sha256);
  process.env.STATIC_DIR = path.join(root, 'frontend/dist');
  const { loadArtifact } = require('../src/services/quantService');
  const { artifact } = loadArtifact();
  const { query, pool } = require('../src/db');
  const { rows: [version] } = await query('SELECT * FROM market_data_versions WHERE active = TRUE');
  if (!version || version.version !== artifact.data_version || version.price_basis !== artifact.price_basis) {
    throw new Error('Restore the matching market database before starting the game');
  }
  const { rows: [prices] } = await query('SELECT EXISTS(SELECT 1 FROM asset_prices) AS ready');
  if (!prices.ready) throw new Error('Market prices are missing');
  console.log(JSON.stringify({ status: 'migrated', ...await require('./migrate.cjs').runDeploymentMigrations(pool) }));
  console.log(JSON.stringify({ status: 'sectors', ...await prepareSectors(pool, runtimeDir, analysisManifest) }));
  const app = require('../src/index');
  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ status: 'ready', port, model: artifact.model_version, sha256: metadata.sha256 }));
  });
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main().catch(error => { console.error('[startup]', error.message); process.exit(1); });
