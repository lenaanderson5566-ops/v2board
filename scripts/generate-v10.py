"""Generate V10 publications from api/v10/openapi.json, without rewriting PHP routes."""
import argparse
import copy
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options'}
INTERNAL = {'x-runtime', 'x-runtime-resource', 'x-runtime-field', 'x-legacy-entry', 'x-browser-aliases', 'x-node-path', 'x-node-schema', 'x-node-legacy', 'x-legacy-order', 'x-node-order'}
def public(value):
    if isinstance(value, dict): return {k: public(v) for k, v in value.items() if k not in INTERNAL}
    if isinstance(value, list): return [public(v) for v in value]
    return value
def type_name(name): return 'V10' + name[0].upper() + name[1:]
def ts(schema):
    if '$ref' in schema: value = type_name(schema['$ref'].split('/')[-1])
    elif schema.get('enum') == ['CNY', 'USD']: value = 'SettlementCurrency'
    elif 'oneOf' in schema or 'anyOf' in schema: value = '(' + ' | '.join(ts(s) for s in schema.get('oneOf', schema.get('anyOf'))) + ')'
    elif 'allOf' in schema: value = '(' + ' & '.join(ts(s) for s in schema['allOf']) + ')'
    elif 'enum' in schema: value = ' | '.join(json.dumps(v, ensure_ascii=False) for v in schema['enum'])
    elif schema.get('type') == 'array': value = 'Array<' + ts(schema['items']) + '>'
    elif schema.get('type') == 'object':
        fields = [json.dumps(k) + ('' if k in schema.get('required', []) else '?') + ': ' + ts(v) for k, v in schema.get('properties', {}).items()]
        extra = schema.get('additionalProperties')
        value = '{ ' + '; '.join(fields) + ' }'
        if extra:
            record = 'Record<string, ' + (ts(extra) if isinstance(extra, dict) else 'unknown') + '>'
            value = '(' + value + ' & ' + record + ')' if fields else record
    else: value = {'integer': 'number', 'number': 'number', 'boolean': 'boolean', 'string': 'string'}.get(schema.get('type'), 'unknown')
    return value + (' | null' if schema.get('nullable') else '')
