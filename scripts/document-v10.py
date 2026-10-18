"""Generate published schemas/types from the explicitly declared V10 contracts."""
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
timezone_only = '--timezone-only' in sys.argv
telegram_only = '--telegram-only' in sys.argv or timezone_only
published = json.loads((root / 'docs/api-v10/openapi.json').read_text(encoding='utf-8')) if telegram_only else None
published_types = (root / 'frontend/src/shared/v10-types.ts').read_text(encoding='utf-8') if telegram_only else None
published_mapping = (root / 'docs/api-v10/mapping.md').read_text(encoding='utf-8') if telegram_only else None
contracts = json.loads((root / 'docs/api-v10/contracts.json').read_text(encoding='utf-8'))
entries = json.loads((root / 'docs/api-v10/endpoints.json').read_text(encoding='utf-8'))
schemas = {}
enums = {
    'period': ['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial', 'credits', 'reset', 'deposit', 'unknown'],
    'orderStatus': ['unpaid', 'processing', 'cancelled', 'completed', 'discounted', 'unknown'],
    'ticketStatus': ['open', 'closed', 'unknown'], 'orderKind': ['new', 'renewal', 'switch', 'reset', 'other'],
    'priority': ['normal', 'high', 'urgent'],
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
        if name == 'node' and field == 'displayNames': prop = {'type':'object','additionalProperties':{'type':'string'}}
        if field == 'currency': prop = {'type': 'string', 'enum': ['CNY', 'USD']}
        if field == 'ticketCreation': prop = {'type': 'string', 'enum': ['allowed', 'purchase_required', 'closed']}
        if 'Bytes' in field or field == 'bytes': prop['description'] = 'Integer bytes.'
        if field.endswith('Price') or field in ['price', 'balance', 'commissionBalance', 'amount', 'orderAmount', 'fixedFee', 'totalAmount', 'discountAmount', 'creditOffset', 'refundAmount', 'balanceOffset', 'handlingAmount', 'creditedAmount', 'depositBonus']:
            prop['description'] = 'Integer minor currency units; currency is declared on the resource. Null prices are unavailable.'
        props[field] = prop
    if name in ['plan', 'order', 'credit', 'account', 'paymentMethod', 'commission']:
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
    'inbox': obj({'items': resource('array:notification'), 'unread': number, 'ticketReplies':resource('array:ticketNotification'), 'ticketUnread':number}),
    'articles': {'oneOf': [reference('article'), {'type': 'object', 'additionalProperties': resource('array:article')}]},
    'Pagination': obj({k: number for k in ['page', 'pageSize', 'total', 'totalPages']}, ['page', 'pageSize', 'total', 'totalPages']),
    'Problem': obj({'type': {'type': 'string'}, 'title': {'type': 'string', 'description': 'Human-readable summary localized using Accept-Language; use code for programmatic handling.'}, 'status': number, 'detail': {'type': 'string', 'description': 'Localized, safe explanation. Does not contain stack traces or internal paths.'}, 'code': {'type': 'string'}, 'requestId': {'type': 'string'}, 'errors': {'type': 'object', 'additionalProperties': {'type': 'array', 'items': {'type': 'string'}}}}, ['type', 'title', 'status', 'detail', 'code', 'requestId']),
})


# Fixed analytics schemas; never infer fields from browser payloads.
schemas["analyticsConfiguration"] = {'type': 'object', 'additionalProperties': False, 'required': ['enabled', 'retentionDays'], 'properties': {'enabled': {'type': 'boolean'}, 'retentionDays': {'type': 'integer', 'enum': [7, 30, 90]}}}
schemas["analyticsEvent"] = {'type': 'object', 'additionalProperties': False, 'required': ['sessionId', 'page', 'device', 'language', 'consent'], 'properties': {'sessionId': {'type': 'string', 'format': 'uuid'}, 'page': {'type': 'string', 'enum': ['landing', 'register', 'login', 'forget', 'dashboard', 'plan', 'confirmation', 'payment', 'order', 'order_detail', 'activities', 'coupons', 'subscribe', 'knowledge', 'profile', 'security', 'invite', 'traffic', 'notifications', 'ticket']}, 'device': {'type': 'string', 'enum': ['desktop', 'mobile', 'tablet']}, 'language': {'type': 'string', 'enum': ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'ru-RU', 'fa-IR', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'id-ID', 'th-TH']}, 'consent': {'type': 'boolean', 'enum': [True]}}}

