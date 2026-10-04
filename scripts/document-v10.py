"""Generate published schemas/types from the explicitly declared V10 contracts."""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
contracts = json.loads((root / 'docs/api-v10/contracts.json').read_text(encoding='utf-8'))
entries = json.loads((root / 'docs/api-v10/endpoints.json').read_text(encoding='utf-8'))
schemas = {}
enums = {
    'period': ['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial', 'credits', 'reset', 'deposit', 'unknown'],
    'orderStatus': ['unpaid', 'processing', 'cancelled', 'completed', 'discounted', 'unknown'],
    'ticketStatus': ['open', 'closed', 'unknown'], 'orderKind': ['new', 'renewal', 'switch', 'reset', 'other'],
    'priority': ['normal', 'high', 'urgent'], 'couponType': ['amount', 'percentage', 'unknown'],
    'replyStatus': ['awaiting-user', 'awaiting-staff'],
}

def reference(name):
    return {'$ref': '#/components/schemas/' + name}

def resource(name):
    if ':' in name:
        kind, child = name.split(':', 1)
        collection = {'type': 'object', 'additionalProperties': reference(child)} if kind == 'dictionary' else {'type': 'array', 'items': reference(child)}
        return {'oneOf': [reference(child), collection]} if kind == 'flex' else collection
    return reference(name)

for name, fields in contracts['schemas'].items():
    props = {}
    for field, spec in fields.items():
        kind = spec[1] if len(spec) > 1 else None
        if kind in ['object', 'array']:
            prop = resource(('array:' if kind == 'array' else '') + spec[2])
        elif kind in enums:
            prop = {'type': 'string', 'enum': enums[kind]}
        elif kind == 'time':
            prop = {'type': 'string', 'format': 'date-time', 'nullable': True}
        elif kind in ['gb', 'integer']:
            prop = {'type': 'integer', 'format': 'int64', 'nullable': True}
        elif kind == 'number':
            prop = {'type': 'number', 'nullable': True}
        elif kind == 'strings':
            prop = {'type': 'array', 'items': {'type': 'string'}}
        elif kind == 'boolean':
            prop = {'type': 'boolean'}
        elif field in ['tags', 'emailSuffixes', 'withdrawalMethods']:
            prop = {'type': 'array', 'items': {'type': 'string'}}
        elif field in ['rate', 'percentageFee', 'commissionRate', 'discountPercent', 'speedLimitMbps', 'resetDay', 'onlineDevices', 'resetMethod', 'value', 'commissionLevelOne', 'commissionLevelTwo', 'commissionLevelThree']:
            prop = {'type': 'number', 'nullable': True}
        else:
            prop = {'type': 'string', 'nullable': True}
        if 'Bytes' in field or field == 'bytes': prop['description'] = 'Integer bytes.'
        if field.endswith('Price') or field in ['price', 'balance', 'commissionBalance', 'amount', 'orderAmount', 'fixedFee', 'totalAmount', 'discountAmount', 'creditOffset', 'refundAmount', 'balanceOffset', 'handlingAmount', 'creditedAmount', 'depositBonus']:
            prop['description'] = 'Integer minor currency units; currency is declared on the resource. Null prices are unavailable.'
        props[field] = prop
    if name in ['plan', 'order', 'credit', 'account', 'paymentMethod', 'commission', 'coupon']:
        props['currency'] = {'type': 'string', 'example': 'CNY'}
    schemas[name] = {'type': 'object', 'properties': props, 'additionalProperties': False}

def obj(props, required=None):
    return {'type': 'object', 'properties': props, **({'required': required} if required else {})}

