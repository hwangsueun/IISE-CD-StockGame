#!/usr/bin/env python3
"""Run the real maintenance server, native HTTPS client and PG tools locally.

All source/target DB identifiers below are private Docker DNS aliases. Existing
application containers and all external databases are excluded from this test.
The source alias deliberately exercises the production binding validator.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('client_roundtrip_fixture', BASE / 'test-pg-client-roundtrip.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
SOURCE = 'dpg-db6bk48473hc73dt7ss0-a'
TARGET = 'dpg-testmigration-a'
NODE_IMAGE = 'docker.io/library/node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d'
SERVER = r'''
const fs=require('node:fs');
const https=require('node:https');
const {createMigrationServer}=require('/runtime/deploy/migration-server.cjs');
const config=JSON.parse(fs.readFileSync('/review/config.json','utf8'));
const key=fs.readFileSync('/review/localhost.key');
const cert=fs.readFileSync('/review/localhost.crt');
const handlers=[];
for(const [mode,port] of [['export',8443],['restore',8444]]){
 const maintenance=createMigrationServer({env:config[mode]});
 // Exercise the exact production request handler behind local, verified TLS.
 const server=https.createServer({key,cert},maintenance.listeners('request')[0]);
 server.requestTimeout=7200000;server.headersTimeout=30000;
 server.on('close',()=>maintenance.emit('close'));
 server.listen(port,'0.0.0.0');handlers.push(server);
}
process.on('SIGTERM',()=>Promise.all(handlers.map(s=>new Promise(r=>s.close(r)))).then(()=>process.exit(0)));
'''


def docker(args, **options):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=120, **options)


def protected_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def test(output_dir):
    output = Path(output_dir).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    output.chmod(0o700)
    workdir = output / 'native-client'
    native = BASE / 'migration-client.py'
    setup = subprocess.run([sys.executable, str(native), '--workdir', str(workdir), 'setup'],
                           check=True, capture_output=True, text=True, timeout=30)
    json.loads(setup.stdout)
    token = (workdir / 'migration-token').read_text().strip()
    public = (workdir / 'rsa-public.pem').read_text()
    password = uuid.uuid4().hex + uuid.uuid4().hex
    prefix = 'antsurvival-encrypted-test-' + uuid.uuid4().hex[:10]
    network, pg_name, node_name = prefix + '-net', prefix + '-pg', prefix + '-node'
    previous = docker(['ps', '-q']).stdout.splitlines()
    made_network = made_pg = made_node = False
    try:
        # Desktop iCloud placeholders can fail with EDEADLK inside Docker. Stage
        # only the exact runtime files and install the lockfile afresh in Linux.
        runtime = output / 'runtime'
        (runtime / 'deploy').mkdir(parents=True)
        runtime_hashes = {}
        for source, destination in [
            (BASE.parent / 'package.json', runtime / 'package.json'),
            (BASE.parent / 'package-lock.json', runtime / 'package-lock.json'),
            *((BASE / name, runtime / 'deploy' / name) for name in
              ['migration-server.cjs', 'pg-client.cjs', 'pg-client.manifest.json', 'pg-client-linux-x64.tar.gz']),
        ]:
            data = source.read_bytes()
            destination.write_bytes(data)
            if destination.read_bytes() != data:
                raise AssertionError('Runtime staging changed source bytes')
            runtime_hashes[destination.relative_to(runtime).as_posix()] = hashlib.sha256(data).hexdigest()
        installed = docker(['run', '--rm', '--platform=linux/amd64', '-v', f'{runtime}:/runtime',
                            '--entrypoint=npm', NODE_IMAGE, '--prefix', '/runtime', 'ci', '--omit=dev', '--ignore-scripts'])
        (output / 'runtime-install.log').write_text(installed.stdout + installed.stderr)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-keyout', str(output / 'localhost.key'), '-out', str(output / 'localhost.crt'),
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
                       check=True, capture_output=True, timeout=30)
        (output / 'localhost.key').chmod(0o600)
        (output / 'localhost.crt').chmod(0o600)
        # A dedicated bridge permits loopback-only published HTTPS ports for the
        # native client. PostgreSQL itself has no published host port.
        docker(['network', 'create', network])
        made_network = True
        docker(['run', '--detach', '--rm', '--name', pg_name, '--platform=linux/amd64', '--network', network,
                '--network-alias', SOURCE, '--network-alias', TARGET,
                '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev', '-e', 'POSTGRES_PASSWORD=' + password,
                '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256', '-e', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
                fixture.package.IMAGE])
        made_pg = True
        for _ in range(80):
            ready = subprocess.run(['docker', 'exec', pg_name, 'pg_isready', '-h', 'localhost', '-U', 'postgres'],
                                   capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('Disposable server was not ready')
        def sql(database, query):
            return docker(['exec', '-i', pg_name, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                           '-U', 'postgres', '-d', database], input=query).stdout.strip()
        sql('postgres', fixture.DATABASES)
        sql('bundle_source', fixture.FIXTURE + '\nALTER TABLE preserved.parent ADD COLUMN optional_session uuid;\n'
            "UPDATE preserved.parent SET optional_session=session_id WHERE id=1;\n")
        original = json.loads(sql('bundle_source', fixture.SNAPSHOT))
        expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)).isoformat()
        common = {'MIGRATION_TOKEN': token, 'MIGRATION_EXPIRES_AT': expires}
        config = {
            'export': {**common, 'MIGRATION_MODE': 'export', 'MIGRATION_PUBLIC_KEY': public,
                       'DATABASE_URL': f'postgresql://postgres:{password}@{SOURCE}/bundle_source?sslmode=disable'},
            'restore': {**common, 'MIGRATION_MODE': 'restore', 'MIGRATION_TARGET_DB_ID': TARGET,
                        'DATABASE_URL': f'postgresql://postgres:{password}@{TARGET}/bundle_restored?sslmode=disable'},
        }
        protected_json(output / 'config.json', config)
        (output / 'serve.cjs').write_text(SERVER)
        docker(['run', '--detach', '--rm', '--name', node_name, '--platform=linux/amd64', '--network', network,
                '--publish', '127.0.0.1::8443', '--publish', '127.0.0.1::8444', '--read-only',
                '--tmpfs', '/tmp:rw,nosuid,nodev,exec',
                '-v', f'{runtime}:/runtime:ro',
                '-v', f'{output}:/review:ro', '--entrypoint=node', NODE_IMAGE, '/review/serve.cjs'])
        made_node = True
        ports = json.loads(docker(['inspect', node_name, '--format', '{{json .NetworkSettings.Ports}}']).stdout)
        bases = {name: 'https://localhost:' + ports[f'{port}/tcp'][0]['HostPort'] for name, port in [('export', 8443), ('restore', 8444)]}
        context = ssl.create_default_context(cafile=str(output / 'localhost.crt'))
        def http(base, route, authorized=True):
            request = urllib.request.Request(base + route, headers={'Authorization': 'Bearer ' + token} if authorized else {})
            with urllib.request.urlopen(request, context=context, timeout=10) as response:
                return json.loads(response.read())
        for _ in range(80):
            try:
                if http(bases['export'], '/health', False).get('maintenance'):
                    break
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError('Disposable HTTPS maintenance server was not ready')
        def client(action, base):
            command = [sys.executable, str(native), '--workdir', str(workdir), action, '--base-url', base,
                       '--ca-file', str(output / 'localhost.crt')]
            if action == 'restore':
                command.extend(['--target-id', TARGET])
            proc = subprocess.run(command, capture_output=True, text=True, timeout=240)
            (output / (action + '.stdout')).write_text(proc.stdout)
            (output / (action + '.stderr')).write_text(proc.stderr)
            if proc.returncode:
                try:
                    http(base, '/migration/export')
                except urllib.error.HTTPError as error:
                    (output / (action + '-error-response.json')).write_bytes(error.read(8192))
                raise RuntimeError(f'Native {action} failed: {proc.stdout[-2000:]} {proc.stderr[-1000:]}')
            return json.loads(proc.stdout)
        if http(bases['restore'], '/migration/target')['empty'] is not True:
            raise AssertionError('Initial fixture target is not empty')
        sql('bundle_restored', 'SELECT lo_create(54321);')
        if http(bases['restore'], '/migration/target')['empty'] is not False:
            raise AssertionError('A target containing a large object was accepted as empty')
        sql('bundle_restored', 'SELECT lo_unlink(54321);')
        exported = client('export', bases['export'])
        restored_response = client('restore', bases['restore'])
        restored = json.loads(sql('bundle_restored', fixture.SNAPSHOT))
        if restored != original:
            raise AssertionError('The full encrypted migration changed the independent fixture snapshot')
        source_status = http(bases['export'], '/migration/status')
        target_status = http(bases['restore'], '/migration/status')
        if source_status['state'] != 'exported' or target_status['state'] != 'restored' or not target_status['used']:
            raise AssertionError('Unexpected final maintenance state')
        backup = (workdir / 'export.antpgm').read_bytes()
        if not backup.startswith(b'ANTPGM1\n') or b'PGDMP' in backup:
            raise AssertionError('Native backup is not the encrypted protocol envelope')
        result = {
            'passed': True, 'nodeVersion': docker(['exec', node_name, 'node', '-p', 'process.version']).stdout.strip(),
            'nativeClient': str(native), 'actualMaintenanceModule': str(BASE / 'migration-server.cjs'),
            'strictDatabaseBindings': {'source': SOURCE, 'target': TARGET, 'scope': 'private Docker aliases only'},
            'transport': 'HTTPS with verified localhost SAN certificate', 'databaseAuthentication': 'SCRAM-SHA-256',
            'encryptedEnvelope': 'RSA-OAEP-SHA256+A256GCM',
            'independentSourceAndTargetSnapshotSha256': hashlib.sha256(json.dumps(original, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
            'sourceState': source_status['state'], 'targetState': target_status['state'],
            'targetOneUse': target_status['used'], 'nativeExport': exported, 'nativeRestore': restored_response,
            'largeObjectTargetRejected': True, 'runtimeFileHashes': runtime_hashes,
            'existingContainersBefore': previous,
        }
        protected_json(output / 'result.json', result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception:
        if made_node:
            (output / 'node-fixture.log').write_text(docker(['logs', node_name]).stdout)
        raise
    finally:
        for made, name in [(made_node, node_name), (made_pg, pg_name)]:
            if made:
                subprocess.run(['docker', 'rm', '--force', name], capture_output=True, timeout=30)
        if made_network:
            subprocess.run(['docker', 'network', 'rm', network], capture_output=True, timeout=30)
        after = docker(['ps', '-q']).stdout.splitlines()
        if sorted(previous) != sorted(after):
            raise RuntimeError('Existing-container inventory changed unexpectedly')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', default='/tmp/antsurvival-pg-client-review/encrypted-roundtrip')
    test(parser.parse_args().output_dir)