release_schema = schemas['fastaiRelease']
release_schema['required'] = ['platform', 'architecture', 'channel', 'latestVersion', 'latestBuild', 'minimumVersion', 'downloadUrl', 'sha256', 'publishedAt']
for field in release_schema['required']:
    release_schema['properties'][field].pop('nullable', None)
release_schema['properties']['platform']['enum'] = ['windows', 'android', 'macos', 'linux']
release_schema['properties']['architecture']['enum'] = ['x64', 'arm64', 'arm', 'x86']
release_schema['properties']['channel']['enum'] = ['stable']
for field in ['latestVersion', 'minimumVersion']:
    release_schema['properties'][field]['pattern'] = r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
release_schema['properties']['latestBuild'].update({'minimum': 1, 'maximum': 2100000000})
release_schema['properties']['downloadUrl'].update({'format': 'uri', 'pattern': '^https://'})
release_schema['properties']['sha256']['pattern'] = '^[a-f0-9]{64}$'
release_schema['properties']['publishedAt']['format'] = 'date-time'

currency_description = 'Amounts are integer minor units in explicit CNY or USD. Existing assets remain CNY; account and order currencies are immutable.'
for schema in schemas.values():
    currency = schema.get('properties', {}).get('currency')
    if currency is not None:
        currency.update({'enum': ['CNY', 'USD'], 'description': currency_description})
schemas['preferences']['properties']['currency']['nullable'] = True
schemas['referrals']['properties']['rewards'] = obj({
    'registrationBytes': {'type': 'integer', 'minimum': 0, 'description': 'Traffic credit in bytes; 0 disables the reward for new registrations.'},
    'firstUseBytes': {'type': 'integer', 'minimum': 0, 'description': 'Traffic credit in bytes; 0 disables the reward for new registrations.'},
    'validityMonths': {'type': 'integer', 'minimum': 1, 'maximum': 120, 'description': 'Invitation credit validity in calendar months from each grant; default 1.'},
})
required = {
    'Guest/FastaiController@release': ['platform','architecture'],
    'Client/ClientController@authenticatedConfig': ['clientVersion', 'platform'],
    'Passport/AuthController@login': ['email', 'password'], 'Passport/AuthController@register': ['email', 'password'],
    'Passport/AuthController@forget': ['email', 'password', 'emailCode'], 'Passport/AuthController@token2Login': ['verificationToken'],
    'Passport/CommController@sendEmailVerify': ['email'], 'User/OrderController@save': ['planId', 'billingPeriod'],
    'User/OrderController@checkout': ['paymentMethodId'], 'User/UserController@changePassword': ['oldPassword', 'newPassword'],
    'User/UserController@transfer': ['amount'], 'User/UserController@redeemgiftcard': ['giftCardCode'],
    'User/UsageResetController@consume': ['requestKey'], 'User/InviteController@sendEmail': ['email'],
    'User/TicketController@save': ['subject', 'priority', 'message'], 'User/TicketController@reply': ['message'],
    'User/TicketController@withdraw': ['withdrawalMethod', 'withdrawalAccount'], 'User/NoticeController@readTicket':['ticketId','version'], 'User/NoticeController@read': ['notificationId', 'version'],
}

required.update({'Passport/ClientAuthorizationController@create':['codeChallenge','state','redirectUri','platform'], 'Passport/ClientAuthorizationController@exchange':['authorizationCode','codeVerifier','redirectUri']})

required['User/ClientEventController@store'] = ['clientVersion', 'platform', 'events']
required['User/DiagnosticController@store'] = ['clientVersion', 'platform', 'checks']
schemas['diagnosticReceipt'] = {'type':'object','required':['reportId'],'properties':{'reportId':{'type':'string','format':'uuid'}}}

