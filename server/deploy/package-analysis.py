"""Bundle pinned Alpha158 inputs in small, filterable parquet files for production.

Usage: python server/deploy/package-analysis.py MODEL_DIRECTORY SECTOR_CSV
No training, rounding, or score changes are performed.
"""
import gzip
import hashlib
import json
import shutil
import sys
from pathlib import Path
import pandas as pd

dest = Path(__file__).resolve().parent
source, sectors = map(Path, sys.argv[1:])
manifest = json.loads((dest / 'quant-manifest.json').read_text())
digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
assert digest(source / 'signals.json') == manifest['sha256']
artifact = json.loads((source / 'signals.json').read_text())
out = dest / 'analysis'
out.mkdir(exist_ok=True)
features = out / 'features.parquet'
features.mkdir(exist_ok=True)
frame = pd.read_parquet(source / 'features.parquet')
days = {pd.Timestamp(s['signal_date']) for s in artifact['sessions'].values()}
frame = frame.loc[frame.index.get_level_values('datetime').isin(days)]
for year, part in frame.groupby(frame.index.get_level_values('datetime').year):
    part.to_parquet(features / f'{year}.parquet', compression='zstd', compression_level=9, row_group_size=2048)
shutil.copyfile(source / 'spec.json', out / 'spec.json')
for model in artifact['models']:
    file = source / f"{model['id']}.txt"
    assert digest(file) == model['sha256']
    shutil.copyfile(file, out / file.name)
with (dest / 'sectors.csv.gz').open('wb') as stream:
    stream.write(gzip.compress(sectors.read_bytes(), compresslevel=9, mtime=0))
files = {str(p.relative_to(dest)): digest(p) for p in sorted(out.rglob('*')) if p.is_file()}
files['sectors.csv.gz'] = digest(dest / 'sectors.csv.gz')
(dest / 'analysis-manifest.json').write_text(json.dumps({'signalsSha256': manifest['sha256'], 'files': files}, indent=2) + '\n')
print(json.dumps({'files': len(files), 'featureRows': len(frame), 'bytes': sum((dest / p).stat().st_size for p in files)}))
