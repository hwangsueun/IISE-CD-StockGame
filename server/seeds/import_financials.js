// Import only receipt-versioned, source-audited statements. No session or price rows are changed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateDate } = require('../src/services/financialStatementService');
const DEFAULT_FILE = path.join(__dirname, '../src/data/stockFinancialStatements.json');
const METRICS = ['revenue', 'operating_income', 'net_income', 'total_assets', 'total_liabilities', 'total_equity'];
const COLUMNS = ['asset_id', 'receipt_no', 'fiscal_year', 'period_start', 'period_end', 'published_date',
  'available_date', 'fs_div', 'currency', ...METRICS, 'metric_labels', 'source_kind', 'source_sha256', 'source_metadata'];

function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function validateBundle(raw) {
  const data = JSON.parse(raw.toString('utf8'));
  if (!/^[a-z0-9][a-z0-9._-]{4,100}$/.test(data.version || '') || !Array.isArray(data.records) || !data.records.length) {
    throw new Error('Invalid or empty financial statement bundle');
  }
  const seen = new Set();
  const records = data.records.map(row => {
    if (!/^STOCK_\d{6}$/.test(row.asset_id || '') || !/^\d{14}$/.test(row.receipt_no || '') ||
        !['CFS', 'OFS'].includes(row.fs_div) || !/^[A-Z]{3}$/.test(row.currency || '') ||
        !['dart_major_accounts', 'dart_document', 'dart_full_accounts'].includes(row.source?.kind) ||
        !/^[a-f0-9]{64}$/.test(row.source?.sha256 || '')) throw new Error('Invalid financial source identity');
    for (const key of ['period_end', 'published_date', 'available_date']) {
      if (!validateDate(row[key])) throw new Error(`Missing financial ${key}`);
    }
    const start = validateDate(row.period_start);
    if ((start && start > row.period_end) || row.period_end > row.published_date ||
        row.available_date !== nextDate(row.published_date) ||
        row.fiscal_year !== Number(row.period_end.slice(0, 4))) throw new Error('Invalid financial reporting period or availability');
    const identity = [row.asset_id, row.receipt_no, row.fs_div, row.period_end].join(':');
    if (seen.has(identity)) throw new Error('Duplicate financial receipt and period');
    seen.add(identity);
    let present = 0;
    const amounts = METRICS.map(key => {
      const value = row[key];
      if (value === null || value === undefined || value === '') return null;
      // Strings keep large won amounts exact across JSON, PostgreSQL and the browser.
      if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error(`Invalid financial amount: ${key}`);
      present += 1;
      return BigInt(value).toString();
    });
    if (!present) throw new Error('Financial statement has no reported values');
    const labels = Object.fromEntries(Object.entries(row.metric_labels || {}).filter(([key, value]) =>
      METRICS.includes(key) && typeof value === 'string' && value.length <= 100));
    return [row.asset_id, row.receipt_no, row.fiscal_year, start, row.period_end, row.published_date,
      row.available_date, row.fs_div, row.currency, ...amounts, JSON.stringify(labels), row.source.kind, row.source.sha256, JSON.stringify(row.source)];
  });
  return { version: data.version, records, sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

const recordKey = row => [row[0], row[1], row[7], row[4]].join(':');
async function verifyExisting(client, records, { required = false } = {}) {
  const ids = [...new Set(records.map(row => row[0]))];
  const { rows } = await client.query(`SELECT ${COLUMNS.join(',')} FROM stock_financial_statements WHERE asset_id=ANY($1::text[])`, [ids]);
  const stored = new Map(rows.map(row => {
    const values = COLUMNS.map(column => row[column]);
    values[15] = JSON.stringify(row.metric_labels || {});
    values[18] = JSON.stringify(row.source_metadata || {});
    return [recordKey(values), values];
  }));
  for (const expected of records) {
    const found = stored.get(recordKey(expected));
    if (!found) {
      if (required) throw new Error('Installed financial bundle has a missing receipt');
      continue;
    }
    for (let index = 0; index < COLUMNS.length; index++) {
      const canonical = value => value === null || value === undefined ? null : String(value);
      if (index === 15 || index === 18) {
        const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, ordered(entry)])) : value;
        const normalized = text => JSON.stringify(ordered(JSON.parse(text)));
        if (normalized(found[index]) !== normalized(expected[index])) throw new Error('Existing financial receipt metadata differs from the audited source');
      } else if (canonical(found[index]) !== canonical(expected[index])) {
        throw new Error(`Existing financial receipt differs from the audited source: ${COLUMNS[index]}`);
      }
    }
  }
}

async function importFinancials(pool, { file = DEFAULT_FILE } = {}) {
  const bundle = validateBundle(fs.readFileSync(file));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(120261106, 15)');
    const { rows: existing } = await client.query('SELECT sha256 FROM stock_financial_imports WHERE version=$1', [bundle.version]);
    if (existing.length) {
      if (existing[0].sha256 !== bundle.sha256) throw new Error('Installed financial bundle checksum mismatch');
      await verifyExisting(client, bundle.records, { required: true });
      await client.query('COMMIT');
      return { skipped: true, version: bundle.version, records: bundle.records.length };
    }
    const ids = [...new Set(bundle.records.map(row => row[0]))];
    const { rows: assets } = await client.query("SELECT asset_id FROM assets WHERE asset_type='stock' AND asset_id=ANY($1::text[])", [ids]);
    if (assets.length !== ids.length) throw new Error('Financial bundle contains a stock missing from the market database');
    await verifyExisting(client, bundle.records);
    let inserted = 0;
    for (let offset = 0; offset < bundle.records.length; offset += 250) {
      const params = [];
      const tuples = bundle.records.slice(offset, offset + 250).map(row =>
        `(${row.map(value => { params.push(value); return `$${params.length}`; }).join(',')})`);
      const result = await client.query(
        `INSERT INTO stock_financial_statements(${COLUMNS.join(',')}) VALUES ${tuples.join(',')}
         ON CONFLICT(asset_id,receipt_no,fs_div,period_end) DO NOTHING`, params);
      inserted += result.rowCount;
    }
    await client.query('INSERT INTO stock_financial_imports(version,sha256) VALUES($1,$2)', [bundle.version, bundle.sha256]);
    await client.query('COMMIT');
    return { installed: true, version: bundle.version, inserted, records: bundle.records.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const { pool } = require('../src/db');
  importFinancials(pool, { file: process.env.FINANCIAL_STATEMENTS_FILE || DEFAULT_FILE })
    .then(result => console.log('[financials]', JSON.stringify(result)))
    .catch(error => { console.error('[financials]', error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { importFinancials, validateBundle, DEFAULT_FILE };
