const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { getPgTools, extractBundle, validateManifest, verifyFiles } = require('./pg-client.cjs');
const supported = process.platform === 'linux' && process.arch === 'x64';
const manifestPromise = fs.readFile(path.join(__dirname, 'pg-client.manifest.json'), 'utf8').then(JSON.parse);

test('client manifest requires pinned versions, loader, safe paths and file hashes', async () => {
  const manifest = await manifestPromise;
  assert.equal(validateManifest(manifest), manifest);
  for (const bad of [
    { ...manifest, postgresMajor: 17 },
    { ...manifest, files: { ...manifest.files, '../escape': manifest.files['bin/pg_dump'] } },
    { ...manifest, archive: { ...manifest.archive, sha256: 'invalid' } },
  ]) assert.throws(() => validateManifest(bad), /manifest/);
});

test('only pg_dump and pg_restore can be requested', async () => {
  await assert.rejects(getPgTools('psql'), /Unsupported/);
  await assert.rejects(getPgTools('../pg_dump'), /Unsupported/);
});

test('non-Linux/x64 hosts cannot accidentally execute another architecture', { skip: supported }, async () => {
  await assert.rejects(getPgTools('pg_dump'), /Linux x64/);
});

test('bundled loader runs both real PG16 clients and concurrent calls share extraction', { skip: !supported }, async () => {
  const [dump, restore, again] = await Promise.all([getPgTools('pg_dump'), getPgTools('pg_restore'), getPgTools('pg_dump')]);
  assert.deepEqual(dump, again);
  assert.equal(dump.command, restore.command);
  assert.equal(dump.argsPrefix[0], '--inhibit-cache');
  for (const [name, tool] of [['pg_dump', dump], ['pg_restore', restore]]) {
    const { stdout } = await execFile(tool.command, [...tool.argsPrefix, '--version']);
    assert.match(stdout, new RegExp(`^${name} \\(PostgreSQL\\) 16\\.`));
  }
});

test('archive corruption is rejected before extraction', { skip: !supported }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-client-corrupt-test-'));
  try {
    const manifest = await manifestPromise;
    await fs.copyFile(path.join(__dirname, 'pg-client.manifest.json'), path.join(directory, 'pg-client.manifest.json'));
    const bytes = await fs.readFile(path.join(__dirname, manifest.archive.file));
    bytes[bytes.length - 10] ^= 1;
    await fs.writeFile(path.join(directory, manifest.archive.file), bytes);
    await assert.rejects(extractBundle({ bundleDir: directory }), /archive SHA256 mismatch/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('extracted executable tampering is rejected without invoking it', { skip: !supported }, async () => {
  const extracted = await extractBundle();
  try {
    const filename = path.join(extracted.directory, 'bin', 'pg_restore');
    const bytes = await fs.readFile(filename);
    bytes[bytes.length - 1] ^= 1;
    await fs.writeFile(filename, bytes);
    await assert.rejects(verifyFiles(extracted.directory, extracted.manifest), /integrity/);
  } finally { await fs.rm(extracted.directory, { recursive: true, force: true }); }
});