def input_schema(field):
    if field == 'events': return {'type':'array','minItems':1,'maxItems':30,'items':{'type':'object','additionalProperties':False,'required':['name','outcome','elapsedMs','errorClass'],'properties':{'name':{'type':'string','enum':['connection','config_sync','subscription_sync','account_sync']},'outcome':{'type':'string','enum':['success','failure']},'elapsedMs':{'type':'integer','minimum':0,'maximum':300000},'errorClass':{'type':'string','enum':['none','timeout','network','certificate','authentication','policy','server','unknown']}}}}

    if field == 'displayTimeZone': return {'type': 'string', 'nullable': True, 'description': 'IANA time zone; null follows the device display time zone.'}
    if field == 'checks': return {'type': 'array', 'minItems': 1, 'maxItems': 9, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'status'], 'properties': {'id': {'type': 'string', 'enum': ['dns', 'website', 'proxy', 'settings', 'systemProxy', 'route', 'tcp', 'tls', 'reference']}, 'status': {'type': 'string', 'enum': ['passed', 'failed', 'skipped', 'unverified']}, 'elapsedMs': {'type': 'integer', 'minimum': 0, 'maximum': 300000, 'nullable': True}}}}
    if field in ['state','codeChallenge']: return {'type':'string','pattern':'^[A-Za-z0-9_-]{43}$'}
    if field == 'authorizationCode': return {'type':'string','pattern':'^[a-f0-9]{64}$'}
    if field == 'codeVerifier': return {'type':'string','pattern':'^[A-Za-z0-9._~-]{43,128}$'}
    if field == 'redirectUri': return {'type':'string','maxLength':255}
    if field == 'architecture': return {'type':'string','enum':['x64','arm64','arm','x86']}
    if field == 'core': return {'type': 'string', 'enum': ['mihomo', 'sing-box']}
    if field == 'clientVersion': return {'type': 'string', 'pattern': r'^\d+(?:\.\d+){1,3}$'}
    if field == 'platform': return {'type': 'string', 'enum': ['windows', 'android', 'macos', 'linux', 'ios']}
    if field in ['page', 'pageSize', 'planId', 'paymentMethodId', 'depositAmount', 'amount', 'days', 'articleId', 'ticketId', 'notificationId', 'version']:
        return {'type': 'integer', **({'minimum': 1, 'maximum': 100, 'default': 20} if field == 'pageSize' else {})}
    if field in ['autoRenewal', 'expiryReminders', 'trafficReminders', 'serviceNotifications', 'announcementEmails', 'resetPassword', 'languageSelected']: return {'type': 'boolean'}
    if field == 'billingPeriod': return {'type': 'string', 'enum': enums['period'][:-1]}
    if field == 'priority': return {'type': 'string', 'enum': enums['priority']}
    if field == 'status': return {'type': 'string', 'enum': enums['orderStatus'][:-1]}
    if field == 'format': return {'type': 'string', 'enum': ['clash-verge', 'flclash', 'sing-box', 'shadowrocket', 'surge', 'quantumult-x', 'stash', 'mihomo', 'clash-nyanpasu', 'clash-for-android', 'clash-for-windows', 'clashx', 'loon', 'surfboard', 'sagernet', 'passwall', 'ssr-plus', 'shadowsocks', 'v2rayn', 'v2rayng', 'v2raytun', 'clash-party', 'throne', 'nekobox', 'husi']}
    return {'type': 'string', **({'format': 'email'} if field == 'email' else {})}

