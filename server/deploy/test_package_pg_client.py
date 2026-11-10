import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('package_pg_client', Path(__file__).with_name('package-pg-client.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def test_deterministic_regular_file_archive_and_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = root / 'files'
            (files / 'bin').mkdir(parents=True)
            (files / 'lib').mkdir()
            (files / 'licenses').mkdir()
            (files / 'bin/pg_dump').write_bytes(b'fake-fixture-not-an-executable')
            (files / 'lib/loader').write_bytes(b'fixture')
            (files / 'licenses/copyright').write_text('fixture notice')
            first, second = root / 'first.tar.gz', root / 'second.tar.gz'
            module.deterministic_archive(files, first)
            module.deterministic_archive(files, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with tarfile.open(first) as archive:
                members = archive.getmembers()
                self.assertEqual([m.name for m in members], ['bin/pg_dump', 'lib/loader', 'licenses/copyright'])
                self.assertTrue(all(m.isfile() and m.uid == 0 and m.gid == 0 and m.mtime == 0 for m in members))
                self.assertEqual([m.mode for m in members], [0o755, 0o755, 0o644])

    def test_official_platform_digest_is_fixed(self):
        self.assertEqual(module.SOURCE_TAG, 'docker.io/library/postgres:16-bookworm')
        self.assertRegex(module.IMAGE_DIGEST, r'^sha256:[a-f0-9]{64}$')
        self.assertTrue(module.IMAGE.endswith(module.IMAGE_DIGEST))


if __name__ == '__main__':
    unittest.main()
