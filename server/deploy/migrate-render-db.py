#!/usr/bin/env python3
"""User-run PostgreSQL 16 migration. Never deletes or changes the source DB.

Requires Docker Desktop. Credentials are prompted privately and passed by
environment, never saved in the archive, command arguments, or manifest.
"""
import argparse
import contextlib
import datetime as dt
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit

SOURCE_ID = "dpg-db6bk48473hc73dt7ss0-a"
IMAGE = "postgres:16"
CONTAINER_CA_FILE = '/etc/ssl/certs/ca-certificates.crt'
SYSTEM_CA_FILES = (Path('/etc/ssl/cert.pem'), Path('/etc/ssl/certs/ca-certificates.crt'))
ROOT = Path(__file__).resolve().parents[2]
TABLES_SQL = """SELECT json_build_array(schemaname, tablename)::text
FROM pg_tables WHERE schemaname <> 'information_schema'
AND schemaname NOT LIKE 'pg_%' ORDER BY schemaname, tablename;"""


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def trusted_ca_bundle():
    """Use a public system trust bundle; never weaken TLS if it is absent."""
    for candidate in SYSTEM_CA_FILES:
        try:
            path = candidate.resolve(strict=True)
            if not path.is_file():
                continue
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.load_verify_locations(cafile=str(path))
            if context.cert_store_stats().get('x509_ca', 0):
                return path
        except (OSError, ValueError, ssl.SSLError):
            continue
    raise RuntimeError('공개 시스템 루트 인증서 묶음을 찾거나 검증하지 못했습니다. TLS 검증을 유지한 채 작업을 중단합니다.')


class RenderConnection:
    def __init__(self, value, source):
        parsed = urlsplit(value.strip())
        host = parsed.hostname or ''
        if (parsed.scheme not in ('postgres', 'postgresql')
                or not host.endswith('.render.com')
                or not host.startswith('dpg-')
                or not parsed.username or not parsed.password
                or not parsed.path.strip('/') or parsed.port not in (None, 5432)
                or parsed.query or parsed.fragment):
            raise ValueError('Render의 External Database URL 원문을 입력하세요.')
        is_source = host.startswith(SOURCE_ID + '.')
        if source != is_source:
            raise ValueError('원본 DB와 새 DB의 대상이 일치하지 않습니다. 작업을 중단했습니다.')
        self.ca_bundle = trusted_ca_bundle()
        self.host = host
        self.database = unquote(parsed.path[1:])
        self.password = unquote(parsed.password)
        self.environment = {
            'PGHOST': host, 'PGPORT': '5432',
            'PGUSER': unquote(parsed.username), 'PGPASSWORD': self.password,
            'PGDATABASE': self.database, 'PGCONNECT_TIMEOUT': '20',
            'PGSSLMODE': 'verify-full',
            'PGSSLROOTCERT': CONTAINER_CA_FILE,
        }

    def command(self, *args, name=None):
        command = ['docker', 'run', '--rm', '-i', '--mount',
                   f'type=bind,source={self.ca_bundle},target={CONTAINER_CA_FILE},readonly']
        if name:
            command += ['--name', name]
        for key in self.environment:
            command += ['-e', key]
        return command + [IMAGE, *args]

    def run(self, *args, **kwargs):
        return subprocess.run(self.command(*args),
                              env={**os.environ, **self.environment},
                              check=True, **kwargs)


