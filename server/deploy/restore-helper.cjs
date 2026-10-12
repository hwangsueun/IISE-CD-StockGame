// One-shot local UI for restoring a new Render DB without putting credentials in files or shell args.
// Never run this helper as the public web service.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const tls = require('node:tls');
const { spawn } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');
const [dumpPath, expectedHost] = process.argv.slice(2);
if (!dumpPath || !expectedHost?.endsWith('.render.com') || !fs.statSync(dumpPath).isFile()) throw new Error('Dump and Render host required');
const caPath = path.join(path.dirname(dumpPath), 'render-root-ca.pem');
fs.writeFileSync(caPath, tls.rootCertificates.join('\n'), { mode: 0o644 });
const port = 3199;
const route = `/restore/${crypto.randomBytes(16).toString('hex')}`;
const app = express();
let state = 'ready';
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.get(route, (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>게임 데이터 이전</title>
<h1>게임 데이터 이전</h1><p>대상: ${expectedHost}</p><p>상태: ${state}</p>
${state === 'ready' ? `<form method="post"><label>Render 외부 DB 연결 주소 <input type="password" name="connection" autocomplete="off" required></label><button>빈 DB에 시장 데이터 복원</button></form>` : '<p>이 창에는 접속 비밀번호를 표시하지 않습니다.</p>'}`));
app.post(route, async (req, res) => {
  if (state !== 'ready' || req.get('origin') !== `http://127.0.0.1:${port}`) return res.sendStatus(403);
  let connection;
  try { connection = new URL(req.body.connection); } catch { return res.status(400).send('Invalid connection URL'); }
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || connection.hostname !== expectedHost || connection.pathname !== '/antsurvival') {
    return res.status(400).send('Target does not match the new Render database');
  }
  const config = { host: connection.hostname, port: Number(connection.port || 5432),
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
    database: 'antsurvival', ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15_000 };
  const pool = new Pool(config);
  try {
    const { rows: [result] } = await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    if (result.n !== 0) throw new Error('Target database is not empty');
    await pool.end();
    state = 'importing';
    res.redirect(303, route);
    const child = spawn('docker', ['run', '--rm', '-i',
      '--mount', `type=bind,src=${caPath},dst=/tmp/render-root-ca.pem,readonly`,
      '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE', '-e', 'PGSSLMODE', '-e', 'PGSSLROOTCERT',
      'postgres:16', 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '-d', 'antsurvival'], {
      env: { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user,
        PGPASSWORD: config.password, PGDATABASE: config.database, PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/tmp/render-root-ca.pem' },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let errorText = '';
    child.stderr.on('data', chunk => { errorText += chunk.toString(); });
    fs.createReadStream(dumpPath).pipe(child.stdin);
    child.stdin.on('error', () => {});
    child.on('error', () => { state = 'failed'; console.error('Could not start database restore'); });
    child.on('close', async code => {
      if (code !== 0) {
        state = 'failed';
        console.error('Restore failed:', errorText.replaceAll(config.password, '[redacted]').slice(-3000));
        return;
      }
      const verify = new Pool(config);
      try {
        const { rows } = await verify.query("SELECT 'prices' AS kind,count(*)::text FROM asset_prices UNION ALL SELECT 'users',count(*)::text FROM users UNION ALL SELECT 'sessions',count(*)::text FROM game_sessions");
        state = 'complete';
        console.log(JSON.stringify({ status: state, counts: rows }));
      } catch { state = 'verification_failed'; console.error('Restore completed; verification failed'); }
      finally { await verify.end(); }
    });
  } catch (error) {
    await pool.end().catch(() => {});
    res.status(400).send(error.message === 'Target database is not empty' ? error.message : 'Could not connect to the new database');
  }
});
app.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${route}`));
