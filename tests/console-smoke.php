<?php
// Run with: php tests/console-smoke.php (requires a configured local database).
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$configPath = base_path('config/v2board.php');
$originalFile = file_get_contents($configPath);
$originalConfig = config('v2board');
$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$opsPath = config('v2board.ops_api_path', 'ops');
$checks = 0;
$assert = function ($condition, $message) use (&$checks) {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$call = function (string $path, ?array $body = null, ?string $token = null, ?string $language = null, string $accept = 'application/json') use ($kernel) {
    $request = Illuminate\Http\Request::create($path, $body === null ? 'GET' : 'POST', $body ?? []);
    $request->headers->set('Accept', $accept);
    if ($token) $request->headers->set('Authorization', $token);
    if ($language) $request->headers->set('Content-Language', $language);
    return $kernel->handle($request);
};
Illuminate\Support\Facades\DB::beginTransaction();
$auth = null;
try {
    $user = App\Models\User::create([
        'email' => 'console-smoke-' . bin2hex(random_bytes(5)) . '@example.com',
        'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'uuid' => App\Utils\Helper::guid(true), 'token' => App\Utils\Helper::guid(), 'is_admin' => 1,
    ]);
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $subject = App\Models\User::create([
        'email' => 'console-subject-' . bin2hex(random_bytes(5)) . '@example.com',
        'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'uuid' => App\Utils\Helper::guid(true), 'token' => App\Utils\Helper::guid(),
        'invite_user_id' => $user->id,
    ]);
    $editUser = ['id' => $subject->id, 'email' => $subject->email, 'banned' => 0, 'is_admin' => 0, 'is_staff' => 0, 'transfer_enable' => 10737418240, 'u' => 536870912, 'd' => 1073741824, 'commission_type' => 2];
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser, $token);
    $subject->refresh();
    $assert($response->getStatusCode() === 200 && $subject->u == 536870912 && $subject->d == 1073741824 && $subject->commission_type == 2, 'User traffic and commission fields did not persist');
    $assert($subject->invite_user_id == $user->id, 'Unrelated user update cleared the inviter');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser + ['invite_user_email' => ''], $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id === null, 'Explicit inviter removal failed');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser + ['invite_user_email' => $user->email], $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id == $user->id, 'Inviter email assignment failed');
    // Disposable users and orders remain inside the surrounding rollback transaction.
    $scope = [['key' => 'id', 'condition' => '=', 'value' => $subject->id]];
    $subject->device_limit = 7;
    $subject->save();
    $response = $call('/api/v1/' . $securePath . '/user/fetch?' . http_build_query(['filter' => $scope, 'sort' => 'total_used', 'sort_type' => 'ASC']), null, $token);
    $payload = json_decode($response->getContent(), true);
    $assert($response->getStatusCode() === 200 && $payload['total'] === 1 && $payload['data'][0]['id'] === $subject->id, 'Nested user filtering/sorting failed');
    $response = $call('/api/v1/' . $securePath . '/user/dumpCSV', ['filter' => $scope], $token);
    $csv = array_map('str_getcsv', explode("\n", trim(substr($response->getContent(), 3))));
    $assert($response->getStatusCode() === 200 && strpos($response->headers->get('Content-Type'), 'text/csv') === 0 && count($csv) === 2 && $csv[1][4] === '7', 'Scoped CSV or device count failed');
    foreach (['ban', 'allDel'] as $method) {
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, [], $token)->getStatusCode() === 422, 'Unfiltered destructive operation accepted: ' . $method);
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, ['filter' => $scope, 'expected_count' => 2], $token)->getStatusCode() === 409, 'Changed operation scope accepted: ' . $method);
    }
    $assert($subject->refresh()->banned === 0 && App\Models\User::find($subject->id), 'Rejected operation changed the user');
    Illuminate\Support\Facades\Bus::fake();
    $response = $call('/api/v1/' . $securePath . '/user/sendMail', ['filter' => $scope, 'expected_count' => 1, 'subject' => 'test', 'content' => '<p>test</p>'], $token);
    $jobs = Illuminate\Support\Facades\Bus::dispatched(App\Jobs\SendEmailJob::class);
    $assert($response->getStatusCode() === 200 && $jobs->count() === 1 && $jobs->first()->queue === 'send_email_mass', 'Scoped mail did not reach the mass-mail queue');
    $suffix = 'console-batch-' . bin2hex(random_bytes(5)) . '.invalid';
    $response = $call('/api/v1/' . $securePath . '/user/generate', ['email_suffix' => $suffix, 'generate_count' => 2, 'password' => '=test,quoted'], $token);
    $csv = array_map('str_getcsv', explode("\n", trim(substr($response->getContent(), 3))));
    $assert($response->getStatusCode() === 200 && strpos($response->headers->get('Content-Type'), 'text/csv') === 0 && count($csv) === 3 && $csv[1][1] === "'=test,quoted" && App\Models\User::where('email', 'like', '%@' . $suffix)->count() === 2, 'Batch account CSV/escaping failed');
    $response = $call('/api/v1/' . $securePath . '/user/generate', ['email_prefix' => 'single', 'email_suffix' => $suffix], $token);
    $assert($response->getStatusCode() === 200 && json_decode($response->getContent(), true)['data'] === true, 'Single account generation failed');
    $assert($call('/api/v1/' . $securePath . '/user/generate', ['email_suffix' => $suffix, 'generate_count' => 0], $token)->getStatusCode() === 422, 'Zero account count accepted');
    $oldUuid = $subject->uuid; $oldToken = $subject->token;
    $response = $call('/api/v1/' . $securePath . '/user/resetSecret', ['id' => $subject->id], $token);
    $subject->refresh();
    $assert($response->getStatusCode() === 200 && $subject->uuid !== $oldUuid && $subject->token !== $oldToken, 'Reset did not replace both credentials');
    $response = $call('/api/v1/' . $securePath . '/user/ban', ['filter' => $scope, 'expected_count' => 1], $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->banned === 1 && $user->refresh()->banned === 0, 'Scoped ban changed unrelated users');
    $subject->banned = 0; $subject->save();
    $plan = App\Models\Plan::create(['name' => 'console-user-order', 'group_id' => 1, 'transfer_enable' => 10, 'month_price' => 1000]);
    $response = $call('/api/v1/' . $securePath . '/order/assign', ['email' => $subject->email, 'plan_id' => $plan->id, 'period' => 'month_price', 'total_amount' => 123], $token);
    $order = App\Models\Order::where('user_id', $subject->id)->first();
    $assert($response->getStatusCode() === 200 && $order && $order->status === 0 && $order->total_amount === 123 && $subject->refresh()->plan_id === null, 'Assigned order was not unpaid or changed the subscription');
    $response = $call('/api/v1/' . $securePath . '/order/detail', ['id' => $order->id], $token);
    $assert($response->getStatusCode() === 200 && json_decode($response->getContent(), true)['data']['trade_no'] === $order->trade_no, 'User order detail failed');
    $response = $call('/api/v1/' . $securePath . '/order/fetch?' . http_build_query(['filter' => [['key' => 'user_id', 'condition' => '=', 'value' => $subject->id]]]), null, $token);
    $assert(json_decode($response->getContent(), true)['total'] === 1, 'User order scope failed');
    App\Models\StatUser::create(['user_id' => $subject->id, 'server_rate' => 1, 'u' => 1024, 'd' => 2048, 'record_type' => 'd', 'record_at' => time()]);
    $response = $call('/api/v1/' . $securePath . '/stat/getStatUser?user_id=' . $subject->id, null, $token);
    $assert($response->getStatusCode() === 200 && json_decode($response->getContent(), true)['total'] === 1, 'User traffic records failed');
    $batchScope = [['key' => 'email', 'condition' => '模糊', 'value' => '@' . $suffix]];
    $response = $call('/api/v1/' . $securePath . '/user/allDel', ['filter' => $batchScope, 'expected_count' => 3], $token);
    $assert($response->getStatusCode() === 200 && App\Models\User::where('email', 'like', '%@' . $suffix)->count() === 0 && App\Models\User::find($subject->id), 'Scoped deletion changed unrelated users');
    $response = $call('/api/v1/' . $securePath . '/user/delUser', ['id' => $subject->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\User::find($subject->id) && !App\Models\Order::find($order->id), 'Single-user deletion did not clean up the assigned order');
    foreach (['/', '/app', '/' . $securePath] as $path) {
        $response = $call($path);
        $assert($response->getStatusCode() === 200 && strpos($response->getContent(), '/console/assets/') !== false, 'React shell failed: ' . $path);
    }
    foreach (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'ru-RU', 'fa-IR'] as $language) {
        $response = $call('/api/v1/passport/auth/login', [], null, $language);
        $errors = json_decode($response->getContent(), true)['errors'] ?? [];
        $catalog = json_decode(file_get_contents(resource_path('lang/' . $language . '.json')), true);
        $assert($response->getStatusCode() === 422 && ($errors['email'][0] ?? null) === $catalog['Email can not be empty'], 'Localized validation failed: ' . $language);
    }
    app()->setLocale('zh-CN');
    $response = $call('/' . $securePath . '/ops-center/risk');
    $assert($response->getStatusCode() === 302 && strpos($response->headers->get('Location'), '#/risk') !== false, 'Legacy operations bookmark failed');
    foreach (['getThemes', 'getThemeConfig', 'saveThemeConfig'] as $method) {
        $response = $call('/api/v1/' . $securePath . '/theme/' . $method, $method === 'getThemes' ? null : [], $token);
        $assert($response->getStatusCode() === 404, 'Theme endpoint still active: ' . $method);
    }
    $response = $call('/api/v1/' . $securePath . '/config/fetch', null, $token);
    $config = json_decode($response->getContent(), true)['data'];
    $assert(!isset($config['frontend']) && isset($config['footer']['custom_footer_html']), 'Footer configuration failed');
    $assert($call('/api/v1/' . $securePath . '/console/configSchema')->getStatusCode() === 403, 'Config schema must require admin authentication');
    $response = $call('/api/v1/' . $securePath . '/console/configSchema', null, $token);
    $rules = json_decode($response->getContent(), true)['data'] ?? [];
    $assert($response->getStatusCode() === 200 && ($rules['email_verify'] ?? '') === 'in:0,1' && ($rules['reset_traffic_method'] ?? '') === 'in:0,1,2,3,4', 'Configuration control schema failed');
    $assert($call('/api/v1/' . $securePath . '/console/nodeSchema?type=v2node')->getStatusCode() === 403, 'Node schema must require admin authentication');
    foreach (['v2node', 'vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria', 'tuic', 'anytls'] as $type) {
        $response = $call('/api/v1/' . $securePath . '/console/nodeSchema?type=' . $type, null, $token);
        $rules = json_decode($response->getContent(), true)['data'] ?? [];
        $assert($response->getStatusCode() === 200 && isset($rules['host'], $rules['name'], $rules['group_id']), 'Node schema failed: ' . $type);
    }
    $group = new App\Models\ServerGroup();
    $group->name = 'console-smoke-group';
    $group->save();
    $nodeParams = ['name' => 'console-smoke-node', 'group_id' => [$group->id], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'protocol' => 'vless', 'tls' => 1, 'network' => 'ws', 'disable_sni' => 0, 'zero_rtt_handshake' => 0, 'show' => 0, 'tls_settings' => ['server_name' => 'example.invalid', 'allow_insecure' => 0], 'network_settings' => ['path' => '/test', 'headers' => ['Host' => 'example.invalid']]];
    $response = $call('/api/v1/' . $securePath . '/server/v2node/save', $nodeParams, $token);
    $assert($response->getStatusCode() === 200, 'Structured node save failed: ' . $response->getContent());
    $node = App\Models\ServerV2node::where('name', 'console-smoke-node')->first();
    $assert($node && $node->tls_settings['server_name'] === 'example.invalid' && $node->network_settings['headers']['Host'] === 'example.invalid', 'Structured node values did not persist');
    $nodeVariants = [
        'vmess' => ['tls' => 1, 'network' => 'xhttp', 'networkSettings' => ['path' => '/test', 'mode' => 'auto', 'security' => 'auto']],
        'vless' => ['tls' => 1, 'network' => 'tcp', 'tls_settings' => ['server_name' => 'example.invalid']],
        'trojan' => ['network' => 'tcp', 'allow_insecure' => 0, 'server_name' => 'example.invalid'],
        'shadowsocks' => ['cipher' => 'aes-128-gcm'],
        'hysteria' => ['version' => 2, 'insecure' => 0, 'obfs' => 'salamander', 'obfs_password' => 'test-only'],
        'tuic' => ['insecure' => 0, 'disable_sni' => 0, 'zero_rtt_handshake' => 0, 'udp_relay_mode' => 'quic', 'congestion_control' => 'bbr'],
        'anytls' => ['insecure' => 0, 'padding_scheme' => '["stop=8","0=30-30"]'],
    ];
    foreach ($nodeVariants as $kind => $variant) {
        $body = ['name' => 'console-smoke-' . $kind, 'group_id' => [$group->id], 'route_id' => [], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'show' => 0] + $variant;
        $response = $call('/api/v1/' . $securePath . '/server/' . $kind . '/save', $body, $token);
        $assert($response->getStatusCode() === 200, 'Node variant save failed: ' . $kind . ': ' . $response->getContent());
    }
    $assert(App\Models\ServerAnytls::where('name', 'console-smoke-anytls')->first()->padding_scheme === ['stop=8', '0=30-30'], 'AnyTLS padding JSON failed to round-trip');
    $assert(App\Models\ServerTuic::where('name', 'console-smoke-tuic')->first()->congestion_control === 'bbr', 'TUIC option did not persist');
    $response = $call('/api/v1/' . $securePath . '/server/manage/getNodes', null, $token);
    $savedNodes = json_decode($response->getContent(), true)['data'] ?? [];
    foreach (array_merge(['v2node'], array_keys($nodeVariants)) as $kind) {
        $matches = array_filter($savedNodes, function ($item) use ($kind) { return $item['type'] === $kind && strpos($item['name'], 'console-smoke-') === 0; });
        $assert($response->getStatusCode() === 200 && count($matches) > 0, 'Saved node did not reload: ' . $kind);
    }
    $methodsResponse = $call('/api/v1/' . $securePath . '/payment/getPaymentMethods', null, $token);
    $paymentMethods = json_decode($methodsResponse->getContent(), true)['data'] ?? [];
    $assert(count($paymentMethods) > 0, 'No payment methods returned');
    foreach ($paymentMethods as $method) {
        $response = $call('/api/v1/' . $securePath . '/payment/getPaymentForm', ['payment' => $method], $token);
        $assert($response->getStatusCode() === 200 && is_array(json_decode($response->getContent(), true)['data'] ?? null), 'Payment form failed: ' . $method);
    }
    $paymentBody = ['name' => 'console-smoke-payment', 'payment' => 'Paytaro', 'config' => ['pid' => 'test-only', 'key' => 'test-only'], 'handling_fee_fixed' => 0, 'handling_fee_percent' => 0, 'notify_domain' => 'https://example.invalid'];
    $response = $call('/api/v1/' . $securePath . '/payment/save', $paymentBody, $token);
    $assert($response->getStatusCode() === 200, 'Zero-fee payment configuration failed: ' . $response->getContent());
    $payment = App\Models\Payment::where('name', 'console-smoke-payment')->first();
    $response = $call('/api/v1/' . $securePath . '/payment/getPaymentForm', ['payment' => 'Paytaro', 'id' => $payment->id], $token);
    $assert((json_decode($response->getContent(), true)['data']['key']['value'] ?? '') === 'test-only', 'Saved gateway value did not reload');
    $response = $call('/api/v1/' . $securePath . '/config/save', ['show_subscribe_expire' => 0], $token);
    $assert($response->getStatusCode() === 422, 'Zero subscription interval should be rejected');
    $nodeParams['id'] = $node->id;
    $nodeParams['tls'] = 2;
    $nodeParams['network'] = 'grpc';
    $nodeParams['tls_settings'] = ['server_name' => 'example.invalid'];
    $nodeParams['network_settings'] = ['serviceName' => 'test-service'];
    $response = $call('/api/v1/' . $securePath . '/server/v2node/save', $nodeParams, $token);
    $node->refresh();
    $assert($response->getStatusCode() === 200 && !empty($node->tls_settings['public_key']) && !empty($node->tls_settings['private_key']) && $node->network_settings['serviceName'] === 'test-service', 'Reality/gRPC mode transition failed');
    foreach (['coupon' => ['type' => 2, 'value' => 20, 'limit_plan_ids' => [], 'limit_period' => ['month_price']], 'giftcard' => ['type' => 4]] as $kind => $params) {
        $params += ['name' => 'console-smoke-' . $kind, 'generate_count' => 2, 'started_at' => time(), 'ended_at' => time() + 86400];
        $response = $call('/api/v1/' . $securePath . '/' . $kind . '/generate', $params, $token);
        $payload = json_decode($response->getContent(), true);
        $assert($response->getStatusCode() === 200 && ($payload['generated_count'] ?? 0) === 2 && ($payload['data'] ?? null) === true, 'Batch JSON generation failed: ' . $kind);
    }
    foreach (array_merge(['v2node'], array_keys($nodeVariants)) as $nodeType) {
        $model = 'App\\Models\\Server' . ucfirst($nodeType);
        $originalNode = $model::where('name', $nodeType === 'v2node' ? 'console-smoke-node' : 'console-smoke-' . $nodeType)->first();
        $response = $call('/api/v1/' . $securePath . '/server/' . $nodeType . '/update', ['id' => $originalNode->id, 'show' => 1], $token);
        $assert($response->getStatusCode() === 200 && $originalNode->refresh()->show == 1, 'Node visibility failed: ' . $nodeType);
        $beforeIds = $model::pluck('id')->all();
        $response = $call('/api/v1/' . $securePath . '/server/' . $nodeType . '/copy', ['id' => $originalNode->id], $token);
        $copy = $model::whereNotIn('id', $beforeIds)->first();
        $assert($response->getStatusCode() === 200 && $copy && $copy->host === $originalNode->host, 'Node copy failed: ' . $nodeType);
        $response = $call('/api/v1/' . $securePath . '/server/' . $nodeType . '/drop', ['id' => $copy->id], $token);
        $assert($response->getStatusCode() === 200 && !$model::find($copy->id), 'Node deletion failed: ' . $nodeType);
    }
    $response = $call('/api/v1/' . $securePath . '/server/group/save', ['name' => 'console-button-group'], $token);
    $tempGroup = App\Models\ServerGroup::where('name', 'console-button-group')->first();
    $assert($response->getStatusCode() === 200 && $tempGroup, 'Group creation failed');
    $response = $call('/api/v1/' . $securePath . '/server/group/save', ['id' => $tempGroup->id, 'name' => 'console-button-group-edited'], $token);
    $assert($response->getStatusCode() === 200 && $tempGroup->refresh()->name === 'console-button-group-edited', 'Group edit failed');
    $response = $call('/api/v1/' . $securePath . '/server/group/drop', ['id' => $tempGroup->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\ServerGroup::find($tempGroup->id), 'Group deletion failed');
    $routeBody = ['remarks' => 'console-button-route', 'action' => 'block', 'match' => ['example.invalid']];
    $response = $call('/api/v1/' . $securePath . '/server/route/save', $routeBody, $token);
    $tempRoute = App\Models\ServerRoute::where('remarks', $routeBody['remarks'])->first();
    $assert($response->getStatusCode() === 200 && $tempRoute, 'Route creation failed');
    $routeBody['id'] = $tempRoute->id; $routeBody['action'] = 'dns'; $routeBody['action_value'] = '8.8.8.8';
    $response = $call('/api/v1/' . $securePath . '/server/route/save', $routeBody, $token);
    $assert($response->getStatusCode() === 200 && $tempRoute->refresh()->action === 'dns', 'Route edit failed');
    $response = $call('/api/v1/' . $securePath . '/server/route/drop', ['id' => $tempRoute->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\ServerRoute::find($tempRoute->id), 'Route deletion failed');
    $noticeBody = ['title' => 'console-button-notice', 'content' => '<p>notice</p>', 'tags' => ['test-only']];
    $response = $call('/api/v1/' . $securePath . '/notice/save', $noticeBody, $token);
    $notice = App\Models\Notice::where('title', $noticeBody['title'])->first();
    $assert($response->getStatusCode() === 200 && $notice && $notice->tags === ['test-only'], 'Notice creation/tags failed');
    $noticeBody['id'] = $notice->id; $noticeBody['content'] = '<p>edited</p>';
    $response = $call('/api/v1/' . $securePath . '/notice/save', $noticeBody, $token);
    $assert($response->getStatusCode() === 200 && $notice->refresh()->content === '<p>edited</p>', 'Notice edit failed');
    $response = $call('/api/v1/' . $securePath . '/notice/show', ['id' => $notice->id], $token);
    $assert($response->getStatusCode() === 200 && $notice->refresh()->show == 1, 'Notice visibility failed');
    $response = $call('/api/v1/' . $securePath . '/notice/drop', ['id' => $notice->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\Notice::find($notice->id), 'Notice deletion failed');
    // Whole-console button regression: temporary records only, no external delivery.
    $plan2 = App\Models\Plan::create(['name' => 'console-sort-plan', 'group_id' => $group->id, 'transfer_enable' => 5, 'month_price' => 500]);
    $response = $call('/api/v1/' . $securePath . '/plan/sort', ['plan_ids' => [$plan2->id, $plan->id]], $token);
    $assert($response->getStatusCode() === 200 && $plan2->refresh()->sort == 1 && $plan->refresh()->sort == 2, 'Plan order did not persist');
    foreach (['show', 'renew'] as $field) {
        foreach ([0, 1] as $value) {
            $response = $call('/api/v1/' . $securePath . '/plan/update', ['id' => $plan2->id, $field => $value], $token);
            $assert($response->getStatusCode() === 200 && $plan2->refresh()->$field == $value, 'Plan switch did not persist: ' . $field);
        }
    }
    // A period subscriber has an existing quota; zero-quota credit-only users
    // intentionally do not acquire a subscription quota through force_update.
    $subscriber = App\Models\User::create(['email' => 'console-plan-' . bin2hex(random_bytes(5)) . '@example.invalid', 'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), 'plan_id' => $plan2->id, 'transfer_enable' => 1073741824, 'uuid' => App\Utils\Helper::guid(true), 'token' => App\Utils\Helper::guid()]);
    $response = $call('/api/v1/' . $securePath . '/plan/save', ['id' => $plan2->id, 'name' => $plan2->name, 'group_id' => $group->id, 'transfer_enable' => 9, 'device_limit' => 3, 'speed_limit' => 50, 'force_update' => 1], $token);
    $assert($response->getStatusCode() === 200 && $subscriber->refresh()->transfer_enable == 9 * 1073741824 && $subscriber->device_limit == 3 && $subscriber->speed_limit == 50, 'Force-update subscribers failed');
    $payment2 = App\Models\Payment::create(['name' => 'console-sort-payment', 'payment' => 'Paytaro', 'uuid' => App\Utils\Helper::guid(), 'config' => [], 'enable' => 0]);
    $response = $call('/api/v1/' . $securePath . '/payment/sort', ['ids' => [$payment2->id, $payment->id]], $token);
    $assert($response->getStatusCode() === 200 && $payment2->refresh()->sort == 1 && $payment->refresh()->sort == 2, 'Payment order failed');
    $response = $call('/api/v1/' . $securePath . '/payment/show', ['id' => $payment2->id], $token);
    $assert($response->getStatusCode() === 200 && $payment2->refresh()->enable == 1, 'Payment enable failed');
    $response = $call('/api/v1/' . $securePath . '/payment/drop', ['id' => $payment2->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\Payment::find($payment2->id), 'Payment deletion failed');
    $vmess = App\Models\ServerVmess::where('name', 'console-smoke-vmess')->first();
    $response = $call('/api/v1/' . $securePath . '/server/manage/sort', ['v2node' => [$node->id => 2], 'vmess' => [$vmess->id => 1]], $token);
    $assert($response->getStatusCode() === 200 && $node->refresh()->sort == 2 && $vmess->refresh()->sort == 1, 'Cross-protocol node order failed');
    $knowledge = [];
    foreach ([1, 2] as $index) {
        $title = 'console-knowledge-' . $index;
        $response = $call('/api/v1/' . $securePath . '/knowledge/save', ['title' => $title, 'category' => 'console-category', 'language' => 'ja-JP', 'body' => '<p>complete body</p>'], $token);
        $assert($response->getStatusCode() === 200, 'Knowledge creation failed');
        $knowledge[] = App\Models\Knowledge::where('title', $title)->first();
    }
    $response = $call('/api/v1/' . $securePath . '/knowledge/fetch?id=' . $knowledge[0]->id, null, $token);
    $payload = json_decode($response->getContent(), true)['data'];
    $assert($response->getStatusCode() === 200 && $payload['body'] === '<p>complete body</p>' && $payload['language'] === 'ja-JP', 'Knowledge edit detail lost body/language');
    $response = $call('/api/v1/' . $securePath . '/knowledge/getCategory', null, $token);
    $assert(in_array('console-category', json_decode($response->getContent(), true)['data']), 'Knowledge category suggestions missing');
    $response = $call('/api/v1/' . $securePath . '/knowledge/sort', ['knowledge_ids' => [$knowledge[1]->id, $knowledge[0]->id]], $token);
    $assert($response->getStatusCode() === 200 && $knowledge[1]->refresh()->sort == 1 && $knowledge[0]->refresh()->sort == 2, 'Knowledge ordering failed');
    $response = $call('/api/v1/' . $securePath . '/knowledge/show', ['id' => $knowledge[0]->id], $token);
    $assert($response->getStatusCode() === 200 && $knowledge[0]->refresh()->show == 1, 'Knowledge visibility failed');
    $response = $call('/api/v1/' . $securePath . '/knowledge/drop', ['id' => $knowledge[1]->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\Knowledge::find($knowledge[1]->id), 'Knowledge deletion failed');
    foreach (['coupon' => ['type' => 2, 'value' => 20], 'giftcard' => ['type' => 4]] as $kind => $params) {
        $params += ['format' => 'csv', 'name' => '=console,csv-' . $kind, 'generate_count' => 2, 'started_at' => time(), 'ended_at' => time() + 86400];
        $response = $call('/api/v1/' . $securePath . '/' . $kind . '/generate', $params, $token, null, 'text/csv, application/json');
        $csv = array_map('str_getcsv', explode("\n", trim(substr($response->getContent(), 3))));
        $assert($response->getStatusCode() === 200 && strpos($response->headers->get('Content-Type'), 'text/csv') === 0 && count($csv) === 3 && $csv[1][0] === "'" . $params['name'], 'Card CSV/escaping failed: ' . $kind);
        $model = $kind === 'coupon' ? App\Models\Coupon::class : App\Models\Giftcard::class;
        $item = $model::where('name', $params['name'])->first();
        if ($kind === 'coupon') {
            $previous = $item->show;
            $response = $call('/api/v1/' . $securePath . '/coupon/show', ['id' => $item->id], $token);
            $assert($response->getStatusCode() === 200 && $item->refresh()->show != $previous, 'Coupon visibility failed');
        }
        $response = $call('/api/v1/' . $securePath . '/' . $kind . '/drop', ['id' => $item->id], $token);
        $assert($response->getStatusCode() === 200 && !$model::find($item->id), 'Card delete failed: ' . $kind);
    }
    $order = App\Models\Order::create(['user_id' => $subscriber->id, 'plan_id' => $plan2->id, 'period' => 'month_price', 'trade_no' => App\Utils\Helper::guid(), 'total_amount' => 500, 'type' => 1, 'status' => 3, 'commission_balance' => 100, 'invite_user_id' => $user->id]);
    $response = $call('/api/v1/' . $securePath . '/order/update', ['trade_no' => $order->trade_no, 'commission_status' => 3], $token);
    $assert($response->getStatusCode() === 200 && $order->refresh()->commission_status === 3, 'Commission rejection failed');
    $order->commission_status = 2; $order->save();
    $assert($call('/api/v1/' . $securePath . '/order/update', ['trade_no' => $order->trade_no, 'commission_status' => 0], $token)->getStatusCode() === 422, 'Paid commission allowed review');
    $response = $call('/api/v1/' . $securePath . '/order/fetch?' . http_build_query(['filter' => [['key' => 'email', 'condition' => '=', 'value' => 'no-such-user@example.invalid']]]), null, $token);
    $assert(json_decode($response->getContent(), true)['total'] === 0, 'Unknown order email leaked all orders');
    $response = $call('/api/v1/' . $securePath . '/order/fetch?' . http_build_query(['filter' => [['key' => 'email', 'condition' => '模糊', 'value' => 'console-plan-']]]), null, $token);
    $assert(json_decode($response->getContent(), true)['total'] === 1, 'Order email filtering failed');
    $ticket = App\Models\Ticket::create(['user_id' => $subscriber->id, 'subject' => 'console-ticket', 'level' => 0, 'status' => 0, 'reply_status' => 0]);
    $response = $call('/api/v1/' . $securePath . '/ticket/fetch?' . http_build_query(['email' => $subscriber->email, 'status' => 0, 'reply_status' => [0], 'current' => 1, 'pageSize' => 10]), null, $token);
    $assert(json_decode($response->getContent(), true)['total'] === 1, 'Ticket filter/pagination failed');
    $response = $call('/api/v1/' . $securePath . '/ticket/fetch?email=no-such-user@example.invalid', null, $token);
    $assert(json_decode($response->getContent(), true)['total'] === 0, 'Unknown ticket email leaked other tickets');
    $response = $call('/api/v1/' . $securePath . '/ticket/reply', ['id' => $ticket->id, 'message' => 'fixture reply'], $token);
    $assert($response->getStatusCode() === 200 && $ticket->refresh()->reply_status === 1, 'Ticket reply failed');
    $response = $call('/api/v1/' . $securePath . '/ticket/close', ['id' => $ticket->id], $token);
    $assert($response->getStatusCode() === 200 && $ticket->refresh()->status === 1, 'Ticket close failed');
    foreach (['stat/getServerTodayRank', 'stat/getServerLastRank', 'stat/getUserTodayRank', 'stat/getUserLastRank', 'stat/getOrder', 'system/getQueueWorkload', 'system/getQueueMasters'] as $endpoint) {
        $assert($call('/api/v1/' . $securePath . '/' . $endpoint, null, $token)->getStatusCode() === 200, 'Legacy read control failed: ' . $endpoint);
        $assert($call('/api/v1/' . $securePath . '/' . $endpoint)->getStatusCode() === 403, 'Legacy control lacks admin authentication: ' . $endpoint);
    }
    foreach (['risk/overview/fetch', 'risk/rule/fetch', 'risk/settings/fetch', 'client/strategy/fetch', 'log/login/fetch'] as $endpoint) {
        $assert($call('/api/v1/' . $opsPath . '/' . $endpoint, null, $token)->getStatusCode() === 200, 'Unified operations endpoint failed: ' . $endpoint);
    }
    foreach (['Country', 'City', 'ASN'] as $type) {
        $reader = new GeoIp2\Database\Reader(storage_path('geoip/GeoLite2-' . $type . '.mmdb'));
        $assert($reader->metadata()->databaseType === 'GeoLite2-' . $type, 'Wrong GeoIP database: ' . $type);
        $reader->close();
    }
    $geo = (new App\Services\GeoIpService())->lookup('8.8.8.8');
    $assert($geo['country'] !== null && $geo['asn'] === 'AS15169', 'GeoIP lookup failed');
    $footer = '<div data-console-smoke="footer">Footer smoke test</div>';
    $response = $call('/api/v1/' . $securePath . '/config/save', ['custom_footer_html' => $footer], $token);
    $assert($response->getStatusCode() === 200, 'Footer save failed: ' . $response->getContent());
    $assert(config('v2board.password_limit_enable', 1) === ($originalConfig['password_limit_enable'] ?? 1), 'Partial settings update changed an unrelated switch');
    config(['v2board.custom_footer_html' => $footer]);
    $assert(strpos($call('/app')->getContent(), $footer) !== false, 'Footer was not rendered in user shell');
    $assert(strpos($call('/')->getContent(), '<title>' . e(config('v2board.app_name', 'V2Board')) . '</title>') !== false && strpos($call('/')->getContent(), $footer) === false, 'Public landing metadata or footer isolation failed');
    $assert(strpos($call('/' . $securePath)->getContent(), $footer) === false, 'User footer leaked into admin shell');
    echo "Console smoke tests: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    file_put_contents($configPath, $originalFile);
    config(['v2board' => $originalConfig]);
    Illuminate\Support\Facades\Artisan::call('config:cache');
}