required['User/TelegramController@confirmBinding'] = ['telegramId']
paths = {}
mapping = ['# Legacy → V10 mapping', '', 'Payment methods expose category (regular/crypto), asset, assetIconUrl, network, networkName and networkIconUrl. Existing channels default to regular. No provider config or credentials are exposed; paymentMethodId and CNY fee semantics remain unchanged.', '', 'Account notification preference: `GET/PATCH /me` exposes boolean `serviceNotifications`, mapped to shared `remind_service` (default true).', '', 'Admin, operations/risk and supported node APIs retain their API versions. The unfinished staff API is retired. Legacy symbols are historical mappings, not a list of callable routes. Only the explicit retained-endpoints allowlist remains callable. See contracts.json for exact field projections.', '', '| Existing symbol | V10 method and path | Permission | Resource |', '|---|---|---|---|']
for entry in entries:
    operation_id = entry['method'].lower() + ''.join(w[0].upper() + w[1:] for w in re.findall(r'[A-Za-z0-9]+', entry['path']))
    contract = contracts['endpoints'][operation_id]
    params = [{'name': p, 'in': 'path', 'required': True, 'schema': {'type': 'string'}} for p in entry['bindings']]
    params += [{'name': 'Accept-Language', 'in': 'header', 'schema': {'type': 'string'}, 'description': 'Supported language tags with optional quality weights.'}]
    properties = {field: input_schema(field) for field in contract['input']}
    request_name = operation_id + 'Input'
    schemas[request_name] = obj(properties, required.get(contract['key']))
    if operation_id == 'postPublicAnalyticsEvents':
        schemas[request_name] = schemas['analyticsEvent']
    status = str(entry['status'])
    success = {'description': 'Success', 'headers': {'X-Request-ID': {'schema': {'type': 'string'}}, 'Content-Language': {'schema': {'type': 'string'}}}}
    if status != '204':
        if contract['raw']:
            media = 'application/octet-stream' if ('banner-images' in entry['path'] or 'client-installers' in entry['path']) else ('text/plain' if entry['path'].startswith('webhooks/') else 'application/yaml')
            success['content'] = {media: {'schema': {'type': 'string', **({'format': 'binary'} if media == 'application/octet-stream' else {})}}}
            if entry['path'].startswith('subscriptions/'):
                success['content']['application/json'] = {'schema': {'type': 'object', 'description': 'Native client configuration, not a JSON API envelope.'}}
        else:
            success['content'] = {'application/json': {'schema': obj({'data': resource(contract['output']), 'meta': obj({'pagination': reference('Pagination'), 'taskId': {'type': 'string'}})}, ['data'])}}
    responses = {status: success}
    if not contract['raw'] or entry['role'] in ['user', 'subscription'] or entry.get('key') == 'Public/MirrorController@download':
        for code in [401, 403, 404, 409, 410, 422, 429, 500]: responses[str(code)] = {'description': 'Problem details', 'content': {'application/problem+json': {'schema': reference('Problem')}}}
    if entry['path'] == 'me/nodes':
        params.append({'name': 'If-None-Match', 'in': 'header', 'schema': {'type': 'string'}})
        responses['304']={'description':'Unchanged node list; empty body, ETag retained.'}
    operation = {'operationId': operation_id, 'tags': [entry['scope']], 'summary': entry['method'] + ' ' + entry['path'], 'parameters': params, 'responses': responses, 'security': [{'bearerAuth': []}] if entry['role'] == 'user' else [], 'x-permission': entry['role']}
    if entry['role'] == 'subscription':
        responses['429']['headers'] = {'Retry-After': {'schema': {'type': 'integer', 'minimum': 1}, 'description': 'Seconds until retry is permitted.'}}
        operation['description'] = 'Subscription credentials are required. Per-IP and shared per-account fixed-window limits apply across token subscription endpoints. Configuration downloads additionally require a recognized client UA with subscription access enabled; unknown UA returns 403, Retired flag parameters, legacy format names, General and incompatible formats return 422. Authenticated /me/client-config uses its dedicated client policy.'
    if not entry.get('key'): operation['x-legacy-path'] = '/api/v1/' + entry['legacy']
    if entry.get('key') == 'Public/MirrorController@download':
        operation['description'] = 'Published third-party mirror or uploaded FastAI installer download. FastAI IDs use the fastai- UUID prefix. Uploaded drafts and historical packages not in the current release catalog return 404; current FastAI access/version policy applies. Supports HEAD and byte ranges; binary content is not enveloped. Unknown IDs return 404.'
        params.append({'name': 'Range', 'in': 'header', 'schema': {'type': 'string'}})
        responses['206'] = {**success, 'description': 'Partial installer content'}
        responses['416'] = {'description': 'Requested range is not satisfiable'}
    if entry['role'] == 'user': operation['description'] = 'Requires an active session. Order and ticket identifiers are checked against the authenticated owner. Unauthenticated: 401; banned account: 403.'
    if contracts['endpoints'][operation_id].get('description'):
        operation['description'] = operation.get('description', '') + ' ' + contracts['endpoints'][operation_id]['description']
    if contract['key'] == 'User/OrderController@save':
        operation['description'] += ' Deposit orders require planId 0 and a positive integer depositAmount in minor currency units; other billing periods require a positive planId.'
        operation['description'] += ' Unconfigured or negative period prices are rejected with 409; an explicit zero price remains valid.'
    if contract['key'] == 'User/OrderController@checkout':
        operation['description'] += ' Historical orders with negative totals are rejected with 409; zero totals use the free checkout flow.'
    if entry['path'].startswith('webhooks/'):
        operation['description'] = 'Provider-native signature verification and response. Payment notifications are idempotent; Telegram requires X-Telegram-Bot-Api-Secret-Token. New payments use V10 callback URLs, including custom callback domains. Old payment callbacks remain compatible for existing orders. Historical callback URLs remain supported.'
        operation['requestBody'] = {'content': {'application/json': {'schema': {'type': 'object'}}, 'application/x-www-form-urlencoded': {'schema': {'type': 'object'}}}}
        if entry['path'] == 'webhooks/telegram':
            operation['description'] += ' The bot must be enabled with a nonempty configured token; disabled, unconfigured or invalid credentials return 401.'
            params.append({'name': 'X-Telegram-Bot-Api-Secret-Token', 'in': 'header', 'required': True, 'schema': {'type': 'string'}})
            responses['401'] = {'description': 'Bot disabled, token unconfigured, or invalid webhook secret'}
    elif entry['method'] == 'GET':
        operation['parameters'] += [{'name': f, 'in': 'query', 'schema': v, **({'required': True} if f in required.get(contract['key'], []) else {})} for f, v in properties.items()]
    elif properties:
        operation['requestBody'] = {'required': bool(required.get(contract['key'])), 'content': {'application/json': {'schema': reference(request_name)}}}
    for method in entry.get('methods', [entry['method']]):
        paths.setdefault('/' + entry['path'], {})[method.lower()] = {**operation, 'operationId': operation_id + (method.title() if method != entry['method'] else '')}
    legacy_label = 'New native resource' if entry.get('key') else entry['legacyMethod'] + ' ' + entry['legacy']
    mapping.append(f"| `{legacy_label}` | `{entry['method']} /api/v10/{entry['path']}` | {entry['role']} | {contract['output']} |")