number = {'type': 'integer'}
schemas.update({
    'scalar': {'oneOf': [{'type': 'string'}, {'type': 'boolean'}], 'nullable': True},
    'strings': {'type': 'array', 'items': {'type': 'string'}},
    'orderCreated': obj({'orderNumber': {'type': 'string'}}, ['orderNumber']),
    'orderStatus': obj({'status': {'type': 'string', 'enum': enums['orderStatus']}}, ['status']),
    'payment': obj({'kind': {'type': 'string', 'enum': ['confirmed', 'qr', 'redirect', 'pending']}, 'value': {'oneOf': [{'type': 'string'}, {'type': 'boolean'}, {'type': 'object'}], 'nullable': True}}, ['kind', 'value']),
    'authentication': obj({'accessToken': {'type': 'string'}, 'tokenType': {'type': 'string', 'enum': ['Bearer']}, 'expiresAt': {'type': 'string', 'format': 'date-time', 'nullable': True}, 'account': obj({'id': number, 'administrator': {'type': 'boolean'}})}, ['accessToken', 'tokenType', 'expiresAt', 'account']),
    'summary': obj({k: number for k in ['pendingOrders', 'pendingTickets', 'referrals']}),
    'referrals': obj({**{k: number for k in ['registeredUsers', 'earnedCommission', 'pendingCommission', 'availableCommission']}, 'commissionRate': {'type': 'number'}, 'currency': {'type': 'string'}}),
    'inbox': obj({'items': resource('array:notification'), 'unread': number}),
    'articles': {'oneOf': [reference('article'), {'type': 'object', 'additionalProperties': resource('array:article')}]},
    'Pagination': obj({k: number for k in ['page', 'pageSize', 'total', 'totalPages']}, ['page', 'pageSize', 'total', 'totalPages']),
    'Problem': obj({'type': {'type': 'string'}, 'title': {'type': 'string'}, 'status': number, 'detail': {'type': 'string'}, 'code': {'type': 'string'}, 'requestId': {'type': 'string'}, 'errors': {'type': 'object', 'additionalProperties': {'type': 'array', 'items': {'type': 'string'}}}}, ['type', 'title', 'status', 'detail', 'code', 'requestId']),
})
required = {
    'Passport/AuthController@login': ['email', 'password'], 'Passport/AuthController@register': ['email', 'password'],
    'Passport/AuthController@forget': ['email', 'password', 'emailCode'], 'Passport/AuthController@token2Login': ['verificationToken'],
    'Passport/CommController@sendEmailVerify': ['email'], 'User/OrderController@save': ['planId', 'billingPeriod'],
    'User/OrderController@checkout': ['paymentMethodId'], 'User/UserController@changePassword': ['oldPassword', 'newPassword'],
    'User/UserController@transfer': ['amount'], 'User/UserController@redeemgiftcard': ['giftCardCode'],
    'User/UsageResetController@consume': ['requestKey'], 'User/InviteController@sendEmail': ['email'],
    'User/TicketController@save': ['subject', 'priority', 'message'], 'User/TicketController@reply': ['message'],
    'User/TicketController@withdraw': ['withdrawalMethod', 'withdrawalAccount'], 'User/NoticeController@read': ['notificationId', 'version'], 'User/CouponController@check': ['code'],
}

def input_schema(field):
    if field in ['page', 'pageSize', 'planId', 'paymentMethodId', 'depositAmount', 'amount', 'days', 'articleId', 'ticketId', 'notificationId', 'version']:
        return {'type': 'integer', **({'minimum': 1, 'maximum': 100, 'default': 20} if field == 'pageSize' else {})}
    if field in ['autoRenewal', 'expiryReminders', 'trafficReminders', 'resetPassword', 'languageSelected']: return {'type': 'boolean'}
    if field == 'billingPeriod': return {'type': 'string', 'enum': enums['period'][:-1]}
    if field == 'priority': return {'type': 'string', 'enum': enums['priority']}
    if field == 'status': return {'type': 'string', 'enum': enums['orderStatus'][:-1]}
    if field == 'format': return {'type': 'string', 'enum': ['clash', 'clash-meta', 'clash-verge', 'flclash', 'sing-box', 'shadowrocket', 'surge', 'quantumult-x', 'stash', 'general']}
    return {'type': 'string', **({'format': 'email'} if field == 'email' else {})}

