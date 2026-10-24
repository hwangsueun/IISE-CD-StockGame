const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('real pinned Alpha158: two historical models reconstruct 158 contributions without changing game funds or orders', {
  skip: process.env.QUANT_ATTRIBUTION_INTEGRATION !== '1', timeout: 90000,
}, async t => {
  require('dotenv').config({ quiet: true });
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/antsurvival_challenge_20261019');
  const db = require('../src/db');
  const { loadArtifact, getQuantPortfolio } = require('../src/services/quantService');
  const { getQuantAttribution, computeDay } = require('../src/services/quantAttribution');
  const sessions = [], loaded = loadArtifact();
  const oldDirectory = process.env.QUANT_MODEL_DIR;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha158-attribution-integrity-'));
  t.after(async () => {
    if (oldDirectory === undefined) delete process.env.QUANT_MODEL_DIR; else process.env.QUANT_MODEL_DIR = oldDirectory;
    fs.rmSync(temporary, { recursive: true, force: true });
    for (const id of sessions) await db.query('DELETE FROM game_sessions WHERE id=$1', [id]);
    await db.pool.end();
  });
  const seenModels = new Set();
  for (const day of ['2014-07-23', '2020-01-02']) {
    const { rows: [s] } = await db.query(`INSERT INTO game_sessions(difficulty,start_date,initial_cash,cash,debt_initial,debt,monthly_living_cost)
      VALUES('normal',$1,50000000,50000000,100000000,100000000,800000) RETURNING id`, [day]);
    sessions.push(s.id);
    await require('../src/services/turnSelector').createGameTurns(db, s.id, [day]);
    const p = await getQuantPortfolio(s.id);
    assert.ok(p.decision.selections.length);
    const before = (await db.query('SELECT cash,debt,current_turn FROM game_sessions WHERE id=$1', [s.id])).rows;
    const orders = (await db.query('SELECT order_key,status,quantity,filled_quantity,cash_budget FROM market_orders WHERE session_id=$1 ORDER BY order_key', [s.id])).rows;
    for (const selection of p.decision.selections.slice(0, 2)) {
      const r = await getQuantAttribution(s.id, selection.assetId);
      assert.equal(r.features.length, 158); assert.equal(r.signalDate, day);
      assert.equal(r.score, selection.score); assert.equal(r.artifactSha256, loaded.sha);
      assert.ok(r.trainedThrough < day);
      assert.ok(Math.abs(r.baseValue + r.features.reduce((sum, f) => sum + f.contribution, 0) - selection.score) < 1e-8);
      assert.ok(r.features.some(f => f.contribution > 0)); assert.ok(r.features.some(f => f.contribution < 0));
      seenModels.add(r.modelId);
      console.log(`${day}: ${r.modelId}, ${r.features.length} factors, score error ${r.maxScoreError}, sum error ${r.maxSumError}`);
    }
    await assert.rejects(() => getQuantAttribution(s.id, 'STOCK_999999'), /포함된/);
    assert.deepEqual((await db.query('SELECT cash,debt,current_turn FROM game_sessions WHERE id=$1', [s.id])).rows, before);
    assert.deepEqual((await db.query('SELECT order_key,status,quantity,filled_quantity,cash_budget FROM market_orders WHERE session_id=$1 ORDER BY order_key', [s.id])).rows, orders);
  }
  assert.equal(seenModels.size, 2);
  const actual = oldDirectory || JSON.parse(fs.readFileSync(path.join(path.dirname(loaded.file), 'active-data.json'), 'utf8')).model_directory;
  for (const file of ['signals.json', 'features.parquet', 'spec.json']) fs.symlinkSync(path.join(actual, file), path.join(temporary, file));
  const model = loaded.artifact.sessions['2014-07-23'].model_id;
  fs.copyFileSync(path.join(actual, `${model}.txt`), path.join(temporary, `${model}.txt`));
  fs.appendFileSync(path.join(temporary, `${model}.txt`), '\n# integrity test\n');
  process.env.QUANT_MODEL_DIR = temporary;
  await assert.rejects(() => computeDay(loaded, '2014-07-23'), /분석 자료/);
});
