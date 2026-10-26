import types
import unittest
from unittest.mock import patch
import check_runtime


class RuntimeCheckTests(unittest.TestCase):
    def test_missing_shared_library_does_not_disable_unrelated_models(self):
        def load(name):
            if name == 'lightgbm':
                raise OSError('libgomp not found')
            return types.SimpleNamespace(__version__='1.0')
        with patch('check_runtime.importlib.import_module', side_effect=load):
            result = check_runtime.check()
        self.assertFalse(result['ready'])
        self.assertEqual(result['capabilities']['lightgbm']['missing'], ['lightgbm'])
        self.assertFalse(result['capabilities']['explanations']['available'])
        self.assertTrue(result['capabilities']['randomForest']['available'])
        self.assertTrue(result['capabilities']['xgboost']['available'])

    def test_missing_common_package_blocks_dependent_models(self):
        def load(name):
            if name == 'scipy':
                raise ImportError('scipy')
            return types.SimpleNamespace(__version__='1.0')
        with patch('check_runtime.importlib.import_module', side_effect=load):
            result = check_runtime.check()
        for name in ['randomForest', 'lightgbm', 'xgboost', 'risk']:
            self.assertFalse(result['capabilities'][name]['available'])
            self.assertIn('scipy', result['capabilities'][name]['missing'])


if __name__ == '__main__':
    unittest.main()
