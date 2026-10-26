const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// The restored production database already contains 001–010. Never replay seeds
// or the original schema on startup; only these additive application migrations.
const MIGRATIONS = Object.freeze([
  '011_quant_challenge.sql',
  '012_monthly_challenge_capital.sql',
  '013_user_strategies.sql',
  '014_model_automation.sql',
]);
const LOCK_KEY = [0x414e5453, 0x4d494752]; // ANT SURVIVAL / migrations, per database

function transactionBody(sql, filename) {
  const wrapper = sql.match(/^\s*BEGIN\s*;([\s\S]*)COMMIT\s*;\s*$/i);
  const body = wrapper ? wrapper[1] : sql;
  // These fixed SQL files contain no procedural bodies. Reject any unexpected
  // transaction command instead of allowing an inner COMMIT to break atomicity.
  const statements = body.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/(?:^|;)\s*(?:BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(statements)) {
    throw new Error(`Unexpected transaction control in migration ${filename}`);
  }
  return body;
}

async function readMigrations(migrationsDir) {
  return Promise.all(MIGRATIONS.map(async filename => {
    const raw = await fs.readFile(path.join(migrationsDir, filename));
    return {
      filename,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
      sql: transactionBody(raw.toString('utf8'), filename),
    };
  }));
}

async function verifyBaseline(client) {
  const required = ['game_sessions', 'market_orders', 'stock_price_detail', 'market_data_versions'];
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`, [required]);
  const missing = required.filter(name => !rows.some(row => row.table_name === name));
  const { rows: columns } = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='stock_price_detail'
      AND column_name IN ('adjustment_factor','adjusted_volume')`);
  if (missing.length || columns.length !== 2) {
    throw new Error('Restore the database schema through migration 010 before applying application migrations');
  }
}

async function runDeploymentMigrations(pool, {
  migrationsDir = path.join(__dirname, '../migrations'),
  lockTimeoutMs = 15000,
  statementTimeoutMs = 120000,
} = {}) {
  // Fail before opening a transaction if a deployment omitted a required file.
  const migrations = await readMigrations(migrationsDir);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('lock_timeout',$1,true), set_config('statement_timeout',$2,true)",
      [`${lockTimeoutMs}ms`, `${statementTimeoutMs}ms`]);
    await client.query('SELECT pg_advisory_xact_lock($1,$2)', LOCK_KEY);
    await verifyBaseline(client);
    await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      filename TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const { rows: recorded } = await client.query(
      'SELECT filename,sha256 FROM app_schema_migrations WHERE filename=ANY($1::text[])', [MIGRATIONS]);
    const hashes = new Map(recorded.map(row => [row.filename, row.sha256]));
    // Check all hashes before executing anything, including earlier missing files.
    for (const migration of migrations) {
      if (hashes.has(migration.filename) && hashes.get(migration.filename) !== migration.sha256) {
        throw new Error(`Applied migration checksum mismatch: ${migration.filename}`);
      }
    }
    const applied = [], skipped = [];
    for (const migration of migrations) {
      if (hashes.has(migration.filename)) {
        skipped.push(migration.filename);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO app_schema_migrations(filename,sha256) VALUES($1,$2)',
        [migration.filename, migration.sha256]);
      applied.push(migration.filename);
    }
    await client.query('COMMIT');
    return { applied, skipped };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { MIGRATIONS, runDeploymentMigrations, transactionBody };
