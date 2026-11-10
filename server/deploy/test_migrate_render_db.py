import importlib.util
import ssl
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('render_migration', Path(__file__).with_name('migrate-render-db.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class RootCertificateTests(unittest.TestCase):
    def test_missing_bundle_stops_instead_of_disabling_tls(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(migration, 'SYSTEM_CA_FILES', (Path(directory) / 'missing.pem',)):
                with self.assertRaises(RuntimeError):
                    migration.trusted_ca_bundle()

    def test_invalid_bundle_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / 'invalid.pem'
            invalid.write_text('This is not a root certificate.')
            with patch.object(migration, 'SYSTEM_CA_FILES', (invalid,)):
                with self.assertRaises(RuntimeError):
                    migration.trusted_ca_bundle()

    def test_system_bundle_contains_trusted_ca_certificates(self):
        bundle = migration.trusted_ca_bundle()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cafile=str(bundle))
        self.assertTrue(bundle.is_absolute())
        self.assertGreater(context.cert_store_stats()['x509_ca'], 0)

    def test_command_mounts_ca_read_only_and_keeps_private_credentials_in_environment(self):
        placeholder = 'placeholder-not-a-real-password'
        url = f'postgresql://sanction:{placeholder}@{migration.SOURCE_ID}.singapore-postgres.render.com/sanction'
        connection = migration.RenderConnection(url, True)
        command = connection.command('pg_dump', '--version')
        mount = command[command.index('--mount') + 1]
        self.assertEqual(mount, f'type=bind,source={connection.ca_bundle},target={migration.CONTAINER_CA_FILE},readonly')
        self.assertEqual(connection.environment['PGSSLMODE'], 'verify-full')
        self.assertEqual(connection.environment['PGSSLROOTCERT'], migration.CONTAINER_CA_FILE)
        self.assertNotIn(placeholder, ' '.join(command))
        self.assertNotIn(url, ' '.join(command))


if __name__ == '__main__':
    unittest.main()
