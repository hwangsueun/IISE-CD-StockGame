#!/usr/bin/env python3
"""Authenticated, encrypted HTTPS transport for the existing migration service.

Private RSA material stays in the protected local work directory. No database
credentials are needed. A full local PostgreSQL restore must succeed before an
archive can be uploaded to the explicitly bound empty replacement database.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import struct
import subprocess
import sys
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


MAGIC = b'ANTPGM1\n'
ALG = 'RSA-OAEP-SHA256+A256GCM'
CHUNK = 1024 * 1024
MAX_HEADER = 8192
MAX_MANIFEST = 1024 * 1024
MAX_WIRE = 1024 * 1024 * 1024
TAG_BYTES = 16
SOURCE_ID = 'dpg-db6bk48473hc73dt7ss0-a'
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORKDIR = Path.home() / '.local/share/antsurvival/backups/migration-20261110'
HEADER_FIELDS = {'version', 'alg', 'nonce', 'wrappedKey', 'recipient', 'ciphertextLength'}


class MigrationError(RuntimeError):
    pass


def sha256_file(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(CHUNK):
            result.update(block)
    return result.hexdigest()


def private_write(path, content, exclusive=False):
    path = Path(path)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def private_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(4) + '.tmp')
    try:
        private_write(temporary, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode(), exclusive=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def protected_file(path):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise MigrationError('A local migration file has unsafe permissions or is not a regular file.')
    return Path(path)


def public_fingerprint(key):
    der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


def rsa_public(pem):
    try:
        key = serialization.load_pem_public_key(pem)
    except (TypeError, ValueError):
        raise MigrationError('Invalid migration public key.') from None
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 3072:
        raise MigrationError('The migration recipient must use RSA-3072.')
    return key


def setup(workdir):
    workdir = Path(workdir)
    workdir.mkdir(parents=True, mode=0o700, exist_ok=True)
    if workdir.is_symlink():
        raise MigrationError('The migration directory cannot be a symbolic link.')
    workdir.chmod(0o700)
    paths = [workdir / name for name in ('rsa-private.pem', 'rsa-public.pem', 'migration-token')]
    if any(path.exists() for path in paths):
        if not all(path.exists() for path in paths):
            raise MigrationError('An incomplete identity already exists; existing key material was preserved.')
        key, _ = load_identity(workdir)
    else:
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        private_write(paths[0], key.private_bytes(serialization.Encoding.PEM,
                      serialization.PrivateFormat.PKCS8, serialization.NoEncryption()), exclusive=True)
        private_write(paths[1], key.public_key().public_bytes(serialization.Encoding.PEM,
                      serialization.PublicFormat.SubjectPublicKeyInfo), exclusive=True)
        private_write(paths[2], secrets.token_hex(32).encode(), exclusive=True)
    result = {'prepared': True, 'workdir': str(workdir.resolve()),
              'publicKeyPath': str(paths[1].resolve()), 'tokenPath': str(paths[2].resolve()),
              'privateKeyPath': str(paths[0].resolve()), 'publicKeyFingerprint': public_fingerprint(key.public_key())}
    private_json(workdir / 'identity.json', result)
    return result


def load_identity(workdir):
    workdir = Path(workdir)
    if workdir.is_symlink() or workdir.stat().st_mode & 0o077:
        raise MigrationError('The migration directory must be private (0700).')
    try:
        key = serialization.load_pem_private_key(protected_file(workdir / 'rsa-private.pem').read_bytes(), password=None)
    except (TypeError, ValueError):
        raise MigrationError('The protected local private key is invalid.') from None
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 3072:
        raise MigrationError('The protected local key must use RSA-3072.')
    public = rsa_public(protected_file(workdir / 'rsa-public.pem').read_bytes())
    if public_fingerprint(public) != public_fingerprint(key.public_key()):
        raise MigrationError('Local public and private keys do not match.')
    token = protected_file(workdir / 'migration-token').read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{64}', token):
        raise MigrationError('The protected local migration token is invalid.')
    return key, token


def json_object(data):
    def invalid_constant(_):
        raise MigrationError('Nonstandard JSON constants are forbidden.')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise MigrationError('Duplicate JSON fields are forbidden.')
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeDecodeError):
        raise MigrationError('Invalid migration JSON.') from None
    if not isinstance(value, dict):
        raise MigrationError('Migration JSON must be an object.')
    return value


def integer(value, minimum=0, maximum=MAX_WIRE):
    return type(value) is int and minimum <= value <= maximum


def identifier(value):
    return isinstance(value, str) and 0 < len(value.encode()) <= 63 and '\x00' not in value


def decimal_count(value):
    return isinstance(value, str) and re.fullmatch(r'(?:0|[1-9][0-9]*)', value) is not None


def validate_manifest(manifest):
    if (type(manifest.get('version')) is not int or manifest.get('version') != 1 or manifest.get('format') != 'pg_dump-custom'
            or manifest.get('sourceDbId') != SOURCE_ID or manifest.get('serverMajor') != 16
            or not isinstance(manifest.get('serverVersion'), str)
            or not integer(manifest.get('archiveBytes'), 5)
            or not re.fullmatch(r'[0-9a-f]{64}', str(manifest.get('archiveSha256', '')))):
        raise MigrationError('The authenticated snapshot manifest is invalid or identifies a different source.')
    tables, seen = manifest.get('tableCounts'), set()
    if not isinstance(tables, list) or not tables:
        raise MigrationError('The authenticated manifest has no table inventory.')
    for row in tables:
        if (not isinstance(row, dict) or not identifier(row.get('schema')) or not identifier(row.get('table'))
                or not decimal_count(row.get('count')) or (row['schema'], row['table']) in seen):
            raise MigrationError('Invalid or duplicated table counts in the authenticated manifest.')
        seen.add((row['schema'], row['table']))
    checks, uuid_seen = manifest.get('uuidChecks'), set()
    if not isinstance(checks, list):
        raise MigrationError('Invalid UUID verification inventory.')
    for check in checks:
        if (not isinstance(check, dict) or not all(identifier(check.get(k)) for k in ('schema', 'table', 'column'))
                or not decimal_count(check.get('totalCount'))
                or not re.fullmatch(r'[0-9a-f]{64}', str(check.get('sha256', '')))
                or (check['schema'], check['table']) not in seen
                or next(r['count'] for r in tables if (r['schema'], r['table']) == (check['schema'], check['table'])) != check['totalCount']
                or (check['schema'], check['table'], check['column']) in uuid_seen):
            raise MigrationError('Invalid UUID fingerprint in the authenticated manifest.')
        uuid_seen.add((check['schema'], check['table'], check['column']))
    return manifest


def read_exact(stream, length):
    parts, remaining = [], length
    while remaining:
        data = stream.read(remaining)
        if not data:
            raise MigrationError('The encrypted migration payload is truncated.')
        parts.append(data)
        remaining -= len(data)
    return b''.join(parts)


def read_header(stream, expected_recipient):
    prefix = read_exact(stream, 12)
    if prefix[:8] != MAGIC:
        raise MigrationError('Unknown encrypted migration format.')
    size = struct.unpack('>I', prefix[8:])[0]
    if not 1 <= size <= MAX_HEADER:
        raise MigrationError('Invalid encrypted header size.')
    raw = read_exact(stream, size)
    header = json_object(raw)
    if (set(header) != HEADER_FIELDS or type(header.get('version')) is not int or header.get('version') != 1 or header.get('alg') != ALG
            or header.get('recipient') != expected_recipient
            or not integer(header.get('ciphertextLength'), 9)):
        raise MigrationError('Encrypted payload parameters or recipient do not match.')
    try:
        nonce = base64.b64decode(header['nonce'], validate=True)
        wrapped = base64.b64decode(header['wrappedKey'], validate=True)
    except (ValueError, TypeError):
        raise MigrationError('Invalid encrypted payload key encoding.') from None
    if len(nonce) != 12 or len(wrapped) != 384:
        raise MigrationError('Invalid RSA/AES parameter lengths.')
    return header, prefix + raw, nonce, wrapped


def encrypt_archive(archive, manifest, public_pem, destination, maximum=MAX_WIRE):
    archive, destination = Path(archive), Path(destination)
    validate_manifest(manifest)
    if archive.stat().st_size != manifest['archiveBytes']:
        raise MigrationError('The archive size changed before encryption.')
    public = rsa_public(public_pem)
    encoded_manifest = json.dumps(manifest, separators=(',', ':'), ensure_ascii=False).encode()
    if len(encoded_manifest) > MAX_MANIFEST:
        raise MigrationError('Snapshot manifest exceeds the protocol limit.')
    key, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
    wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    header = {'version': 1, 'alg': ALG, 'nonce': base64.b64encode(nonce).decode(),
              'wrappedKey': base64.b64encode(wrapped).decode(), 'recipient': public_fingerprint(public),
              'ciphertextLength': 4 + len(encoded_manifest) + manifest['archiveBytes']}
    raw_header = json.dumps(header, separators=(',', ':')).encode()
    aad = MAGIC + struct.pack('>I', len(raw_header)) + raw_header
    if len(aad) + header['ciphertextLength'] + TAG_BYTES > maximum:
        raise MigrationError('Encrypted archive exceeds the target upload limit.')
    temporary = destination.with_name(destination.name + '.' + secrets.token_hex(4) + '.tmp')
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(aad)
    checksum = hashlib.sha256()
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as target, archive.open('rb') as source:
            target.write(aad)
            target.write(encryptor.update(struct.pack('>I', len(encoded_manifest)) + encoded_manifest))
            while block := source.read(CHUNK):
                checksum.update(block)
                target.write(encryptor.update(block))
            target.write(encryptor.finalize())
            target.write(encryptor.tag)
            target.flush()
            os.fsync(target.fileno())
        if checksum.hexdigest() != manifest['archiveSha256']:
            raise MigrationError('The archive changed during encryption.')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return header


def decrypt_export(encrypted, private_key, workdir):
    workdir = Path(workdir)
    plaintext = workdir / ('unverified-' + secrets.token_hex(6) + '.tmp')
    archive_temp = workdir / ('archive-' + secrets.token_hex(6) + '.tmp')
    try:
        if Path(encrypted).stat().st_size > MAX_WIRE:
            raise MigrationError('Encrypted export exceeds the client size limit.')
        with Path(encrypted).open('rb') as source:
            header, aad, nonce, wrapped = read_header(source, public_fingerprint(private_key.public_key()))
            try:
                key = private_key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
            except ValueError:
                raise MigrationError('The payload cannot be decrypted with this local identity.') from None
            if len(key) != 32:
                raise MigrationError('Invalid AES-256 key length.')
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).decryptor()
            decryptor.authenticate_additional_data(aad)
            descriptor = os.open(plaintext, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as target:
                remaining = header['ciphertextLength']
                while remaining:
                    block = read_exact(source, min(CHUNK, remaining))
                    target.write(decryptor.update(block))
                    remaining -= len(block)
                tag = read_exact(source, TAG_BYTES)
                if source.read(1):
                    raise MigrationError('Trailing bytes after the authenticated payload.')
                try:
                    target.write(decryptor.finalize_with_tag(tag))
                except InvalidTag:
                    raise MigrationError('Encrypted migration authentication failed.') from None
                target.flush()
                os.fsync(target.fileno())
        with plaintext.open('rb') as source:
            manifest_size = struct.unpack('>I', read_exact(source, 4))[0]
            if not 1 <= manifest_size <= MAX_MANIFEST:
                raise MigrationError('Invalid authenticated manifest size.')
            manifest = validate_manifest(json_object(read_exact(source, manifest_size)))
            checksum, total = hashlib.sha256(), 0
            descriptor = os.open(archive_temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as target:
                signature = read_exact(source, 5)
                if signature != b'PGDMP':
                    raise MigrationError('The decrypted archive is not a native custom pg_dump archive.')
                checksum.update(signature)
                target.write(signature)
                total = 5
                while block := source.read(CHUNK):
                    checksum.update(block)
                    total += len(block)
                    target.write(block)
                target.flush()
                os.fsync(target.fileno())
            if total != manifest['archiveBytes'] or checksum.hexdigest() != manifest['archiveSha256']:
                raise MigrationError('Authenticated archive size or SHA-256 mismatch.')
        destination = workdir / 'antsurvival.dump'
        archive_temp.replace(destination)
        private_json(workdir / 'snapshot-manifest.json', manifest)
        return manifest
    finally:
        plaintext.unlink(missing_ok=True)
        archive_temp.unlink(missing_ok=True)


def load_verifier_module():
    path = Path(__file__).with_name('migrate-render-db.py')
    spec = importlib.util.spec_from_file_location('render_migration_verifier', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextlib.contextmanager
def private_diagnostics(workdir):
    """Child tools may report row values on errors; keep diagnostics on disk."""
    descriptor = os.open(Path(workdir) / 'verification-diagnostics.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.fchmod(descriptor, 0o600)
    saved = os.dup(1), os.dup(2)
    try:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(descriptor, 1)
        os.dup2(descriptor, 2)
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        os.close(saved[0])
        os.close(saved[1])
        os.close(descriptor)


def verify_uuid_columns(verifier, checks):
    quote = load_verifier_module().quote_identifier
    for check in checks:
        column = quote(check['column'])
        table = quote(check['schema']) + '.' + quote(check['table'])
        query = f"SELECT COALESCE({column}::text, chr(92)||'N') FROM {table} ORDER BY {column} NULLS FIRST;"
        process = subprocess.Popen(['docker', 'exec', verifier.name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                    '-U', 'postgres', '-d', 'restore_check', '-c', query], stdout=subprocess.PIPE)
        checksum, count = hashlib.sha256(), 0
        try:
            for line in process.stdout:
                if line != b'\\N\n' and not re.fullmatch(rb'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n', line):
                    raise MigrationError('Unexpected data type in restored UUID verification.')
                checksum.update(line)
                count += 1
            if process.wait() != 0 or str(count) != check['totalCount'] or checksum.hexdigest() != check['sha256']:
                raise MigrationError('Restored UUID values do not match the source snapshot.')
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.terminate()
                process.wait()


def verify_local(workdir, additional_checks=None):
    workdir = Path(workdir)
    archive = protected_file(workdir / 'antsurvival.dump')
    manifest = validate_manifest(json_object(protected_file(workdir / 'snapshot-manifest.json').read_bytes()))
    if archive.stat().st_size != manifest['archiveBytes'] or sha256_file(archive) != manifest['archiveSha256']:
        raise MigrationError('The archive differs from the authenticated snapshot.')
    marker = workdir / 'local-verification.json'
    marker.unlink(missing_ok=True)
    expected = sorted([{'schema': r['schema'], 'table': r['table'], 'rows': int(r['count'])}
                       for r in manifest['tableCounts']], key=lambda r: (r['schema'], r['table']))
    module = load_verifier_module()
    def extra(verifier):
        verify_uuid_columns(verifier, manifest.get('uuidChecks', []))
        if additional_checks:
            additional_checks(verifier)
    with private_diagnostics(workdir):
        try:
            module.RestoreVerifier().verify(archive, expected, extra_checks=extra)
        except Exception:
            raise MigrationError('Full local restore verification failed; protected diagnostics were retained.') from None
    result = {'verified': True, 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'sourceDbId': SOURCE_ID, 'archiveSha256': manifest['archiveSha256'],
              'archiveBytes': manifest['archiveBytes'], 'manifestSha256': sha256_file(workdir / 'snapshot-manifest.json'),
              'tableCount': len(expected), 'uuidColumnCount': len(manifest.get('uuidChecks', [])),
              'verifierSha256': sha256_file(Path(__file__).with_name('migrate-render-db.py'))}
    private_json(marker, result)
    return result


def require_verified(workdir):
    workdir = Path(workdir)
    marker = json_object(protected_file(workdir / 'local-verification.json').read_bytes())
    manifest = validate_manifest(json_object(protected_file(workdir / 'snapshot-manifest.json').read_bytes()))
    archive = protected_file(workdir / 'antsurvival.dump')
    if (marker.get('verified') is not True or marker.get('sourceDbId') != SOURCE_ID
            or marker.get('archiveSha256') != manifest['archiveSha256']
            or marker.get('manifestSha256') != sha256_file(workdir / 'snapshot-manifest.json')
            or archive.stat().st_size != manifest['archiveBytes'] or sha256_file(archive) != manifest['archiveSha256']):
        raise MigrationError('A full verified local restore is required before upload.')
    return manifest


class MigrationTransport:
    def __init__(self, base_url, token, timeout=900, context=None):
        parsed = urlsplit(base_url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise MigrationError('The migration endpoint must be an HTTPS origin without credentials or a path.')
        self.host, self.port = parsed.hostname, parsed.port or 443
        self.token, self.timeout = token, timeout
        self.context = context or ssl.create_default_context(cafile=str(load_verifier_module().trusted_ca_bundle()))
        if self.context.verify_mode != ssl.CERT_REQUIRED or not self.context.check_hostname:
            raise MigrationError('HTTPS certificate and hostname verification must remain enabled.')

    def connection(self):
        return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=self.context)

    def get(self, endpoint, destination=None):
        connection = self.connection()
        try:
            connection.request('GET', endpoint, headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/octet-stream' if destination else 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                raise MigrationError(f'Migration endpoint returned HTTP {response.status}; no redirects were followed.')
            if destination:
                destination = Path(destination)
                temporary = destination.with_name(destination.name + '.download.tmp')
                total = 0
                try:
                    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(descriptor, 'wb') as target:
                        while block := response.read(CHUNK):
                            total += len(block)
                            if total > MAX_WIRE:
                                raise MigrationError('Encrypted export exceeds the client size limit.')
                            target.write(block)
                        target.flush()
                        os.fsync(target.fileno())
                    temporary.replace(destination)
                    return total
                finally:
                    temporary.unlink(missing_ok=True)
            body = response.read(MAX_MANIFEST + 1)
            if len(body) > MAX_MANIFEST:
                raise MigrationError('Migration metadata is too large.')
            return json_object(body)
        except MigrationError:
            raise
        except Exception:
            raise MigrationError('The authenticated HTTPS migration request failed.') from None
        finally:
            connection.close()

    def upload(self, payload):
        payload = Path(payload)
        connection = self.connection()
        try:
            connection.putrequest('POST', '/migration/restore')
            connection.putheader('Authorization', 'Bearer ' + self.token)
            connection.putheader('Content-Type', 'application/octet-stream')
            connection.putheader('Content-Length', str(payload.stat().st_size))
            connection.endheaders()
            with payload.open('rb') as source:
                while block := source.read(CHUNK):
                    connection.send(block)
            response = connection.getresponse()
            if response.status != 200:
                raise MigrationError(f'Encrypted restore returned HTTP {response.status}.')
            body = response.read(MAX_MANIFEST + 1)
            if len(body) > MAX_MANIFEST:
                raise MigrationError('Restore response is too large.')
            return json_object(body)
        except MigrationError:
            raise
        except Exception:
            raise MigrationError('The encrypted HTTPS restore request failed; confirm target status before any retry.') from None
        finally:
            connection.close()


def validate_target(target, target_id, server_major):
    if (not re.fullmatch(r'dpg-[a-z0-9-]+', target_id) or target_id == SOURCE_ID
            or target.get('targetDbId') != target_id or target.get('empty') is not True
            or target.get('serverMajor') != server_major
            or not integer(target.get('maxUploadBytes'), 1)):
        raise MigrationError('The replacement target is not empty, correctly bound, or version-compatible.')
    public = rsa_public(str(target.get('publicKey', '')).encode())
    if public_fingerprint(public) != target.get('keyFingerprint'):
        raise MigrationError('The target public-key fingerprint does not match.')
    try:
        expires = dt.datetime.fromisoformat(target['expiresAt'].replace('Z', '+00:00'))
    except (KeyError, ValueError, TypeError):
        raise MigrationError('Invalid target expiry.') from None
    now = dt.datetime.now(dt.timezone.utc)
    if expires.tzinfo is None or not now < expires <= now + dt.timedelta(hours=2, minutes=1):
        raise MigrationError('The target migration window has expired or is invalid.')
    return public


def export_and_verify(workdir, transport):
    workdir = Path(workdir)
    key, _ = load_identity(workdir)
    if (workdir / 'local-verification.json').exists():
        raise MigrationError('A verified backup already exists; it was preserved.')
    encrypted = workdir / 'export.antpgm'
    if not encrypted.exists():
        transport.get('/migration/export', encrypted)
    decrypt_export(protected_file(encrypted), key, workdir)
    return verify_local(workdir)


def restore_verified(workdir, transport, target_id):
    workdir = Path(workdir)
    manifest = require_verified(workdir)
    target = transport.get('/migration/target')
    validate_target(target, target_id, manifest['serverMajor'])
    private_json(workdir / 'restore-target.json', target)
    restore_manifest = {**manifest, 'targetDbId': target_id}
    payload = workdir / 'restore.antpgm'
    encrypt_archive(workdir / 'antsurvival.dump', restore_manifest, target['publicKey'].encode(), payload,
                    maximum=min(MAX_WIRE, target['maxUploadBytes']))
    response = transport.upload(payload)
    if response.get('ok') is not True or response.get('verified') is not True:
        raise MigrationError('The target did not confirm a verified restore.')
    private_json(workdir / 'restore-response.json', response)
    return response


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir', type=Path, default=DEFAULT_WORKDIR)
    subcommands = parser.add_subparsers(dest='command', required=True)
    subcommands.add_parser('setup')
    subcommands.add_parser('verify')
    for name in ('export', 'restore', 'status'):
        command = subcommands.add_parser(name)
        command.add_argument('--base-url', required=True)
        command.add_argument('--timeout', type=int, default=900)
        command.add_argument('--ca-file', type=Path, help='Explicit public CA bundle; certificate and hostname verification remain required')
        if name == 'restore':
            command.add_argument('--target-id', required=True)
    args = parser.parse_args()
    if args.command == 'setup':
        result = setup(args.workdir)
    elif args.command == 'verify':
        load_identity(args.workdir)
        result = verify_local(args.workdir)
    else:
        _, token = load_identity(args.workdir)
        if not 1 <= args.timeout <= 7200:
            raise MigrationError('The HTTPS timeout must be between 1 and 7200 seconds.')
        context = ssl.create_default_context(cafile=str(args.ca_file)) if args.ca_file else None
        transport = MigrationTransport(args.base_url, token, timeout=args.timeout, context=context)
        if args.command == 'status':
            status = transport.get('/migration/status')
            result = {name: status.get(name) for name in ('mode', 'state', 'used', 'expiresAt')}
        elif args.command == 'export':
            result = export_and_verify(args.workdir, transport)
        else:
            response = restore_verified(args.workdir, transport, args.target_id)
            result = {'restoreResponseReceived': True, 'serverConfirmed': response.get('ok') is True and response.get('verified') is True}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(json.dumps({'ok': False, 'error': 'Migration operation interrupted; local backup files were preserved.'}))
        sys.exit(130)
    except MigrationError as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'ok': False, 'error': 'Migration client failed; no private material was printed.'}))
        sys.exit(1)
