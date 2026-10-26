const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareAnalysis(runtimeDir, signalsSha256) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'analysis-manifest.json'), 'utf8'));
  if (manifest.signalsSha256 !== signalsSha256) throw Error('Analysis signal version mismatch');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid bundled path');
    if (await hashFile(path.join(__dirname, name)) !== hash) throw Error(`Analysis checksum mismatch: ${name}`);
  }
  for (const name of fs.readdirSync(path.join(__dirname, 'analysis'))) {
    fs.symlinkSync(path.join(__dirname, 'analysis', name), path.join(runtimeDir, name));
  }
  process.env.QUANT_MODEL_DIR = runtimeDir;
  return manifest;
}

async function prepareSectors(pool, runtimeDir, manifest) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(12026026, 2)');
    await client.query(`CREATE TABLE IF NOT EXISTS deployment_data (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const sha = manifest.files['sectors.csv.gz'];
    const { rows: [previous] } = await client.query("SELECT sha256 FROM deployment_data WHERE name='sector-indices-v1'");
    if (previous) {
      if (previous.sha256 !== sha) throw Error('Installed sector source changed; provide an explicit upgrade');
      return { skipped: true };
    }
    const csv = path.join(runtimeDir, 'sectors.csv');
    fs.writeFileSync(csv, zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'sectors.csv.gz'))), { mode: 0o600 });
    const result = await require('../seeds/import_sectors').importSectors(csv);
    await client.query("INSERT INTO deployment_data(name,sha256) VALUES('sector-indices-v1',$1)", [sha]);
    fs.unlinkSync(csv);
    return result;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(12026026, 2)'); } finally { client.release(); }
  }
}
module.exports = { prepareAnalysis, prepareSectors };