# Native clients keep bearer authentication; browser responses contain only session metadata.
native_authentication = schemas['authentication']
schemas['browserSession'] = obj({'accountId': {'type':'integer','nullable':True}, 'authenticated': {'type':'boolean'}, 'csrfToken': {'type':'string'}, 'expiresAt': {'type':'string','format':'date-time','nullable':True}}, ['accountId','authenticated','csrfToken','expiresAt'])
schemas['authentication'] = {'oneOf':[native_authentication, reference('browserSession')]}
for path, operations in paths.items():
    for operation in operations.values():
        if isinstance(operation, dict) and operation.get('security'):
            operation['security'].append({'browserUserCookie':[]})
        if isinstance(operation, dict) and (path.startswith('/auth/') or any('bearerAuth' in scheme for scheme in operation.get('security', []))):
            for status, response in operation.get('responses', {}).items():
                if not str(status).startswith('2'):
                    continue
                response.setdefault('headers', {})['Cache-Control'] = {'schema': {'type': 'string', 'example': 'private, no-store'}, 'description': 'Authenticated user and authentication responses must not be stored.'}
paths['/auth/registrations']['post']['description'] = 'Browser registration requires X-Browser-Client, CSRF and an exact allowed Origin; grants a scoped HttpOnly cookie and returns only browserSession metadata. Native clients retain Bearer authentication output.'
document = {'openapi': '3.0.3', 'info': {'title': 'FastDog user API', 'version': '10.0.0', 'description': 'Parallel user API. Administrative, operations and node communication contracts are unchanged. The unfinished staff API is retired.'}, 'servers': [{'url': '/api/v10'}], 'paths': paths, 'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT'}, 'browserUserCookie': {'type':'apiKey','in':'cookie','name':'__Host-fastdog_user','description':'Scoped HttpOnly session; browser mutations also require X-Browser-Client, X-CSRF-Token and an allowed Origin.'}}, 'schemas': schemas}}
if '/me/client-config' in document['paths']:
    document['paths']['/me/client-config']['get']['responses']['200']['content']['application/json'] = {'schema': {'type': 'object', 'properties': {'data': {'type': 'object', 'required': ['configVersion', 'yaml', 'nodes'], 'properties': {'configVersion': {'type': 'string'}, 'yaml': {'type': 'string'}, 'nodes': {'type': 'array', 'items': {'type': 'object', 'properties': {'nodeId': {'type': 'string'}, 'proxyName': {'type': 'string'}, 'name': {'type': 'string'}, 'regionCode': {'type': 'string', 'nullable': True}, 'cityCode': {'type': 'string', 'nullable': True}, 'displayLabel': {'type': 'string', 'nullable': True}, 'tags': {'type': 'array', 'items': {'type': 'string'}}, 'displayNames': {'type': 'object', 'additionalProperties': {'type': 'string'}}}}}}}}}}

