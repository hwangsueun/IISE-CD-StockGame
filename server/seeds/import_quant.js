// Quant done CSV -> supplemental stock bars. Never overwrite game close/volume.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool, withTransaction } = require('../src/db');

async function importQuant(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const buffer = fs.readFileSync(path.join(directory, 'stock_price_detail.csv'));
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== manifest.files['stock_price_detail.csv']) {
    throw new Error('Quant CSV hash mismatch');
  }
  const [header, ...lines] = buffer.toString('utf8').trim().split(/\r?\n/);
  if (header !== 'asset_id,trade_date,open_price,high_price,low_price,close_price,volume,amount,vwap') {
    throw new Error('Unexpected quant CSV columns');
  }
  const rows = lines.map((line) => line.split(',').map((v, i) => i < 2 ? v : v === '' ? null : Number(v)));
  if (rows.length !== manifest.rows || rows.some((r) => r.length !== 9 ||
      !/^STOCK_\d{6}$/.test(r[0]) || r.slice(2).some((v) => v !== null && !Number.isFinite(v)))) {
    throw new Error('Invalid quant rows');
  }
  return withTransaction(async (client) => {
    await client.query(`CREATE TEMP TABLE quant_import (
      asset_id TEXT, trade_date DATE, open_price NUMERIC, high_price NUMERIC, low_price NUMERIC,
      close_price NUMERIC, volume BIGINT, amount NUMERIC, vwap NUMERIC,
      PRIMARY KEY (asset_id, trade_date)) ON COMMIT DROP`);
    for (let start = 0; start < rows.length; start += 4000) {
      const chunk = rows.slice(start, start + 4000);
      const placeholders = chunk.map((r, i) => `(${r.map((_, j) => `$${i * 9 + j + 1}`).join(',')})`);
      await client.query(`INSERT INTO quant_import VALUES ${placeholders.join(',')}`, chunk.flat());
    }
    const { rows: mismatch } = await client.query(`SELECT COUNT(*)::int AS n FROM quant_import q
      LEFT JOIN asset_prices p USING (asset_id, trade_date)
      LEFT JOIN stock_price_detail d USING (asset_id, trade_date)
      WHERE p.close_price IS DISTINCT FROM q.close_price OR d.volume IS DISTINCT FROM q.volume`);
    if (mismatch[0].n) throw new Error(`${mismatch[0].n} rows disagree with existing game prices/volumes; import rolled back`);
    const result = await client.query(`UPDATE stock_price_detail d SET
      open_price = q.open_price, high_price = q.high_price, low_price = q.low_price,
      amount = q.amount, vwap = q.vwap FROM quant_import q
      WHERE d.asset_id = q.asset_id AND d.trade_date = q.trade_date`);
    return { updated: result.rowCount, dataVersion: manifest.version };
  });
}

module.exports = { importQuant };
if (require.main === module) {
  const dir = process.argv[2] || process.env.QUANT_DONE_DIR;
  if (!dir) throw new Error('Usage: node seeds/import_quant.js /path/to/done/quant/version');
  importQuant(dir).then(console.log).catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
}
