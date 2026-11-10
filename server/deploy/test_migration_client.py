import base64
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import ssl
import struct
import tempfile
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


spec = importlib.util.spec_from_file_location('migration_client', Path(__file__).with_name('migration-client.py'))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class MigrationClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.other_private = rsa.generate_private_key(public_exponent=65537, key_size=3072)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.public = self.private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.other_public = self.other_private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.archive = self.directory / 'source.dump'
        self.content = b'PGDMP' + secrets.token_bytes(client.CHUNK * 2 + 19)
        client.private_write(self.archive, self.content)
        self.manifest = {'version': 1, 'format': 'pg_dump-custom', 'sourceDbId': client.SOURCE_ID,
                         'serverMajor': 16, 'serverVersion': '16.14', 'archiveBytes': len(self.content),
                         'archiveSha256': hashlib.sha256(self.content).hexdigest(),
                         'tableCounts': [{'schema': 'public', 'table': 'fixture', 'count': '0'}], 'uuidChecks': []}
        self.encrypted = self.directory / 'export.antpgm'

    def tearDown(self):
        self.temporary.cleanup()

    def forge(self, plaintext, raw_header=None):
        key, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
        wrapped = self.private.public_key().encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        header = {'version': 1, 'alg': client.ALG, 'nonce': base64.b64encode(nonce).decode(),
                  'wrappedKey': base64.b64encode(wrapped).decode(), 'recipient': client.public_fingerprint(self.private.public_key()),
                  'ciphertextLength': len(plaintext)}
        raw = raw_header(header) if raw_header else json.dumps(header, separators=(',', ':')).encode()
        aad = client.MAGIC + struct.pack('>I', len(raw)) + raw
        # Independent one-shot AESGCM API exercises the client's streaming reader.
        client.private_write(self.encrypted, aad + AESGCM(key).encrypt(nonce, plaintext, aad))

    def assert_rejected_without_plaintext(self):
        with self.assertRaises(client.MigrationError):
            client.decrypt_export(self.encrypted, self.private, self.directory)
        self.assertFalse((self.directory / 'antsurvival.dump').exists())
        self.assertFalse((self.directory / 'snapshot-manifest.json').exists())
        self.assertFalse(list(self.directory.glob('*.tmp')))

    def test_identity_permissions_and_repeat_setup_preserve_identity(self):
        workdir = self.directory / 'identity'
        first = client.setup(workdir)
        key_hash = client.sha256_file(workdir / 'rsa-private.pem')
        second = client.setup(workdir)
        self.assertEqual(first['publicKeyFingerprint'], second['publicKeyFingerprint'])
        self.assertTrue(key_hash == client.sha256_file(workdir / 'rsa-private.pem'))
        self.assertEqual(workdir.stat().st_mode & 0o777, 0o700)
        for name in ('rsa-private.pem', 'rsa-public.pem', 'migration-token', 'identity.json'):
            self.assertEqual((workdir / name).stat().st_mode & 0o777, 0o600)
        _, token = client.load_identity(workdir)
        self.assertFalse(token in json.dumps(first))

    def test_streaming_roundtrip_preserves_exact_archive(self):
        client.encrypt_archive(self.archive, self.manifest, self.public, self.encrypted)
        result = client.decrypt_export(self.encrypted, self.private, self.directory)
        self.assertEqual(result, self.manifest)
        self.assertEqual(client.sha256_file(self.directory / 'antsurvival.dump'), self.manifest['archiveSha256'])

    def test_wrong_recipient_never_writes_accepted_plaintext(self):
        client.encrypt_archive(self.archive, self.manifest, self.other_public, self.encrypted)
        self.assert_rejected_without_plaintext()

    def test_ciphertext_and_tag_tampering_fail_authentication(self):
        client.encrypt_archive(self.archive, self.manifest, self.public, self.encrypted)
        original = self.encrypted.read_bytes()
        header_size = struct.unpack('>I', original[8:12])[0]
        for offset in (12 + header_size + 8, len(original) - 1):
            damaged = bytearray(original)
            damaged[offset] ^= 1
            client.private_write(self.encrypted, damaged)
            self.assert_rejected_without_plaintext()

    def test_header_aad_tampering_is_not_accepted(self):
        client.encrypt_archive(self.archive, self.manifest, self.public, self.encrypted)
        damaged = bytearray(self.encrypted.read_bytes())
        header_size = struct.unpack('>I', damaged[8:12])[0]
        raw = bytes(damaged[12:12 + header_size])
        nonce_offset = raw.index(b'"nonce":"') + len(b'"nonce":"') + 12
        damaged[nonce_offset] = ord('B') if damaged[nonce_offset] != ord('B') else ord('C')
        client.private_write(self.encrypted, damaged)
        self.assert_rejected_without_plaintext()

    def test_authenticated_bad_archive_digest_is_rejected(self):
        manifest = {**self.manifest, 'archiveSha256': '0' * 64}
        encoded = json.dumps(manifest).encode()
        self.forge(struct.pack('>I', len(encoded)) + encoded + self.content)
        self.assert_rejected_without_plaintext()

    def test_authenticated_oversized_manifest_and_duplicate_header_rejected(self):
        self.forge(struct.pack('>I', client.MAX_MANIFEST + 1) + b'PGDMP')
        self.assert_rejected_without_plaintext()
        self.forge(b'123456789', lambda header: json.dumps(header).encode()[:-1] + b',"version":1}')
        self.assert_rejected_without_plaintext()

    def test_truncated_and_trailing_payload_rejected(self):
        client.encrypt_archive(self.archive, self.manifest, self.public, self.encrypted)
        original = self.encrypted.read_bytes()
        for damaged in (original[:-1], original + b'extra'):
            client.private_write(self.encrypted, damaged)
            self.assert_rejected_without_plaintext()

    def test_upload_limit_is_checked_before_publishing_ciphertext(self):
        with self.assertRaises(client.MigrationError):
            client.encrypt_archive(self.archive, self.manifest, self.public, self.encrypted, maximum=10)
        self.assertFalse(self.encrypted.exists())

    def target(self):
        return {'empty': True, 'targetDbId': 'dpg-testmigration-a', 'serverMajor': 16, 'serverVersion': '16.14',
                'publicKey': self.other_public.decode(), 'keyFingerprint': client.public_fingerprint(self.other_private.public_key()),
                'maxUploadBytes': client.MAX_WIRE,
                'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)).isoformat()}

    def test_target_requires_empty_bound_id_version_expiry_and_key_fingerprint(self):
        target = self.target()
        client.validate_target(target, 'dpg-testmigration-a', 16)
        changes = [{'empty': False}, {'targetDbId': client.SOURCE_ID}, {'serverMajor': 17},
                   {'keyFingerprint': '0' * 64}, {'expiresAt': '2000-01-01T00:00:00Z'}]
        for change in changes:
            with self.assertRaises(client.MigrationError):
                client.validate_target({**target, **change}, 'dpg-testmigration-a', 16)

    def test_https_and_hostname_verification_cannot_be_disabled(self):
        with self.assertRaises(client.MigrationError):
            client.MigrationTransport('http://localhost', 'fixture-token')
        insecure = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        insecure.check_hostname = False
        insecure.verify_mode = ssl.CERT_NONE
        with self.assertRaises(client.MigrationError):
            client.MigrationTransport('https://localhost', 'fixture-token', context=insecure)

    def test_success_requires_both_server_ok_and_verified(self):
        client.private_write(self.directory / 'antsurvival.dump', self.content)
        class Transport:
            get = lambda this, path: self.target()
            upload = lambda this, payload: {'ok': True, 'verified': False}
        with patch.object(client, 'require_verified', return_value=self.manifest):
            with self.assertRaises(client.MigrationError):
                client.restore_verified(self.directory, Transport(), 'dpg-testmigration-a')
        self.assertFalse((self.directory / 'restore-response.json').exists())

    def test_local_verification_marker_cannot_cover_changed_archive(self):
        client.private_write(self.directory / 'antsurvival.dump', self.content)
        client.private_json(self.directory / 'snapshot-manifest.json', self.manifest)
        client.private_json(self.directory / 'local-verification.json', {'verified': True, 'sourceDbId': client.SOURCE_ID,
                            'archiveSha256': self.manifest['archiveSha256'],
                            'manifestSha256': client.sha256_file(self.directory / 'snapshot-manifest.json')})
        client.require_verified(self.directory)
        client.private_write(self.directory / 'antsurvival.dump', self.content + b'changed')
        with self.assertRaises(client.MigrationError):
            client.require_verified(self.directory)


if __name__ == '__main__':
    unittest.main()
