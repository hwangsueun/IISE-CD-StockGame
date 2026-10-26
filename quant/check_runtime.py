"""Check model dependencies without training, changing data, or exposing local paths."""
import importlib
import json
import sys


def check():
    modules = {}
    for name in ['numpy', 'sklearn', 'lightgbm', 'xgboost', 'scipy', 'pandas', 'pyarrow']:
        try:
            library = importlib.import_module(name)
            modules[name] = {'available': True, 'version': library.__version__}
        except Exception as error:  # Missing shared libraries can raise OSError, not ImportError.
            modules[name] = {'available': False, 'version': None, 'error': type(error).__name__}
    dependencies = {
        'randomForest': ('sklearn', ['numpy', 'scipy', 'sklearn']),
        'lightgbm': ('lightgbm', ['numpy', 'scipy', 'sklearn', 'lightgbm']),
        'xgboost': ('xgboost', ['numpy', 'scipy', 'sklearn', 'xgboost']),
        'risk': ('scipy', ['numpy', 'scipy']),
        'explanations': ('lightgbm', ['numpy', 'lightgbm', 'pandas', 'pyarrow']),
    }
    capabilities = {}
    for name, (main, required) in dependencies.items():
        missing = [module for module in required if not modules[module]['available']]
        capabilities[name] = {'available': not missing, 'version': modules[main]['version'], 'missing': missing}
    return {'ready': all(value['available'] for value in modules.values()),
            'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
            'modules': modules, 'capabilities': capabilities}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result))
    if '--require-all' in sys.argv and not result['ready']:
        sys.exit(1)
