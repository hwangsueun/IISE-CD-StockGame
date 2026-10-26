"""Fit library models. Export numeric trees; compare the exported inference with the library."""
import json
import sys


def libraries():
    import importlib
    result = {}
    for key, module in [('randomForest', 'sklearn'), ('lightgbm', 'lightgbm'), ('xgboost', 'xgboost'), ('risk', 'scipy')]:
        try:
            result[key] = importlib.import_module(module).__version__
        except Exception:
            result[key] = None
    return result


def train(payload):
    import numpy as np
    cfg, samples, keys = payload['config'], payload['samples'], payload['keys']
    x = np.asarray([s['x'] for s in samples], dtype=float)
    y = np.asarray([s['y'] for s in samples], dtype=float)
    classification = cfg.get('target', 'return') != 'return'
    nclass = 3 if cfg.get('target') == 'threeClass' else 2
    params = dict(n_estimators=cfg['ensembleTrees'], max_depth=cfg['ensembleDepth'], random_state=2026, n_jobs=1)
    base, classes, link = [0.0], 1, None
    if cfg['method'] in ['randomForest', 'tree']:
        from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
        from sklearn.tree import DecisionTreeRegressor
        params.update(min_samples_leaf=cfg['minLeaf'], max_features=0.7, bootstrap=True)
        if cfg['method'] == 'tree':
            params = dict(max_depth=cfg['treeDepth'], min_samples_leaf=50, random_state=2026)
            model = DecisionTreeRegressor(**params).fit(x, y)
            estimators = [model]
        else:
            model = (RandomForestClassifier if classification else RandomForestRegressor)(**params).fit(x, y)
            estimators = model.estimators_
        classes = nclass if classification else 1
        base = [0.0] * classes
        def convert(tree, group, i=0):
            v = tree.value[i, 0]
            value = float(v[group] / sum(v)) if classification else float(v[0])
            node = dict(value=value, count=int(tree.n_node_samples[i]))
            if tree.children_left[i] != -1:
                node.update(feature=keys[tree.feature[i]], threshold=float(tree.threshold[i]),
                            left=convert(tree, group, tree.children_left[i]), right=convert(tree, group, tree.children_right[i]))
            return node
        trees = []
        for t in estimators:
            for group in range(classes):
                node = convert(t.tree_, group); node['group'] = group; trees.append(node)
        aggregation, library, precision = 'mean', 'scikit-learn', 'float32'
        link = 'probability' if classification else None
        native_predict = model.predict_proba if classification else model.predict
        from sklearn import __version__ as version
    elif cfg['method'] == 'xgboost':
        import xgboost as xgb
        params.update(learning_rate=cfg['learningRate'], min_child_weight=cfg['minLeaf'], reg_lambda=1,
                      tree_method='hist', base_score=0.5 if classification else 0.0)
        objective = ('multi:softprob' if nclass == 3 else 'binary:logistic') if classification else 'reg:squarederror'
        model = (xgb.XGBClassifier if classification else xgb.XGBRegressor)(objective=objective, **params).fit(x, y)
        classes = 3 if classification and nclass == 3 else 1
        link = ('softmax' if classes == 3 else 'logistic') if classification else None
        # With explicit base_score, binary margin=logit(.5)=0; multiclass margin=.5.
        base = [.5] * classes if classes == 3 else [0.0]
        def convert(t):
            if 'leaf' in t:
                return dict(value=float(t['leaf']), count=float(t.get('cover', 0)))
            by_id = {c['nodeid']: c for c in t['children']}
            left, right = convert(by_id[t['yes']]), convert(by_id[t['no']])
            total = left['count'] + right['count']
            value = (left['value'] * left['count'] + right['value'] * right['count']) / total if total else 0
            return dict(value=value, count=float(t.get('cover', 0)), feature=keys[int(t['split'][1:])],
                        threshold=float(np.float32(t['split_condition'])), operator='<', left=left, right=right)
        trees = []
        for i, t in enumerate(model.get_booster().get_dump(dump_format='json', with_stats=True)):
            node = convert(json.loads(t)); node['group'] = i % classes; trees.append(node)
        aggregation, library, precision = 'sum', 'xgboost', 'float32'
        native_predict = model.predict_proba if classification else model.predict
        version = xgb.__version__
    else:
        from lightgbm import LGBMRegressor, LGBMClassifier
        params.update(min_child_samples=cfg['minLeaf'], learning_rate=cfg['learningRate'], num_leaves=min(31, 2 ** cfg['ensembleDepth']),
                      reg_lambda=1, verbosity=-1, deterministic=True, force_col_wise=True)
        model = (LGBMClassifier if classification else LGBMRegressor)(**params).fit(x, y)
        def convert(t):
            if 'leaf_value' in t:
                return dict(value=t['leaf_value'], count=t.get('leaf_count', len(y)))
            if t['decision_type'] != '<=': raise ValueError('Only numeric splits can be exported')
            return dict(value=t['internal_value'], count=t['internal_count'], feature=keys[t['split_feature']],
                        threshold=float(t['threshold']), left=convert(t['left_child']), right=convert(t['right_child']))
        classes = 3 if classification and nclass == 3 else 1
        base = [0.0] * classes
        link = ('softmax' if classes == 3 else 'logistic') if classification else None
        trees = []
        for i, t in enumerate(model.booster_.dump_model()['tree_info']):
            node = convert(t['tree_structure']); node['group'] = i % classes; trees.append(node)
        aggregation, library, precision = 'sum', 'lightgbm', 'float64'
        def native_predict(rows):
            p = model.booster_.predict(rows)
            return np.column_stack([1-p, p]) if classification and nclass == 2 else p
        from lightgbm import __version__ as version
    checks = list(x[np.linspace(0, len(x)-1, min(64, len(x)), dtype=int)])
    checks.extend(np.random.default_rng(2026).uniform(np.min(x, axis=0), np.max(x, axis=0), size=(32, len(keys))))
    def boundaries(node):
        if 'feature' not in node or len(checks) >= 512: return
        index, threshold = keys.index(node['feature']), node['threshold']
        for v in [np.nextafter(threshold, -np.inf), threshold, np.nextafter(threshold, np.inf)]:
            row = np.mean(x, axis=0); row[index] = v; checks.append(row)
        boundaries(node['left']); boundaries(node['right'])
    for tree in trees: boundaries(tree)
    checks = np.asarray(checks)
    # The rank representation's round trip is part of the existing inference contract.
    if cfg.get('representation', 'rank') == 'rank': checks = ((checks + .5) * 100) / 100 - .5
    predictions = native_predict(checks)
    scores = predictions[:, -1] if classification else predictions
    return dict(ensemble=dict(trees=trees, aggregation=aggregation, classes=classes, base=base, link=link),
                library=library, libraryVersion=version, inputPrecision=precision, seed=2026, parameters=params,
                verification=dict(inputs=checks.tolist(), predictions=scores.tolist(), probabilities=predictions.tolist() if classification else None))


if __name__ == '__main__':
    if '--check' in sys.argv: print(json.dumps(libraries()))
    else: print(json.dumps(train(json.load(sys.stdin)), allow_nan=False))
