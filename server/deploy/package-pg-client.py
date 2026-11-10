#!/usr/bin/env python3
"""Package unmodified official PostgreSQL 16 Linux/x64 clients and their loader.

Requires Docker, never contacts a database, and never changes running containers.
The immutable platform manifest is pinned independently of the moving source tag.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

SOURCE_TAG = 'docker.io/library/postgres:16-bookworm'
IMAGE_DIGEST = 'sha256:5983db9a9c6ad225a48a46cfe2e03e6680b1826662befd0465eb05b34cb1c64e'
INDEX_DIGEST = 'sha256:5264710be20f409750ac6dc4e5706dcef929c87e241605463f0f9aefa932a8d9'
IMAGE = 'docker.io/library/postgres@' + IMAGE_DIGEST
ARCHIVE = 'pg-client-linux-x64.tar.gz'
MANIFEST = 'pg-client.manifest.json'
TOOLS = ('pg_dump', 'pg_restore')

EXTRACT = r'''
set -eu
mkdir -p /out/bin /out/lib /out/licenses
: > /out/origins.tsv
for tool in pg_dump pg_restore; do
  binary="/usr/lib/postgresql/16/bin/$tool"
  cp -L "$binary" "/out/bin/$tool"
  printf 'bin/%s\t%s\n' "$tool" "$binary" >> /out/origins.tsv
  "$binary" --version > "/out/$tool.version"
  ldd "$binary" | awk '/=> \// { print $3 } /^[[:space:]]*\// { print $1 }' >> /out/dependencies.txt
done
sort -u /out/dependencies.txt -o /out/dependencies.txt
for library in $(cat /out/dependencies.txt); do
  name=$(basename "$library")
  if [ -e "/out/lib/$name" ]; then cmp "$library" "/out/lib/$name"; fi
  cp -L "$library" "/out/lib/$name"
  printf 'lib/%s\t%s\n' "$name" "$library" >> /out/origins.tsv
done
dpkg-query -W -f='${binary:Package}\t${Version}\n' > /out/packages.tsv
for directory in /usr/share/doc/*; do
  if [ -f "$directory/copyright" ]; then
    package=$(basename "$directory")
    cp -L "$directory/copyright" "/out/licenses/$package.copyright"
  fi
done
for license in /usr/share/common-licenses/*; do
  [ ! -f "$license" ] || cp -L "$license" "/out/licenses/$(basename "$license")"
done
# Test outside the image's filesystem: no accidental system-library fallback.
chroot /out /lib/ld-linux-x86-64.so.2 --inhibit-cache --library-path /lib /bin/pg_dump --version
chroot /out /lib/ld-linux-x86-64.so.2 --inhibit-cache --library-path /lib /bin/pg_restore --version
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def deterministic_archive(root, output):
    """Only regular files; fixed modes, ownership, ordering and gzip timestamp."""
    with output.open('wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                for path in sorted(root.rglob('*')):
                    if not path.is_file():
                        continue
                    relative = path.relative_to(root).as_posix()
                    data = path.read_bytes()
                    info = tarfile.TarInfo(relative)
                    info.size = len(data)
                    info.mode = 0o755 if relative.startswith(('bin/', 'lib/')) else 0o644
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    archive.addfile(info, io.BytesIO(data))


def package(output_dir):
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    inspection = subprocess.run(['docker', 'image', 'inspect', IMAGE], capture_output=True, text=True)
    if inspection.returncode:
        subprocess.run(['docker', 'pull', '--platform=linux/amd64', IMAGE], check=True)
        inspection = subprocess.run(['docker', 'image', 'inspect', IMAGE], check=True, capture_output=True, text=True)
    image = json.loads(inspection.stdout)[0]
    if image['Os'] != 'linux' or image['Architecture'] != 'amd64':
        raise ValueError('Expected the pinned official linux/amd64 image')
    if not any(reference in {'postgres@' + IMAGE_DIGEST, IMAGE} for reference in image.get('RepoDigests', [])):
        raise ValueError('Docker did not confirm the pinned manifest digest')
    with tempfile.TemporaryDirectory(prefix='antsurvival-pg-client-') as temporary:
        extracted = Path(temporary)
        subprocess.run(['docker', 'run', '--rm', '--platform=linux/amd64', '--network=none',
                        '--read-only', '--entrypoint=/bin/sh', '-v', f'{extracted}:/out', IMAGE,
                        '-c', EXTRACT], check=True)
        versions = {tool: (extracted / f'{tool}.version').read_text().strip() for tool in TOOLS}
        if not all(version.startswith(f'{tool} (PostgreSQL) 16.') for tool, version in versions.items()):
            raise ValueError('Expected actual PostgreSQL major version 16 tools')
        origins = dict(line.split('\t', 1) for line in (extracted / 'origins.tsv').read_text().splitlines())
        dependencies = (extracted / 'dependencies.txt').read_text().splitlines()
        packages = dict(line.split('\t', 1) for line in (extracted / 'packages.tsv').read_text().splitlines())
        for name in ['origins.tsv', 'dependencies.txt', 'packages.tsv', *(f'{tool}.version' for tool in TOOLS)]:
            (extracted / name).unlink()
        files = {}
        for path in sorted(extracted.rglob('*')):
            if path.is_file():
                relative = path.relative_to(extracted).as_posix()
                data = path.read_bytes()
                files[relative] = {'sha256': digest(data), 'bytes': len(data),
                                   'mode': 0o755 if relative.startswith(('bin/', 'lib/')) else 0o644}
                if relative in origins:
                    files[relative]['sourcePath'] = origins[relative]
        candidate = output_dir / (ARCHIVE + '.partial')
        deterministic_archive(extracted, candidate)
        archive_bytes = candidate.read_bytes()
        manifest = {
            'schemaVersion': 1, 'platform': 'linux', 'architecture': 'x64', 'postgresMajor': 16,
            'source': {'image': SOURCE_TAG, 'imageDigest': IMAGE_DIGEST, 'indexDigest': INDEX_DIGEST,
                       'imageId': image['Id'], 'platform': 'linux/amd64',
                       'documentation': 'https://hub.docker.com/_/postgres',
                       'dockerfile': 'https://github.com/docker-library/postgres/tree/master/16/bookworm',
                       'packages': packages},
            'tools': versions, 'loader': 'lib/ld-linux-x86-64.so.2',
            'archive': {'file': ARCHIVE, 'sha256': digest(archive_bytes), 'bytes': len(archive_bytes)},
            'unpackedBytes': sum(item['bytes'] for item in files.values()),
            'dependencies': dependencies, 'files': files,
        }
        candidate.replace(output_dir / ARCHIVE)
        (output_dir / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        print(json.dumps({'archive': ARCHIVE, 'sha256': manifest['archive']['sha256'],
                          'bytes': len(archive_bytes), 'unpackedBytes': manifest['unpackedBytes'],
                          'files': len(files), 'tools': versions, 'imageDigest': IMAGE_DIGEST}, sort_keys=True))
        return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', default=Path(__file__).resolve().parent)
    package(parser.parse_args().output_dir)
