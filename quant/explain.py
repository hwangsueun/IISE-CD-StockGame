"""Explain the pinned Alpha158 scores. Read-only; no fitting or future labels."""
import hashlib
import json
import re
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def explain(request):
    folder = Path(request['modelDirectory']).resolve()
    signals_path = Path(request['signalsFile']).resolve()
    expected_sha = request['artifactSha256']
    if digest(signals_path) != expected_sha or digest(folder / 'signals.json') != expected_sha:
        raise ValueError('signal_artifact_mismatch')
    artifact = json.loads(signals_path.read_text())
    signal = artifact['sessions'][request['decisionDate']]
    day = signal['signal_date']
    model_id = signal['model_id']
    if not re.fullmatch(r'lgb-\d{8}', model_id):
        raise ValueError('invalid_model_id')
    metadata = next(m for m in artifact['models'] if m['id'] == model_id)
    if not metadata['trained_through'] < day or metadata['available_from'] > day or day > request['decisionDate']:
        raise ValueError('model_not_available_at_decision')
    checkpoint = folder / f'{model_id}.txt'
    if digest(checkpoint) != metadata['sha256']:
        raise ValueError('model_hash_mismatch')
    spec = json.loads((folder / 'spec.json').read_text())
    if spec['data_version'] != artifact['data_version']:
        raise ValueError('data_version_mismatch')
    model = lgb.Booster(model_file=str(checkpoint))
    keys = model.feature_name()
    if len(keys) != 158 or len(set(keys)) != 158 or keys != spec['features']:
        raise ValueError('feature_order_mismatch')
    # Predicate selects only this historical day's features. No labels or later rows are read.
    frame = pd.read_parquet(folder / 'features.parquet', filters=[('datetime', '==', pd.Timestamp(day))])
    if frame.index.has_duplicates or list(frame.columns) != keys:
        raise ValueError('invalid_feature_table')
    ids = [row[0] for row in signal['ranking']]
    if len(set(ids)) != len(ids):
        raise ValueError('duplicate_ranked_asset')
    index = pd.MultiIndex.from_tuples([(pd.Timestamp(day), asset) for asset in ids], names=['datetime', 'instrument'])
    inputs = frame.loc[index, keys].replace([np.inf, -np.inf], np.nan)
    predictions = model.predict(inputs, num_threads=2)
    contributions = model.predict(inputs, pred_contrib=True, num_threads=2)
    expected = np.array([row[1] for row in signal['ranking']], dtype=float)
    if contributions.shape != (len(ids), 159) or not np.isfinite(contributions).all():
        raise ValueError('invalid_contributions')
    score_error = float(np.max(np.abs(predictions - expected)))
    sum_error = float(np.max(np.abs(contributions.sum(axis=1) - predictions)))
    # Exported scores were rounded to ten decimal places. Allow only numeric rounding error.
    if not np.isfinite(predictions).all() or score_error > 1e-8 or sum_error > 1e-8:
        raise ValueError('prediction_reconstruction_failed')
    result = []
    for i, asset in enumerate(ids):
        result.append({'assetId': asset, 'score': float(expected[i]), 'prediction': float(predictions[i]),
                       'baseValue': float(contributions[i, -1]),
                       'features': [{'name': key, 'value': None if pd.isna(inputs.iloc[i, j]) else float(inputs.iloc[i, j]),
                                     'contribution': float(contributions[i, j])} for j, key in enumerate(keys)]})
    return {'method': 'lightgbm_tree_shap', 'artifactSha256': expected_sha, 'modelVersion': artifact['model_version'],
            'modelId': model_id, 'modelSha256': metadata['sha256'], 'signalDate': day,
            'decisionDate': request['decisionDate'], 'trainedThrough': metadata['trained_through'],
            'featureCount': 158, 'maxScoreError': score_error, 'maxSumError': sum_error,
            'libraryVersion': lgb.__version__, 'rows': result}


if __name__ == '__main__':
    try:
        print(json.dumps(explain(json.load(sys.stdin)), allow_nan=False, separators=(',', ':')))
    except Exception as error:
        print(f'Alpha158 explanation failed: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
