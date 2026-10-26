import unittest

import lightgbm as lgb
import numpy as np
import pandas as pd

from explain import DecisionPaths, add_reference_comparisons, split_condition


def leaf(index, value, count):
    return {'leaf_index': index, 'leaf_value': value, 'leaf_count': count}


def split(index, feature, threshold, left, right, **options):
    return {'split_index': index, 'split_feature': feature, 'threshold': threshold,
            'decision_type': '<=', 'missing_type': 'None', 'default_left': True,
            'internal_value': 999, 'left_child': left, 'right_child': right, **options}


def dump(root, keys=('f0', 'f1')):
    return {'objective': 'regression', 'average_output': False, 'num_tree_per_iteration': 1,
            'feature_names': list(keys), 'tree_info': [{'tree_index': 0, 'tree_structure': root}]}


class DecisionPathTests(unittest.TestCase):
    def test_actual_path_uses_weighted_leaf_outputs_and_prior_conditions(self):
        root = split(0, 0, 1, leaf(0, .2, 1),
                     split(1, 1, 2, leaf(1, 1, 1), leaf(2, 3, 3)))
        evidence, leaves, prediction = DecisionPaths(dump(root), ['f0', 'f1']).explain_row([2, 4], [.1, -.2])
        self.assertEqual(leaves, [2])
        self.assertEqual(prediction, 3)
        first = evidence['f0']['examples'][0]
        self.assertAlmostEqual(first['selectedExpectedValue'], 2.5)
        self.assertAlmostEqual(first['alternativeExpectedValue'], .2)
        self.assertAlmostEqual(first['branchDifference'], 2.3)
        self.assertEqual(first['selectedSampleCount'], 4)
        self.assertEqual(first['selectedBranch'], 'right')
        second = evidence['f1']['examples'][0]
        self.assertEqual(second['context'][0]['feature'], 'f0')
        self.assertEqual(second['context'][0]['conditionOperator'], '>')
        # No forced agreement between SHAP sign and this local path comparison.
        self.assertEqual(evidence['f1']['higherBranchCount'], 1)

    def test_off_path_feature_can_have_shap_without_a_path_example(self):
        root = split(0, 0, 1, leaf(0, .2, 1), split(1, 1, 2, leaf(1, 1, 1), leaf(2, 3, 3)))
        evidence, _, _ = DecisionPaths(dump(root), ['f0', 'f1']).explain_row([0, 4], [.1, -.2])
        self.assertEqual(evidence['f1']['modelTreeCount'], 1)
        self.assertEqual(evidence['f1']['pathTreeCount'], 0)
        self.assertEqual(evidence['f1']['examples'], [])

    def test_numeric_boundary_nan_zero_and_default_direction(self):
        node = split(0, 0, -.5, leaf(0, 1, 1), leaf(1, 2, 1))
        self.assertEqual(split_condition(node, [-.5], ['f'])['selectedBranch'], 'left')
        self.assertEqual(split_condition(node, [float('nan')], ['f'])['routing'], 'nan_as_zero')
        self.assertEqual(split_condition(node, [float('nan')], ['f'])['selectedBranch'], 'right')
        node['missing_type'] = 'NaN'
        self.assertEqual(split_condition(node, [float('nan')], ['f'])['selectedBranch'], 'left')
        node['default_left'] = False
        self.assertEqual(split_condition(node, [float('nan')], ['f'])['selectedBranch'], 'right')
        node.update(missing_type='Zero', default_left=True)
        for value in [0, 1e-36, -1e-36, float('nan')]:
            condition = split_condition(node, [value], ['f'])
            self.assertTrue(condition['usedDefault'])
            self.assertEqual(condition['selectedBranch'], 'left')
        self.assertFalse(split_condition(node, [1e-34], ['f'])['usedDefault'])

    def test_categorical_membership_truncation_and_missing_ignore_default_left(self):
        node = split(0, 0, '1||3', leaf(0, 1, 1), leaf(1, 2, 1), decision_type='==')
        for value, direction in [(1.9, 'left'), (3, 'left'), (2, 'right'), (-1, 'right'), (float('nan'), 'right')]:
            self.assertEqual(split_condition(node, [value], ['f'])['selectedBranch'], direction)
        self.assertEqual(split_condition(node, [float('nan')], ['f'])['routing'], 'categorical_missing')
        self.assertEqual(split_condition(node, [-.5], ['f'])['effectiveValue'], 0)

    def test_path_reconstruction_matches_native_numeric_and_categorical_models(self):
        rng = np.random.default_rng(123)
        for categorical, zero_missing in [(False, False), (False, True), (True, False)]:
            x = rng.integers(0, 5, size=(160, 2)).astype(float)
            y = np.where(x[:, 0] == 1, .5, -.3) + x[:, 1] * .04
            x[::11, 0] = np.nan
            frame = pd.DataFrame(x, columns=['f0', 'f1'])
            data = lgb.Dataset(frame, label=y, categorical_feature=['f0'] if categorical else [])
            model = lgb.train({'objective': 'regression', 'verbosity': -1, 'num_threads': 2,
                               'num_leaves': 7, 'min_data_in_leaf': 2, 'min_data_per_group': 1,
                               'cat_smooth': 0, 'cat_l2': 0, 'max_cat_to_onehot': 1,
                               'zero_as_missing': zero_missing}, data, num_boost_round=4)
            paths = DecisionPaths(model.dump_model(), list(frame.columns))
            if categorical:
                self.assertFalse(paths.numeric_only)
            prediction = model.predict(frame, num_threads=2)
            native_leaves = model.predict(frame, pred_leaf=True, num_threads=2)
            contributions = model.predict(frame, pred_contrib=True, num_threads=2)
            for i in range(len(x)):
                _, leaves, score = paths.explain_row(x[i], contributions[i, :-1])
                np.testing.assert_array_equal(leaves, native_leaves[i])
                self.assertAlmostEqual(score, prediction[i], places=12)

    def test_reference_comparison_changes_exactly_one_input_and_uses_same_day_median(self):
        class RecordingModel:
            def predict(self, values, **kwargs):
                self.values = values
                return values[:, 0] * 2 + values[:, 1]
        model = RecordingModel()
        frame = pd.DataFrame([[1, 20], [5, 30], [9, 40]], columns=['a', 'b'])
        rows = [{'prediction': 22, 'features': [
            {'decisionEvidence': {}}, {'decisionEvidence': None}]}]
        add_reference_comparisons(model, frame, rows)
        np.testing.assert_array_equal(model.values, [[5, 20]])
        result = rows[0]['features'][0]['decisionEvidence']['referenceComparison']
        self.assertEqual(result['referenceValue'], 5)
        self.assertEqual(result['referencePopulation'], 3)
        self.assertEqual(result['difference'], -8)

    def test_unsupported_output_transform_is_not_presented_as_a_return(self):
        wrong = dump(leaf(0, 1, 10))
        wrong['objective'] = 'binary sigmoid:1'
        with self.assertRaisesRegex(ValueError, 'output_scale'):
            DecisionPaths(wrong, ['f0', 'f1'])


if __name__ == '__main__':
    unittest.main()
