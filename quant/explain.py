"""Explain the pinned Alpha158 scores. Read-only; no fitting or future labels."""
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


# Match LightGBM 4.6 Tree::NumericalDecision / CategoricalDecision, including
# NaN-as-zero when missing_type=None. Leaf values already include tree shrinkage.
# https://github.com/microsoft/LightGBM/blob/v4.6.0/include/LightGBM/tree.h
ZERO_THRESHOLD = float(np.float32(1e-35))


def split_condition(node, values, keys):
    feature_index = int(node['split_feature'])
    value = float(values[feature_index])
    missing = math.isnan(value)
    kind = node['decision_type']
    missing_type = node.get('missing_type', 'None')
    effective = None if missing else value
    used_default = False
    routing = 'comparison'
    if kind == '<=':
        threshold = float(node['threshold'])
        if missing and missing_type != 'NaN':
            effective = 0.0
            routing = 'nan_as_zero'
        used_default = ((missing_type == 'NaN' and missing)
                        or (missing_type == 'Zero' and abs(effective) <= ZERO_THRESHOLD))
        if used_default:
            left = bool(node['default_left'])
            routing = 'missing_default'
        else:
            left = effective <= threshold
        operator = '<=' if left else '>'
    elif kind == '==':
        threshold = [int(category) for category in str(node['threshold']).split('||')]
        if not missing:
            if not math.isfinite(value) or value < -2147483648 or value >= 2147483648:
                raise ValueError('unsupported_categorical_value')
            effective = int(value)  # LightGBM truncates categorical doubles toward zero.
        if missing or effective < 0:
            left = False  # Categorical missing values ignore default_left.
            routing = 'categorical_missing'
        else:
            left = effective in threshold
        operator = 'in' if left else 'not_in'
    else:
        raise ValueError('unsupported_tree_split')
    return {
        'feature': keys[feature_index], 'value': None if missing else value,
        'effectiveValue': effective, 'decisionType': kind, 'threshold': threshold,
        'selectedBranch': 'left' if left else 'right', 'conditionOperator': operator,
        'missingType': missing_type, 'valueWasMissing': missing,
        'usedDefault': used_default, 'defaultLeft': bool(node.get('default_left', False)),
        'routing': routing,
    }


class DecisionPaths:
    """Observed path examples, not an additive attribution or a counterfactual."""

    def __init__(self, dump, keys):
        if (dump.get('objective') != 'regression' or dump.get('average_output')
                or dump.get('num_tree_per_iteration') != 1 or dump['feature_names'] != keys):
            raise ValueError('unsupported_path_output_scale')
        self.keys = keys
        self.trees = dump['tree_info']
        self.stats = {}
        self.feature_trees = defaultdict(set)
        self.numeric_only = True
        for tree in self.trees:
            self._measure(tree['tree_structure'], tree['tree_index'])

    def _measure(self, node, tree_index):
        if 'split_index' not in node:
            if node.get('leaf_coeff') or node.get('leaf_features'):
                raise ValueError('linear_leaves_not_supported')
            result = (float(node['leaf_value']), int(node.get('leaf_count', 0)))
        else:
            feature = self.keys[int(node['split_feature'])]
            self.feature_trees[feature].add(tree_index)
            self.numeric_only = self.numeric_only and node['decision_type'] == '<='
            left, right = self._measure(node['left_child'], tree_index), self._measure(node['right_child'], tree_index)
            count = left[1] + right[1]
            if count <= 0:
                raise ValueError('empty_subtree_sample_count')
            result = ((left[0] * left[1] + right[0] * right[1]) / count, count)
        if not math.isfinite(result[0]) or result[1] < 0:
            raise ValueError('invalid_subtree_value')
        self.stats[id(node)] = result
        return result

    def explain_row(self, values, contributions):
        records = defaultdict(list)
        leaf_ids, output = [], 0.0
        for tree in self.trees:
            node, context = tree['tree_structure'], []
            while 'split_index' in node:
                condition = split_condition(node, values, self.keys)
                branch = condition['selectedBranch']
                selected = node[f'{branch}_child']
                other = node['right_child' if branch == 'left' else 'left_child']
                chosen_mean, chosen_count = self.stats[id(selected)]
                other_mean, other_count = self.stats[id(other)]
                records[condition['feature']].append({
                    **condition, 'treeIndex': tree['tree_index'], 'nodeIndex': node['split_index'],
                    'selectedExpectedValue': chosen_mean, 'alternativeExpectedValue': other_mean,
                    'branchDifference': chosen_mean - other_mean,
                    'selectedSampleCount': chosen_count, 'alternativeSampleCount': other_count,
                    'context': context[-3:], 'omittedContextCount': max(0, len(context) - 3),
                })
                context.append(condition)
                node = selected
            leaf_ids.append(int(node.get('leaf_index', 0)))
            output += float(node['leaf_value'])
        # Match the ten feature cards shown by the UI. Keep all 158 exact SHAP
        # values, but do not inflate the response with examples for every feature.
        order = sorted(range(len(self.keys)), key=lambda i: (-abs(contributions[i]), self.keys[i]))
        selected_features = {self.keys[i] for sign in (1, -1)
                             for i in [j for j in order if contributions[j] * sign > 0][:5]}
        evidence = {}
        for feature in selected_features:
            entries = records[feature]
            ranked = sorted(entries, key=lambda row: (-abs(row['branchDifference']), row['treeIndex'], row['nodeIndex']))
            examples, seen_trees = [], set()
            for entry in ranked:
                if entry['treeIndex'] in seen_trees:
                    continue
                examples.append(entry)
                seen_trees.add(entry['treeIndex'])
                if len(examples) == 2:
                    break
            evidence[feature] = {
                'method': 'observed_tree_paths', 'totalTrees': len(self.trees),
                'modelTreeCount': len(self.feature_trees[feature]),
                'pathTreeCount': len({row['treeIndex'] for row in entries}),
                'splitCount': len(entries),
                'higherBranchCount': sum(row['branchDifference'] > 0 for row in entries),
                'lowerBranchCount': sum(row['branchDifference'] < 0 for row in entries),
                'equalBranchCount': sum(row['branchDifference'] == 0 for row in entries),
                'examples': examples,
            }
        return evidence, leaf_ids, output


