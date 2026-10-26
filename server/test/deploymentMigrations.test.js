const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { MIGRATIONS, runDeploymentMigrations, transactionBody } = require('../deploy/migrate.cjs');

test('deployment migration wrapper keeps the runner transaction authoritative', () => {
  assert.equal(transactionBody('BEGIN;\nSELECT 1;\nCOMMIT;\n', 'wrapped.sql').trim(), 'SELECT 1;');
  assert.equal(transactionBody('-- no wrapper\nSELECT 2;', 'plain.sql'), '-- no wrapper\nSELECT 2;');
  assert.throws(() => transactionBody('SELECT 1; COMMIT;', 'unsafe.sql'), /transaction control/);
  assert.throws(() => transactionBody('BEGIN; SELECT 1;', 'unfinished.sql'), /transaction control/);
});

test('missing deployment SQL fails before connecting to the database', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'antsurvival-missing-migration-'));
  let connected = false;
  try {
    await assert.rejects(runDeploymentMigrations({ connect: async () => { connected = true; } },
      { migrationsDir: directory }), /ENOENT/);
    assert.equal(connected, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('deployment migrations preserve old games, serialize starts, verify hashes and roll back together', {
  skip: process.env.DEPLOY_MIGRATIONS_INTEGRATION !== '1', timeout: 120000,
}, async t => {
  // Explicit opt-in and a localhost-only URL prevent tests from touching Render.
  const connectionString = process.env.MIGRATION_TEST_DATABASE_URL;
  assert.ok(connectionString, 'MIGRATION_TEST_DATABASE_URL must name a local test database');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname));
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString });
  const schemas = [], pools = [], directories = [];
  const migrationsDir = path.join(__dirname, '../migrations');
  t.after(async () => {
    for (const pool of pools) await pool.end();
    // Names are generated here, never taken from a connection string or production config.
    for (const schema of schemas) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    for (const directory of directories) await fs.rm(directory, { recursive: true, force: true });
  });

  async function fixture() {
    const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
    schemas.push(schema);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema},public` });
    pools.push(pool);
    const filenames = (await fs.readdir(migrationsDir)).filter(name => /^\d{3}_.+\.sql$/.test(name)
      && Number(name.slice(0, 3)) <= 10).sort();
    for (const filename of filenames) {
      // PostgreSQL 16 provides gen_random_uuid; don't change database-wide extensions in a test.
      const sql = (await fs.readFile(path.join(migrationsDir, filename), 'utf8'))
        .replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/m, '');
      await pool.query(sql);
    }
    const { rows: [game] } = await pool.query(`INSERT INTO game_sessions
      (difficulty,start_date,current_turn,cash,debt_initial,debt,stress,trust)
      VALUES('normal','2020-01-06',40,12345678,100000000,83333332,17,95) RETURNING *`);
    return { pool, schema, game };
  }

  const fresh = await fixture();
  const concurrent = await Promise.all([
    runDeploymentMigrations(fresh.pool), runDeploymentMigrations(fresh.pool),
  ]);
  assert.deepEqual(concurrent.map(r => r.applied.length).sort(), [0, 4]);
  assert.deepEqual(concurrent.map(r => r.skipped.length).sort(), [0, 4]);
  const { rows: [saved] } = await fresh.pool.query('SELECT * FROM game_sessions WHERE id=$1', [fresh.game.id]);
  assert.equal(saved.quant_challenge_enabled, false);
  delete saved.quant_challenge_enabled;
  assert.deepEqual(saved, fresh.game, 'all old game values remain unchanged');
  assert.equal((await fresh.pool.query('SELECT COUNT(*)::int AS n FROM app_schema_migrations')).rows[0].n, 4);
  assert.deepEqual((await runDeploymentMigrations(fresh.pool)).skipped, MIGRATIONS);

  const changedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antsurvival-migration-checksum-'));
  directories.push(changedDir);
  for (const filename of MIGRATIONS) await fs.copyFile(path.join(migrationsDir, filename), path.join(changedDir, filename));
  await fs.appendFile(path.join(changedDir, MIGRATIONS[3]), '\n-- changed after installation\n');
  await assert.rejects(runDeploymentMigrations(fresh.pool, { migrationsDir: changedDir }), /checksum mismatch/);
  assert.equal((await fresh.pool.query('SELECT COUNT(*)::int AS n FROM app_schema_migrations')).rows[0].n, 4);

  const legacy = await fixture();
  // Also support a manual 011 installation predating the deployment ledger.
  await legacy.pool.query(await fs.readFile(path.join(migrationsDir, MIGRATIONS[0]), 'utf8'));
  await legacy.pool.query(`INSERT INTO quant_challenges(session_id,joined_turn,first_month,prize_base)
    VALUES($1,1,1,50000000)`, [legacy.game.id]);
  await legacy.pool.query(`INSERT INTO quant_challenge_rounds
    (session_id,month_index,end_turn,outcome,prize,claimed_at)
    VALUES($1,1,20,'win',123456,'2026-01-01T00:00:00Z')`, [legacy.game.id]);
  const before = (await legacy.pool.query('SELECT * FROM quant_challenge_rounds')).rows[0];
  await runDeploymentMigrations(legacy.pool);
  const after = (await legacy.pool.query('SELECT * FROM quant_challenge_rounds')).rows[0];
  assert.equal(after.prize_base, '50000000');
  delete after.prize_base;
  assert.deepEqual(after, before, 'settled awards and claim timestamps are preserved');

  const broken = await fixture();
  const badDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antsurvival-migration-rollback-'));
  directories.push(badDir);
  for (const filename of MIGRATIONS) await fs.copyFile(path.join(migrationsDir, filename), path.join(badDir, filename));
  await fs.appendFile(path.join(badDir, MIGRATIONS[3]), '\nSELECT missing_migration_test_function();\n');
  await assert.rejects(runDeploymentMigrations(broken.pool, { migrationsDir: badDir }), /does not exist/);
  const { rows: [rolledBack] } = await broken.pool.query(`SELECT
    to_regclass($1) AS ledger, to_regclass($2) AS challenge`,
  [`${broken.schema}.app_schema_migrations`, `${broken.schema}.quant_challenges`]);
  assert.equal(rolledBack.ledger, null);
  assert.equal(rolledBack.challenge, null, 'the BEGIN/COMMIT in 012 cannot commit partial migrations');
  assert.deepEqual((await broken.pool.query('SELECT * FROM game_sessions WHERE id=$1', [broken.game.id])).rows[0], broken.game);
  assert.equal((await runDeploymentMigrations(broken.pool)).applied.length, 4, 'retry succeeds after rollback');
});