if '/me/client-config' in document['paths']:
    native = document['paths']['/me/client-config']['get']['responses']['200']['content']['application/json']['schema']['properties']['data']
    native['required'] = ['configVersion', 'nodes']
    native['properties'].update({'core': {'type': 'string', 'enum': ['sing-box']}, 'coreVersion': {'type': 'string', 'example': '1.14.3'}, 'configuration': {'type': 'object', 'description': 'Native sing-box configuration; app supplies local inbounds.'}})
    native['oneOf'] = [{'required': ['yaml']}, {'required': ['core', 'coreVersion', 'configuration']}]

location_description = 'Canonical location identifier for a state, province or city; legacy cityCode field name is retained for compatibility.'
if 'cityCode' in schemas.get('node', {}).get('properties', {}):
    schemas['node']['properties']['cityCode']['description'] = location_description
if '/me/client-config' in document['paths']:
    document['paths']['/me/client-config']['get']['responses']['200']['content']['application/json']['schema']['properties']['data']['properties']['nodes']['items']['properties']['cityCode']['description'] = location_description

event_operation = document['paths']['/me/client-events']['post']
event_operation['description'] = 'Optional account-linked runtime events, disabled by default in the app. At most 30 events per batch and 12 batches per account per hour; 16 KiB body limit. Default retention 30 days, administrator configurable. No browsing history, addresses, credentials or configuration content. Client-reported results are not proof of connectivity or online status.'
event_operation['responses']['413'] = {'description':'Request body exceeds 16 KiB'}
schemas['postMeClientEventsInput']['additionalProperties'] = False
mapping.extend(['', '## Client runtime events', '', 'POST /api/v10/me/client-events accepts opt-in, account-linked version/platform and bounded connection/synchronization outcomes, durations and error categories. At most 30 events/batch, 12 batches/account/hour and 16 KiB/body; default retention 30 days. No browsing history, addresses, credentials or configuration content. The previous diagnostic endpoint remains compatible with installed older clients.'])

diagnostic_operation = document['paths']['/me/diagnostic-reports']['post']
diagnostic_operation['description'] = 'Manual authenticated diagnostic submission; five reports per account per hour. Default retention 30 days, configurable by administrator. No raw parameters, IP addresses, credentials or browsing history.'
schemas['postMeDiagnosticReportsInput']['additionalProperties'] = False
mapping.extend(['', '## Client diagnostics', '', 'POST /me/diagnostic-reports accepts manual, user-approved check results only. The server derives account identity and returns reportId. Five reports/account/hour; default retention 30 days, configurable under log settings.'])