paths = {}
mapping = ['# Legacy → V10 mapping', '', 'Admin, operations/risk, staff and node APIs retain all existing paths and schemas. All mapped V1 routes remain callable. See contracts.json for exact field projections.', '', '| Existing symbol | V10 method and path | Permission | Resource |', '|---|---|---|---|']
for entry in entries:
    operation_id = entry['method'].lower() + ''.join(w[0].upper() + w[1:] for w in re.findall(r'[A-Za-z0-9]+', entry['path']))
    contract = contracts['endpoints'][operation_id]
    params = [{'name': p, 'in': 'path', 'required': True, 'schema': {'type': 'string'}} for p in entry['bindings']]
    params += [{'name': 'Accept-Language', 'in': 'header', 'schema': {'type': 'string'}, 'description': 'Supported language tags with optional quality weights.'}]
    properties = {field: input_schema(field) for field in contract['input']}
    request_name = operation_id + 'Input'
    schemas[request_name] = obj(properties, required.get(contract['key']))
    status = str(entry['status'])
    success = {'description': 'Success', 'headers': {'X-Request-ID': {'schema': {'type': 'string'}}, 'Content-Language': {'schema': {'type': 'string'}}}}
    if status != '204':
        if contract['raw']:
            media = 'application/octet-stream' if 'banner-images' in entry['path'] else ('text/plain' if entry['path'].startswith('webhooks/') else 'application/yaml')
            success['content'] = {media: {'schema': {'type': 'string', **({'format': 'binary'} if media == 'application/octet-stream' else {})}}}
            if entry['path'].startswith('subscriptions/'):
                success['content']['application/json'] = {'schema': {'type': 'object', 'description': 'Native client configuration, not a JSON API envelope.'}}
        else:
            success['content'] = {'application/json': {'schema': obj({'data': resource(contract['output']), 'meta': obj({'pagination': reference('Pagination'), 'taskId': {'type': 'string'}})}, ['data'])}}
    responses = {status: success}
    if not contract['raw']:
        for code in [401, 403, 404, 409, 410, 422, 429, 500]: responses[str(code)] = {'description': 'Problem details', 'content': {'application/problem+json': {'schema': reference('Problem')}}}
    if entry['path'] == 'me/nodes':
        params.append({'name': 'If-None-Match', 'in': 'header', 'schema': {'type': 'string'}})
        responses['304']={'description':'Unchanged node list; empty body, ETag retained.'}
    operation = {'operationId': operation_id, 'tags': [entry['scope']], 'summary': entry['method'] + ' ' + entry['path'], 'parameters': params, 'responses': responses, 'security': [{'bearerAuth': []}] if entry['role'] == 'user' else [], 'x-permission': entry['role'], 'x-legacy-path': '/api/v1/' + entry['legacy']}
    if entry['role'] == 'user': operation['description'] = 'Requires an active session. Order and ticket identifiers are checked against the authenticated owner. Unauthenticated: 401; banned account: 403.'
    if entry['path'].startswith('webhooks/'):
        operation['description'] = 'Provider-native signature verification and response. Payment notifications are idempotent; Telegram requires X-Telegram-Bot-Api-Secret-Token. Historical callback URLs remain supported.'
        operation['requestBody'] = {'content': {'application/json': {'schema': {'type': 'object'}}, 'application/x-www-form-urlencoded': {'schema': {'type': 'object'}}}}
    elif entry['method'] == 'GET':
        operation['parameters'] += [{'name': f, 'in': 'query', 'schema': v} for f, v in properties.items()]
    elif properties:
        operation['requestBody'] = {'required': bool(required.get(contract['key'])), 'content': {'application/json': {'schema': reference(request_name)}}}
    for method in entry.get('methods', [entry['method']]):
        paths.setdefault('/' + entry['path'], {})[method.lower()] = {**operation, 'operationId': operation_id + (method.title() if method != entry['method'] else '')}
    mapping.append(f"| `{entry['legacyMethod']} {entry['legacy']}` | `{entry['method']} /api/v10/{entry['path']}` | {entry['role']} | {contract['output']} |")

document = {'openapi': '3.0.3', 'info': {'title': 'FastDog user API', 'version': '10.0.0', 'description': 'Parallel user API. Administrative, staff, operations and node communication contracts are unchanged.'}, 'servers': [{'url': '/api/v10'}], 'paths': paths, 'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT'}}, 'schemas': schemas}}
(root / 'docs/api-v10/openapi.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(root / 'docs/api-v10/mapping.md').write_text('\n'.join(mapping) + '\n', encoding='utf-8')

def ts_type(schema):
    if '$ref' in schema: return 'V10' + schema['$ref'].split('/')[-1][0].upper() + schema['$ref'].split('/')[-1][1:]
    if 'oneOf' in schema: base = ' | '.join(ts_type(s) for s in schema['oneOf'])
    elif 'enum' in schema: base = ' | '.join(json.dumps(s) for s in schema['enum'])
    elif schema.get('type') == 'array': base = 'Array<' + ts_type(schema['items']) + '>'
    elif schema.get('type') == 'object':
        if 'additionalProperties' in schema and isinstance(schema['additionalProperties'], dict): base = 'Record<string, ' + ts_type(schema['additionalProperties']) + '>'
        else: base = '{ ' + '; '.join(json.dumps(k) + ('' if k in schema.get('required', []) else '?') + ': ' + ts_type(v) for k, v in schema.get('properties', {}).items()) + ' }'
    else: base = {'integer': 'number', 'number': 'number', 'boolean': 'boolean', 'string': 'string'}.get(schema.get('type'), 'unknown')
    return base + (' | null' if schema.get('nullable') else '')

types = ['// Generated by scripts/document-v10.py from explicit resource schemas. Do not edit.', 'export interface V10Envelope<T> { data: T; meta?: { pagination?: V10Pagination; taskId?: string } }']
for name, schema in schemas.items(): types.append('export type V10' + name[0].upper() + name[1:] + ' = ' + ts_type(schema) + ';')
(root / 'frontend/src/v10-types.ts').write_text('\n'.join(types) + '\n', encoding='utf-8')