def add_reference_comparisons(model, inputs, rows):
    """One-coordinate sensitivity, never claimed to be SHAP or a realistic trade."""
    matrix = inputs.to_numpy(dtype=float)
    finite = np.isfinite(matrix)
    counts = finite.sum(axis=0)
    medians = [float(np.median(matrix[finite[:, j], j])) if counts[j] else None
               for j in range(matrix.shape[1])]
    variants, targets = [], []
    for i, row in enumerate(rows):
        for j, feature in enumerate(row['features']):
            evidence = feature['decisionEvidence']
            if evidence is None:
                continue
            comparison = {
                'method': 'one_feature_same_day_median', 'available': bool(counts[j]),
                'referenceValue': medians[j], 'referencePopulation': int(counts[j]),
                'originalPrediction': row['prediction'], 'comparisonPrediction': None, 'difference': None,
            }
            evidence['referenceComparison'] = comparison
            if counts[j]:
                variant = matrix[i].copy()
                variant[j] = medians[j]
                variants.append(variant)
                targets.append(comparison)
    if variants:
        predictions = model.predict(np.asarray(variants), num_threads=2)
        if not np.isfinite(predictions).all():
            raise ValueError('invalid_reference_prediction')
        for target, prediction in zip(targets, predictions):
            target['comparisonPrediction'] = float(prediction)
            target['difference'] = target['originalPrediction'] - float(prediction)


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
    native_leaves = np.asarray(model.predict(inputs, pred_leaf=True, num_threads=2))
    paths = DecisionPaths(model.dump_model(), keys)
    native_leaves = native_leaves.reshape(len(ids), len(paths.trees))
    expected = np.array([row[1] for row in signal['ranking']], dtype=float)
    if contributions.shape != (len(ids), 159) or not np.isfinite(contributions).all():
        raise ValueError('invalid_contributions')
    score_error = float(np.max(np.abs(predictions - expected)))
    sum_error = float(np.max(np.abs(contributions.sum(axis=1) - predictions)))
    # Exported scores were rounded to ten decimal places. Allow only numeric rounding error.
    if not np.isfinite(predictions).all() or score_error > 1e-8 or sum_error > 1e-8:
        raise ValueError('prediction_reconstruction_failed')
    result, path_error = [], 0.0
    for i, asset in enumerate(ids):
        evidence, leaf_ids, path_score = paths.explain_row(inputs.iloc[i].to_numpy(), contributions[i, :-1])
        if not np.array_equal(leaf_ids, native_leaves[i]):
            raise ValueError('decision_path_leaf_mismatch')
        path_error = max(path_error, abs(path_score - float(predictions[i])))
        if path_error > 1e-8:
            raise ValueError('decision_path_score_mismatch')
        result.append({'assetId': asset, 'score': float(expected[i]), 'prediction': float(predictions[i]),
                       'baseValue': float(contributions[i, -1]),
                       'features': [{'name': key, 'value': None if pd.isna(inputs.iloc[i, j]) else float(inputs.iloc[i, j]),
                                     'contribution': float(contributions[i, j]),
                                     'decisionEvidence': evidence.get(key)} for j, key in enumerate(keys)]})
    add_reference_comparisons(model, inputs, result)
    return {'method': 'lightgbm_tree_shap', 'artifactSha256': expected_sha, 'modelVersion': artifact['model_version'],
            'modelId': model_id, 'modelSha256': metadata['sha256'], 'signalDate': day,
            'decisionDate': request['decisionDate'], 'trainedThrough': metadata['trained_through'],
            'featureCount': 158, 'maxScoreError': score_error, 'maxSumError': sum_error,
            'decisionPathMethod': 'lightgbm_observed_paths', 'treeCount': len(paths.trees),
            'branchValueMethod': 'leaf_count_weighted_subtree_output',
            'numericSplitsOnly': paths.numeric_only, 'pathLeavesVerified': True,
            'maxPathScoreError': path_error,
            'libraryVersion': lgb.__version__, 'rows': result}


if __name__ == '__main__':
    try:
        print(json.dumps(explain(json.load(sys.stdin)), allow_nan=False, separators=(',', ':')))
    except Exception as error:
        print(f'Alpha158 explanation failed: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