def generate(root):
    source = json.loads((root / 'api/v10/openapi.json').read_text(encoding='utf-8'))
    document = public(source)
    schemas = {name: {k: f['x-runtime-field'] for k, f in s['properties'].items() if 'x-runtime-field' in f} for name, s in source['components']['schemas'].items() if s.get('x-runtime-resource')}
    contracts, legacy, nodes, ids = {}, {}, {}, set()
    aliases = {key: {} for key in ['routes', 'details', 'methodRoutes']}
    for path, methods in source['paths'].items():
        for method, operation in methods.items():
            if method not in METHODS: continue
            name = operation['operationId']
            if name in ids: raise ValueError('Duplicate operationId: ' + name)
            ids.add(name)
            if 'x-runtime' in operation:
                contract = copy.deepcopy(operation['x-runtime'])
                contract.update(path=path.lstrip('/'), method=method.upper())
                contracts[name] = contract
                if 'x-legacy-entry' in operation:
                    entry = copy.deepcopy(operation['x-legacy-entry'])
                    entry.update({k: contract[k] for k in ['path', 'method', 'bindings', 'role', 'status']})
                    legacy[name] = entry
                for kind, names in operation.get('x-browser-aliases', {}).items():
                    for alias in names:
                        if alias in aliases[kind]: raise ValueError('Duplicate browser alias: ' + alias)
                        aliases[kind][alias] = name
            if 'x-node-legacy' in operation: nodes[path + ' ' + method.upper()] = {'method': method.upper(), 'path': path, 'legacy': operation['x-node-legacy']}
    for key, data in [('x-legacy-order', legacy), ('x-node-order', nodes)]:
        if set(source[key]) != set(data) or len(source[key]) != len(data): raise ValueError(key + ' must contain each annotated operation exactly once')
    entries = [legacy[key] for key in source['x-legacy-order']]
    node = {'paths': {p: document['paths'][p] for p, v in source['paths'].items() if v.get('x-node-path')}, 'schemas': {n: document['components']['schemas'][n] for n, v in source['components']['schemas'].items() if v.get('x-node-schema')}, 'endpoints': [nodes[key] for key in source['x-node-order']]}
    def references(value):
        if isinstance(value, dict):
            if '$ref' in value:
                target, ref = source, value['$ref']
                if not ref.startswith('#/'): raise ValueError('Only local references supported: ' + ref)
                for part in ref[2:].split('/'): target = target[part.replace('~1', '/').replace('~0', '~')]
            for child in value.values(): references(child)
        elif isinstance(value, list):
            for child in value: references(child)
    references(source)
    for fields in schemas.values():
        for spec in fields.values():
            if len(spec) > 2 and spec[1] in ['array', 'object'] and spec[2] not in schemas: raise ValueError('Missing projected resource: ' + spec[2])
    types = ['// Generated by scripts/generate-v10.py from api/v10/openapi.json. Do not edit.', '// Monetary amounts use integer minor units in an explicit currency.', 'export type SettlementCurrency = "CNY" | "USD";', 'export interface V10Envelope<T> { data: T; meta?: { pagination?: V10Pagination; taskId?: string } }']
    types += ['export type ' + type_name(n) + ' = ' + ts(s) + ';' for n, s in document['components']['schemas'].items()]
    # Inline request bodies follow the same public naming convention as named inputs.
    for methods in document['paths'].values():
        for method, operation in methods.items():
            if method not in METHODS: continue
            name = operation['operationId'] + 'Input'
            body = operation.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema')
            if body and name not in document['components']['schemas']:
                types.append('export type ' + type_name(name) + ' = ' + ts(body) + ';')
    types += ['export type MfaMethod = V10MfaChallenge["methods"][number];', 'export type V10MfaPurpose = V10PostMeMfaChallengesInput["purpose"];']
    types += ['export type V10LoginResult = V10Authentication | V10MfaChallenge;', 'export type V10DeleteMeSessionsInput = Record<string, never>;', 'export type V10GetPublicAnalyticsConfigurationInput = Record<string, never>;']
    rows = ['| Existing symbol | V10 method and path | Permission | Resource |', '|---|---|---|---|']
    for key in source['x-legacy-order']:
        entry, contract = legacy[key], contracts[key]
        label = 'New native resource' if entry.get('key') else entry['legacyMethod'] + ' ' + entry['legacy']
        rows.append(f"| `{label}` | `{contract['method']} /api/v10/{contract['path']}` | {contract['role']} | {contract['output']} |")
    mapping = (root / 'api/v10/mapping-notes.md').read_text(encoding='utf-8')
    if mapping.count('<!-- operation-table -->') != 1: raise ValueError('Exactly one operation-table marker required')
    mapping = mapping.replace('<!-- operation-table -->', '\n'.join(rows)).rstrip()
    if mapping.count('<!-- node-table -->') != 1: raise ValueError('Exactly one node-table marker required')
    node_rows = ['| Legacy | V10 |', '|---|---|']
    for entry in node['endpoints']: node_rows.append(f"| `{entry['legacy']}` | `{entry['method']} /api/v10{entry['path']}` |")
    mapping = mapping.replace('<!-- node-table -->', '\n'.join(node_rows)) + '\n'
    runtime = {'schemas': schemas, 'endpoints': contracts}
    outputs = {'docs/api-v10/openapi.json': document, 'docs/api-v10/contracts.json': runtime, 'docs/api-v10/endpoints.json': entries, 'docs/api-v10/node-api.json': node, 'frontend/src/shared/v10-contracts.json': {**runtime, **aliases}}
    outputs = {path: json.dumps(value, ensure_ascii=False, indent=2) + '\n' for path, value in outputs.items()}
    outputs.update({'frontend/src/shared/v10-types.ts': '\n'.join(types) + '\n', 'docs/api-v10/mapping.md': mapping})
    return outputs
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail on drift; never write files')
    args = parser.parse_args()
    outputs = generate(ROOT)
    changed = [n for n, v in outputs.items() if not (ROOT / n).exists() or (ROOT / n).read_text(encoding='utf-8') != v]
    if args.check:
        if changed: parser.exit(1, 'Generated V10 files differ; run python scripts/generate-v10.py:\n' + '\n'.join(changed) + '\n')
        print(f'V10 contract: {len(outputs)} generated files are current')
    else:
        for n in changed: (ROOT / n).write_text(outputs[n], encoding='utf-8')
        print(f'V10 contract: updated {len(changed)} of {len(outputs)} generated files')
if __name__ == '__main__': main()