mapping.extend(['', '## Telegram community', '', 'Binding uses a 10-minute one-time deep link, bot acknowledgement and an authenticated website confirmation with the expected Telegram ID. Subscription URLs are never binding credentials. Group invitation links require join approval; entitlement is a non-banned bound account with a plan and an unexpired term or configured grace (default 3 days). Traffic exhaustion is not a group removal condition.'])

if telegram_only:
    for path, operation in document['paths'].items():
        if ('/telegram' in path and not timezone_only) or (timezone_only and path in ['/me','/me/subscription','/me/preferences/options']): published['paths'][path] = operation
    for name, schema in document['components']['schemas'].items():
        if ((name.lower() == 'bot' or 'telegram' in name.lower()) and not timezone_only) or (timezone_only and name in ['account','subscription','preferences','traffic','timeZoneChoice','patchMeInput']): published['components']['schemas'][name] = schema
    document = published
    new_rows = [] if timezone_only else [line for line in mapping if line.startswith('|') and '/telegram' in line]
    mapping = [line for line in published_mapping.splitlines() if timezone_only or not (line.startswith('|') and '/telegram' in line)]
    position = next((i for i, line in enumerate(mapping) if line.startswith('|')), 0) + 2
    mapping[position:position] = new_rows

(root / 'docs/api-v10/openapi.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(root / 'docs/api-v10/mapping.md').write_text('\n'.join(mapping) + '\n', encoding='utf-8')

def ts_type(schema):
    if schema.get('enum') == ['CNY', 'USD']: return 'SettlementCurrency' + (' | null' if schema.get('nullable') else '')
    if '$ref' in schema: return 'V10' + schema['$ref'].split('/')[-1][0].upper() + schema['$ref'].split('/')[-1][1:]
    if 'oneOf' in schema: base = ' | '.join(ts_type(s) for s in schema['oneOf'])
    elif 'enum' in schema: base = ' | '.join(json.dumps(s) for s in schema['enum'])
    elif schema.get('type') == 'array': base = 'Array<' + ts_type(schema['items']) + '>'
    elif schema.get('type') == 'object':
        if 'additionalProperties' in schema and isinstance(schema['additionalProperties'], dict): base = 'Record<string, ' + ts_type(schema['additionalProperties']) + '>'
        else: base = '{ ' + '; '.join(json.dumps(k) + ('' if k in schema.get('required', []) else '?') + ': ' + ts_type(v) for k, v in schema.get('properties', {}).items()) + ' }'
    else: base = {'integer': 'number', 'number': 'number', 'boolean': 'boolean', 'string': 'string'}.get(schema.get('type'), 'unknown')
    return base + (' | null' if schema.get('nullable') else '')

types = ['// Monetary amounts use integer minor units in an explicit currency.', 'export type SettlementCurrency = "CNY" | "USD";', '// Generated by scripts/document-v10.py from explicit resource schemas. Do not edit.', 'export interface V10Envelope<T> { data: T; meta?: { pagination?: V10Pagination; taskId?: string } }']
for name, schema in schemas.items(): types.append('export type V10' + name[0].upper() + name[1:] + ' = ' + ts_type(schema) + ';')
types = [('/** Browser login and registration return HttpOnly session metadata; native clients receive Bearer credentials. */\n' + line) if line.startswith('export type V10Authentication =') else line for line in types]
if telegram_only:
    updates = [line for line in types if line.startswith('export type V10Bot =') or ('telegram' in line.split('=')[0].lower() and line.startswith('export type'))]
    if timezone_only: updates = [line for line in types if any(line.startswith('export type V10'+name+' =') for name in ['Account','Subscription','Preferences','Traffic','TimeZoneChoice','PatchMeInput'])]
    types = [line for line in published_types.splitlines() if not any(line.split('=')[0] == update.split('=')[0] for update in updates)] + updates

(root / 'frontend/src/shared/v10-types.ts').write_text('\n'.join(types) + '\n', encoding='utf-8')

# Machine contracts are maintained independently from user projections.
import runpy
if not telegram_only: runpy.run_path(str(root / "scripts/document-node-v10.py"))
