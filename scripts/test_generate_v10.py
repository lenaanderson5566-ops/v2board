"""Regression tests for the V10 compiler; standard library only, no app/database boot."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('generate_v10', Path(__file__).with_name('generate-v10.py'))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
ROOT = generator.ROOT


class ContractGenerationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        shutil.copytree(ROOT / 'api/v10', self.root / 'api/v10')

    def edit(self, name, change):
        path = self.root / 'api/v10' / name
        value = json.loads(path.read_text(encoding='utf-8'))
        change(value)
        path.write_text(json.dumps(value), encoding='utf-8')

    def test_publications_are_deterministic_and_current(self):
        outputs = generator.generate(self.root)
        self.assertEqual(len(outputs), 7)
        self.assertEqual(outputs, generator.generate(self.root))
        for name, value in outputs.items():
            self.assertEqual(value, (ROOT / name).read_text(encoding='utf-8'), name)
        document = json.loads(outputs['docs/api-v10/openapi.json'])
        self.assertNotIn('x-modules', document)
        self.assertNotIn('"x-runtime', outputs['docs/api-v10/openapi.json'])
        self.assertTrue(document['components']['responses'])
        # Consumers of the historical node export do not need the new component groups.
        node = outputs['docs/api-v10/node-api.json']
        for category in ['responses', 'headers', 'parameters']:
            self.assertNotIn('#/components/' + category + '/', node)

    def test_shared_definitions_keep_response_and_parameter_semantics(self):
        source = generator.load_source(self.root)
        expanded = generator.expand_shared(source, source)
        self.assertEqual(set(source['paths']), set(expanded['paths']))
        for methods in expanded['paths'].values():
            for method, operation in methods.items():
                if method not in generator.METHODS: continue
                for parameter in operation.get('parameters', []):
                    self.assertIn('name', parameter)
                    self.assertIn('in', parameter)
                for status, response in operation['responses'].items():
                    self.assertIn('description', response)
                    if operation.get('x-runtime', {}).get('role') == 'user' and status.startswith('2'):
                        self.assertEqual(response['headers']['Cache-Control']['schema']['example'], 'private, no-store')
        self.assertEqual(source['components']['schemas'], expanded['components']['schemas'])

    def test_check_reports_drift_without_writing(self):
        outputs = generator.generate(self.root)
        for name, value in outputs.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding='utf-8')
        target = self.root / 'docs/api-v10/contracts.json'
        target.write_text('stale', encoding='utf-8')
        missing = self.root / 'docs/api-v10/endpoints.json'
        missing.unlink()
        with patch.object(generator, 'ROOT', self.root), patch('sys.argv', ['generate-v10.py', '--check']), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as failure:
            generator.main()
        self.assertEqual(failure.exception.code, 1)
        self.assertEqual(target.read_text(encoding='utf-8'), 'stale')
        self.assertFalse(missing.exists())

    def test_duplicate_json_keys_are_rejected(self):
        (self.root / 'api/v10/modules/common.json').write_text('{"paths":{},"paths":{},"components":{}}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'): generator.generate(self.root)

    def test_duplicate_paths_and_components_are_rejected(self):
        common = self.root / 'api/v10/modules/common.json'
        saved = common.read_text(encoding='utf-8')
        source = generator.load_source(self.root)
        path = next(iter(source['paths']))
        self.edit('modules/common.json', lambda m: m['paths'].update({path: source['paths'][path]}))
        with self.assertRaisesRegex(ValueError, 'Duplicate path'): generator.generate(self.root)
        common.write_text(saved, encoding='utf-8')
        self.edit('modules/account.json', lambda m: m['components']['schemas'].update(Problem={}))
        with self.assertRaisesRegex(ValueError, 'Duplicate component'): generator.generate(self.root)

    def test_module_manifest_rejects_omissions_duplicates_and_escape(self):
        manifest = self.root / 'api/v10/openapi.json'
        saved = manifest.read_text(encoding='utf-8')
        for mutate, message in [
            (lambda m: m['x-modules'].pop(), 'Every module'),
            (lambda m: m['x-modules'].append(m['x-modules'][0]), 'Duplicate module'),
            (lambda m: m['x-modules'].append('../outside.json'), 'Module must'),
        ]:
            with self.subTest(message=message):
                manifest.write_text(saved, encoding='utf-8')
                self.edit('openapi.json', mutate)
                with self.assertRaisesRegex(ValueError, message): generator.generate(self.root)

    def test_invalid_references_are_rejected(self):
        path = self.root / 'api/v10/modules/common.json'
        saved = path.read_text(encoding='utf-8')
        for ref, error in [('external.json#/Problem', ValueError), ('#/components/schemas/DoesNotExist', KeyError)]:
            path.write_text(saved, encoding='utf-8')
            self.edit('modules/common.json', lambda m: m['components']['schemas'].update(Invalid={'$ref': ref}))
            with self.assertRaises(error): generator.generate(self.root)

    def test_duplicate_operation_and_alias_are_rejected(self):
        path = self.root / 'api/v10/modules/authentication.json'
        saved = path.read_text(encoding='utf-8')
        def mutate(module, key):
            operations = [o for methods in module['paths'].values() for m, o in methods.items() if m in generator.METHODS and o.get('x-browser-aliases')]
            operations[1][key] = copy.deepcopy(operations[0][key])
        for key, message in [('operationId', 'Duplicate operationId'), ('x-browser-aliases', 'Duplicate browser alias')]:
            path.write_text(saved, encoding='utf-8')
            self.edit('modules/authentication.json', lambda m: mutate(m, key))
            with self.assertRaisesRegex(ValueError, message): generator.generate(self.root)

    def test_malformed_module_shapes_fail_before_publication(self):
        path = self.root / 'api/v10/modules/common.json'
        original = path.read_text(encoding='utf-8')
        for value in [[], None, {'paths': [], 'components': {}}, {'paths': {}, 'components': {'schemas': []}}]:
            with self.subTest(value=value):
                path.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ValueError): generator.generate(self.root)
                self.assertFalse((self.root / 'docs/api-v10/openapi.json').exists())
        path.write_text(original, encoding='utf-8')

    def test_non_string_references_are_rejected(self):
        self.edit('modules/common.json', lambda m: m['components']['schemas'].update(Invalid={'$ref': None}))
        with self.assertRaisesRegex(ValueError, 'Only local references'): generator.generate(self.root)

    def test_cyclic_shared_references_are_rejected(self):
        self.edit('modules/common.json', lambda m: m['components']['responses'].update(ProblemDetails={'$ref': '#/components/responses/ProblemDetails'}))
        with self.assertRaisesRegex(ValueError, 'Cyclic shared reference'): generator.generate(self.root)

    def test_inventory_order_must_be_complete(self):
        self.edit('openapi.json', lambda m: m['x-legacy-order'].pop())
        with self.assertRaisesRegex(ValueError, 'x-legacy-order'): generator.generate(self.root)


if __name__ == '__main__':
    unittest.main()
