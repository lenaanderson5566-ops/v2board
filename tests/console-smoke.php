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
$call = function (string $path, ?array $body = null, ?string $token = null, ?string $language = null) use ($kernel) {
    $request = Illuminate\Http\Request::create($path, $body === null ? 'GET' : 'POST', $body ?? []);
    $request->headers->set('Accept', 'application/json');
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
    $assert(strpos($call('/')->getContent(), '<title>Studio</title>') !== false && strpos($call('/')->getContent(), $footer) === false, 'Public landing metadata or footer isolation failed');
    $assert(strpos($call('/' . $securePath)->getContent(), $footer) === false, 'User footer leaked into admin shell');
    echo "Console smoke tests: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    file_put_contents($configPath, $originalFile);
    config(['v2board' => $originalConfig]);
    Illuminate\Support\Facades\Artisan::call('config:cache');
}