class Snapshot:
    """Keeps the same read-only MVCC snapshot for counts and pg_dump."""
    def __init__(self, connection):
        self.connection = connection
        self.name = 'antsurvival-snapshot-' + secrets.token_hex(6)
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(
            self.connection.command('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', name=self.name),
            env={**os.environ, **self.connection.environment},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        try:
            self.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')
            version = int(self.query('SHOW server_version_num;')[0])
            if not 160000 <= version < 170000:
                raise RuntimeError('원본 PostgreSQL 버전이 16이 아닙니다.')
            self.id = self.query('SELECT pg_export_snapshot();')[0]
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def query(self, sql):
        marker = 'end_' + secrets.token_hex(12)
        self.process.stdin.write(sql + "\nSELECT '" + marker + "';\n")
        self.process.stdin.flush()
        rows = []
        # psql's ON_ERROR_STOP closes stdout on errors, preventing false success.
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError('DB 읽기 연결이 종료되었습니다. IP 허용 설정과 접속 주소를 확인하세요.')
            line = line.rstrip('\n')
            if line == marker:
                return rows
            rows.append(line)

    def counts(self):
        tables = [json.loads(row) for row in self.query(TABLES_SQL)]
        result = []
        for schema, table in tables:
            name = quote_identifier(schema) + '.' + quote_identifier(table)
            count = int(self.query(f'SELECT count(*) FROM {name};')[0])
            result.append({'schema': schema, 'table': table, 'rows': count})
        return result

    def __exit__(self, *_):
        if self.process:
            if self.process.poll() is None:
                with contextlib.suppress(BrokenPipeError):
                    self.process.stdin.write('ROLLBACK;\n\\q\n')
                    self.process.stdin.flush()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
            subprocess.run(['docker', 'rm', '-f', self.name],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class RestoreVerifier:
    """Restores into a disposable, private local container; exposes no ports."""
    def __init__(self):
        self.name = 'antsurvival-restore-check-' + secrets.token_hex(6)

    def sql(self, query):
        return subprocess.check_output(
            ['docker', 'exec', self.name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
             '-U', 'postgres', '-d', 'restore_check', '-c', query], text=True).strip()

    def verify(self, archive, expected, extra_checks=None):
        started = False
        try:
            subprocess.run(['docker', 'run', '--rm', '-d', '--name', self.name,
                            '-e', 'POSTGRES_PASSWORD', IMAGE],
                           env={**os.environ, 'POSTGRES_PASSWORD': secrets.token_hex(32)},
                           check=True, stdout=subprocess.DEVNULL)
            started = True
            for _ in range(120):
                ready = subprocess.run(['docker', 'exec', self.name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('검증용 PostgreSQL 시작 시간이 초과되었습니다.')
            subprocess.run(['docker', 'exec', self.name, 'createdb', '-U', 'postgres',
                            '--template=template0', 'restore_check'], check=True)
            with archive.open('rb') as stream:
                subprocess.run(['docker', 'exec', '-i', self.name, 'pg_restore', '-U', 'postgres',
                                '-d', 'restore_check', '--no-owner', '--no-acl',
                                '--exit-on-error', '--single-transaction'], stdin=stream, check=True)
            actual_tables = [json.loads(row) for row in self.sql(TABLES_SQL).splitlines()]
            if actual_tables != [[r['schema'], r['table']] for r in expected]:
                raise RuntimeError('복원 후 테이블 목록이 원본과 다릅니다.')
            for entry in expected:
                name = quote_identifier(entry['schema']) + '.' + quote_identifier(entry['table'])
                if int(self.sql(f'SELECT count(*) FROM {name};')) != entry['rows']:
                    raise RuntimeError(f'복원 후 행 수가 일치하지 않습니다: {name}')
            if extra_checks is not None:
                extra_checks(self)
        finally:
            if started:
                subprocess.run(['docker', 'rm', '-f', self.name],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Migration:
    def backup(self):
        connection = RenderConnection(getpass.getpass('기존 DB의 External Database URL 붙여넣기 (입력은 숨김): '), True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        folder = ROOT / '.local-db-backups' / (stamp + '-' + secrets.token_hex(3))
        folder.mkdir(parents=True, mode=0o700)
        archive = folder / 'antsurvival.dump'
        manifest_path = folder / 'manifest.json'
        print('전체 DB를 일관된 읽기 전용 스냅샷으로 백업합니다. 원본은 변경하지 않습니다.', flush=True)
        with Snapshot(connection) as snapshot:
            manifest = {'source_id': SOURCE_ID, 'source_host': connection.host,
                        'database': connection.database, 'postgres_major': 16,
                        'snapshot_started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                        'tables': snapshot.counts(), 'verified': False}
            with archive.open('xb') as destination:
                connection.run('pg_dump', '--format=custom', '--no-owner', '--no-acl',
                               '--snapshot=' + snapshot.id, stdout=destination)
                destination.flush()
                os.fsync(destination.fileno())
        manifest.update(bytes=archive.stat().st_size, sha256=digest(archive))
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        print('로컬 임시 DB에 실제 복원하여 모든 테이블의 행 수를 검증합니다.', flush=True)
        RestoreVerifier().verify(archive, manifest['tables'])
        manifest.update(verified=True, verified_at=dt.datetime.now(dt.timezone.utc).isoformat())
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        print(f'BACKUP_VERIFIED\n{manifest_path}\n테이블 {len(manifest["tables"])}개 / {manifest["bytes"]:,} bytes')
        print('이 시점 이후 게임 데이터는 백업에 포함되지 않습니다. DB 삭제 전 최종 백업 시점을 확인하세요.')

    def restore(self, manifest_path):
        manifest = json.loads(manifest_path.read_text())
        archive = manifest_path.parent / 'antsurvival.dump'
        if (manifest.get('source_id') != SOURCE_ID or manifest.get('verified') is not True
                or manifest.get('postgres_major') != 16
                or archive.stat().st_size != manifest.get('bytes')
                or digest(archive) != manifest.get('sha256')):
            raise ValueError('검증된 백업이 아니거나 백업 파일이 변경되었습니다.')
        connection = RenderConnection(getpass.getpass('새 DB의 External Database URL 붙여넣기 (입력은 숨김): '), False)
        # Only a blank replacement database is accepted. The old host is rejected above.
        occupied = connection.run('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
                                 "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                                 "WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';",
                                 capture_output=True, text=True).stdout.strip()
        if occupied != '0':
            raise ValueError('새 DB가 비어 있지 않아 복원을 중단했습니다.')
        version = connection.run('psql', '-X', '-qAt', '-c', 'SHOW server_version_num;',
                                 capture_output=True, text=True).stdout.strip()
        if not 160000 <= int(version) < 170000:
            raise ValueError('대상 PostgreSQL 버전은 16이어야 합니다.')
        with archive.open('rb') as source:
            connection.run('pg_restore', '--dbname=' + connection.database, '--no-owner', '--no-acl',
                           '--exit-on-error', '--single-transaction', stdin=source)
        with Snapshot(connection) as snapshot:
            if snapshot.counts() != manifest['tables']:
                raise RuntimeError('새 DB에 복원된 데이터의 테이블/행 수가 일치하지 않습니다.')
        print('RESTORE_VERIFIED — 새 DB의 모든 테이블/행 수가 백업과 일치합니다.')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('backup', help='원본 전체 백업 + 로컬 실제 복원 검증')
    restore = commands.add_parser('restore', help='검증된 백업을 비어 있는 새 Render DB에 복원')
    restore.add_argument('manifest', type=Path)
    args = parser.parse_args()
    trusted_ca_bundle()
    subprocess.run(['docker', 'info'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    image = subprocess.run(['docker', 'image', 'inspect', IMAGE],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if image.returncode:
        subprocess.run(['docker', 'pull', IMAGE], check=True)
    if args.command == 'backup':
        Migration().backup()
    else:
        Migration().restore(args.manifest.resolve())


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n중단했습니다. 원본 DB는 변경하지 않았습니다.', file=sys.stderr)
        sys.exit(130)
    except (ValueError, RuntimeError, subprocess.CalledProcessError, FileNotFoundError) as error:
        # Never echo the connection URL or command environment on failure.
        print('실패: ' + (str(error) if isinstance(error, (ValueError, RuntimeError))
                        else 'Docker 실행/DB 연결/백업 검증에 실패했습니다. 위 오류를 확인하세요.'), file=sys.stderr)
        sys.exit(1)
