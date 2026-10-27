<?php
// Run with: php tests/console-smoke.php (requires a configured local database).
$app = require __DIR__.'/support/bootstrap.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$configPath = base_path('config/v2board.php');
$originalFile = file_get_contents($configPath);
$originalConfig = config('v2board');
$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$opsPath = config('v2board.ops_api_path', 'ops');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$call = function (string $path, ?array $body = null, ?string $token = null, ?string $language = null, string $accept = 'application/json', ?string $method = null) use ($kernel) {
    $request = Illuminate\Http\Request::create($path, $method ?? ($body === null ? 'GET' : 'POST'), $body ?? []);
    $request->headers->set('Accept', $accept);
    if ($token) $request->headers->set('Authorization', $token);
    if ($language) $request->headers->set('Content-Language', $language);
    return $kernel->handle($request);
};
Illuminate\Support\Facades\DB::beginTransaction();
$auth = null;
$failure = null;
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
    $editUser = ['id' => $subject->id, 'email' => $subject->email, 'banned' => 0, 'is_admin' => 0, 'transfer_enable' => 10737418240, 'u' => 536870912, 'd' => 1073741824, 'commission_type' => 2];
    foreach (['MicroMessenger/8','Weibo/13','QQ/9','python-requests/2',''] as $browserUa) {
        $browserRequest=Illuminate\Http\Request::create('/app','GET',[],[],[],['HTTP_USER_AGENT'=>$browserUa]);
        $browserResponse=app(Illuminate\Contracts\Http\Kernel::class)->handle($browserRequest);
        $assert($browserResponse->getStatusCode()===200 && str_contains($browserResponse->getContent(),'window.V2BOARD') && str_contains($browserResponse->getContent(),'browserPolicies'),'All browser UAs receive the real frontend boot');
        $assert(str_contains($browserResponse->headers->get('Cache-Control'),'no-store'),'Browser policy boot is not publicly cached');
    }
    $operationsUrl='/api/v1/'.$securePath.'/analytics/operations';
    $assert($call($operationsUrl.'?days=7')->getStatusCode()===403,'Operations analytics rejects anonymous access');
    $subjectAuth=new App\Services\AuthService($subject);
    $subjectToken=$subjectAuth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $assert($call($operationsUrl.'?days=7',null,$subjectToken)->getStatusCode()===403,'Operations analytics rejects ordinary account credentials');
    $journeyUrl='/api/v1/'.$securePath.'/analytics/journey';
    $assert($call($journeyUrl.'?days=7')->getStatusCode()===403 && $call($journeyUrl.'?days=7',null,$subjectToken)->getStatusCode()===403,'Journey analytics rejects anonymous and ordinary-account access');
    $settingsUrl='/api/v1/'.$securePath.'/analytics/settings';
    $assert($call($settingsUrl)->getStatusCode()===403 && $call($settingsUrl,null,$subjectToken)->getStatusCode()===403,'Analytics settings read is admin-only');
    $beforeSettings=app(App\Services\ProductAnalytics::class)->settings();
    $settingsResponse=$call($settingsUrl,null,$token);
    $settingsData=json_decode($settingsResponse->getContent(),true)['data'] ?? [];
    $assert($settingsResponse->getStatusCode()===200 && $settingsData['settings']===$beforeSettings && array_key_exists('ready',$settingsData),'Settings read returns configuration without report queries');
    $assert(str_contains($settingsResponse->headers->get('Cache-Control'),'no-store') && app(App\Services\ProductAnalytics::class)->settings()===$beforeSettings,'Settings GET is private and read-only');
    $subjectAuth->removeAllSession();
    $opsReport=$call($operationsUrl.'?days=7',null,$token);
    $assert($opsReport->getStatusCode()===200 && isset(json_decode($opsReport->getContent(),true)['data']['risk']) && str_contains($opsReport->headers->get('Cache-Control'),'no-store'),'Operations analytics is available only to administrators and cannot be stored');
    $journeyReport=$call($journeyUrl.'?days=7&device=mobile',null,$token);
    $assert($journeyReport->getStatusCode()===200 && isset(json_decode($journeyReport->getContent(),true)['data']['business']['activation']) && str_contains($journeyReport->headers->get('Cache-Control'),'no-store'),'Journey analytics accepts administrator filters with private response');
    $assert($call($journeyUrl.'?days=8',null,$token)->getStatusCode()===422,'Journey report rejects unsupported date ranges');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser + ['is_staff'=>1], $token);
    $subject->refresh();
    $assert($response->getStatusCode() === 200 && $subject->u == 536870912 && $subject->d == 1073741824 && $subject->commission_type == 2, 'User traffic and commission fields did not persist');
    $assert($subject->invite_user_id == $user->id, 'Unrelated user update cleared the inviter');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser + ['invite_user_email' => ''], $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id === null, 'Explicit inviter removal failed');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editUser + ['invite_user_email' => $user->email], $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id == $user->id, 'Inviter email assignment failed');
    $originalGroup=$subject->group_id;
    $subject->group_id=98765;$subject->save();
    $response=$call('/api/v1/'.$securePath.'/user/update',$editUser,$token);
    $assert($response->getStatusCode()===200 && $subject->fresh()->group_id===98765,'Unrelated edits preserve access group without an explicit plan change');
    foreach ([$subject->email,'missing-inviter@example.invalid'] as $email) {
        $response=$call('/api/v1/'.$securePath.'/user/update',$editUser+['invite_user_email'=>$email],$token);
        $assert($response->getStatusCode()===422 && $subject->fresh()->invite_user_id===$user->id,'Invalid inviter edits preserve the current inviter');
    }
    $subject->group_id=$originalGroup;$subject->save();
    // Disposable users and orders remain inside the surrounding rollback transaction.
    $scope = [['key' => 'id', 'condition' => '=', 'value' => $subject->id]];
    $subject->device_limit = 7;
    $subject->save();
    $response = $call('/api/v1/' . $securePath . '/user/fetch?' . http_build_query(['filter' => $scope, 'sort' => 'total_used', 'sort_type' => 'ASC']), null, $token);
    $payload = json_decode($response->getContent(), true);
    $assert($response->getStatusCode() === 200 && $payload['total'] === 1 && $payload['data'][0]['id'] === $subject->id, 'Nested user filtering/sorting failed');
    $beforeCount = App\Models\User::count();
    foreach (['dumpCSV', 'generate'] as $retired) {
        foreach ([null, $subjectToken, $token] as $credential) {
            $response = $call('/api/v1/' . $securePath . '/user/' . $retired, ['email_suffix' => 'removed.invalid', 'generate_count' => 2], $credential);
            $assert($response->getStatusCode() === 404, 'Retired user endpoint remains reachable: ' . $retired);
        }
    }
    $assert(App\Models\User::count() === $beforeCount, 'Retired generation changed user count');
    foreach (['ban', 'allDel'] as $method) {
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, [], $token)->getStatusCode() === 422, 'Unfiltered destructive operation accepted: ' . $method);
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, ['filter' => $scope, 'expected_count' => 2], $token)->getStatusCode() === 409, 'Changed operation scope accepted: ' . $method);
    }
    $assert($subject->refresh()->banned === 0 && App\Models\User::find($subject->id), 'Rejected operation changed the user');
    Illuminate\Support\Facades\Bus::fake();
    $response = $call('/api/v1/' . $securePath . '/user/sendMail', ['filter' => $scope, 'expected_count' => 1, 'request_key' => (string) Illuminate\Support\Str::uuid(), 'purpose' => 'service', 'subject' => 'test', 'content' => '<p>test</p>'], $token);
    $campaignId = json_decode($response->getContent(), true)['data']['campaign_id'] ?? null;
    $recipients = Illuminate\Support\Facades\DB::table('v2_mail_campaign_recipient')->where('campaign_id', $campaignId)->get();
    $assert($response->getStatusCode() === 202 && $recipients->count() === 1 && (int) $recipients->first()->user_id === $subject->id && $recipients->first()->status === 'queued', 'Scoped mail did not reach the campaign queue');
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
    // Build disposable records directly; the retired generation endpoint must stay absent.
    $suffix='bulk-'.bin2hex(random_bytes(6)).'.example.test';
    for ($i=0;$i<3;$i++) App\Models\User::create([
        'email'=>'delete-'.$i.'@'.$suffix,'password'=>'test-only-unusable-hash',
        'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),
    ]);
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
    $assert(($rules['passkey_enable'] ?? '') === 'in:0,1' && !isset($rules['recaptcha_enable'],$rules['recaptcha_key'],$rules['recaptcha_site_key']), 'Passkey replaces retired CAPTCHA settings');
    $assert($call('/api/v1/' . $securePath . '/console/nodeSchema?type=v2node')->getStatusCode() === 403, 'Node schema must require admin authentication');
    foreach (['v2node', 'v2box'] as $type) {
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
    $updated = $nodeParams + ['id' => $node->id, 'region_code' => 'us', 'city_code' => 'San Jose', 'display_label' => 'A'];
    $updated['host'] = 'updated.example.invalid';
    $response = $call('/api/v1/' . $securePath . '/server/v2node/save', $updated, $token);
    $assert($response->getStatusCode() === 200, 'Updated address and location save failed');
    $assert($node->fresh()->host==='example.invalid','Protocol editing preserves the independent connection address');
    $address=json_decode($call('/api/v1/'.$securePath.'/server/connections/address?type=v2node&id='.$node->id,null,$token)->getContent(),true)['data'];
    $response=$call('/api/v1/'.$securePath.'/server/connections/address',['type'=>'v2node','id'=>$node->id,'revision'=>$address['revision'],'host'=>'updated.example.invalid','port'=>'443','confirm'=>true],$token,null,'application/json','PATCH');
    $assert($response->getStatusCode()===200 && $node->fresh()->host==='updated.example.invalid','Dedicated address editing persists the connection address');
    $line=json_decode($call('/api/v1/'.$securePath.'/server/connections/default?type=v2node&id='.$node->id,null,$token)->getContent(),true)['data'];
    $values=array_merge($line['values'],['type'=>'v2node','id'=>$node->id,'revision'=>$line['revision'],'region_code'=>'us','city_code'=>'San Jose','display_label'=>'A']);
    $response=$call('/api/v1/'.$securePath.'/server/connections/default',$values,$token,null,'application/json','PATCH');
    $node->refresh();
    $assert($response->getStatusCode()===200 && $node->region_code==='US' && $node->city_code==='san-jose' && $node->display_label==='A','Line editing persists normalized location independently');
    $values['revision']=json_decode($response->getContent(),true)['data']['revision'];
    $values['city_code']='California';
    $response=$call('/api/v1/'.$securePath.'/server/connections/default',$values,$token,null,'application/json','PATCH');
    $assert($response->getStatusCode()===200 && $node->fresh()->city_code==='california','Line location normalization persists');
    $nodeVariants = [
        'vmess' => ['tls' => 1, 'network' => 'ws'],
        'vless' => ['tls' => 1, 'network' => 'tcp'],
        'trojan' => ['network' => 'tcp'],
        'shadowsocks' => ['tls' => 0, 'cipher' => 'aes-128-gcm'],
        'hysteria2' => ['obfs' => 'salamander', 'obfs_password' => 'test-only'],
        'tuic' => ['udp_relay_mode' => 'quic', 'congestion_control' => 'bbr'],
        'anytls' => ['padding_scheme' => '["stop=8","0=30-30"]'],
    ];
    foreach (['v2node', 'v2box'] as $backend) foreach ($nodeVariants as $kind => $variant) {
        $body = array_merge(['name' => 'console-smoke-' . $backend . '-' . $kind, 'protocol' => $kind, 'group_id' => [$group->id], 'route_id' => [], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'show' => 0, 'tls' => 1, 'network' => 'tcp', 'disable_sni' => 0, 'zero_rtt_handshake' => 0], $variant);
        $response = $call('/api/v1/' . $securePath . '/server/' . $backend . '/save', $body, $token);
        $assert($response->getStatusCode() === 200, 'Node variant save failed: ' . $backend . '/' . $kind . ': ' . $response->getContent());
    }
    $assert(App\Models\ServerV2node::where('name', 'console-smoke-v2node-anytls')->first()->padding_scheme === ['stop=8', '0=30-30'], 'AnyTLS padding JSON failed to round-trip');
    $assert(App\Models\ServerV2box::where('name', 'console-smoke-v2box-tuic')->first()->congestion_control === 'bbr', 'TUIC option did not persist');
    $response = $call('/api/v1/' . $securePath . '/server/manage/getNodes', null, $token);
    $savedNodes = json_decode($response->getContent(), true)['data'] ?? [];
    foreach (['v2node', 'v2box'] as $kind) {
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
    $configMode=fileperms($configPath)&0777;
    $response = $call('/api/v1/' . $securePath . '/config/save', ['show_subscribe_expire' => 0], $token);
    $assert((fileperms($configPath)&0777)===$configMode,'Atomic configuration save preserves permissions');
    $beforeFailure=file_get_contents($configPath);
    $writer=Illuminate\Support\Facades\File::getFacadeRoot();
    Illuminate\Support\Facades\File::partialMock()->shouldReceive('replace')->once()->andThrow(new RuntimeException('simulated storage failure'));
    try {
        $failedSave=$call('/api/v1/'.$securePath.'/config/save',['show_subscribe_expire'=>1],$token);
        $assert($failedSave->getStatusCode()===500 && file_get_contents($configPath)===$beforeFailure,'Failed configuration replacement preserves the last valid file');
    } finally { Illuminate\Support\Facades\File::swap($writer); }

    $assert($response->getStatusCode() === 422, 'Zero subscription interval should be rejected');
    $nodeStateBeforeAddressChange = App\Models\ServerV2box::orderBy('id')->get()->toArray();
    config(['v2board.app_url'=>'https://site.example.test']);
    foreach (['https://api-old.example.test/', 'https://api-new.example.test:8443/', null] as $nodeApiUrl) {
        $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Settings test administrator session remains valid before saving '.($nodeApiUrl ?? 'fallback'));
        $saved = $call('/api/v1/'.$securePath.'/config/save', ['server_api_url'=>$nodeApiUrl], $token);
        // config:cache boots a separate application; keep this transaction's test container.
        Illuminate\Container\Container::setInstance($app);
        Illuminate\Support\Facades\Facade::setFacadeApplication($app);
        Illuminate\Support\Facades\Facade::clearResolvedInstances();
        Illuminate\Database\Eloquent\Model::setConnectionResolver($app['db']);
        Illuminate\Database\Eloquent\Model::setEventDispatcher($app['events']);
        $assert($saved->getStatusCode()===200, 'Administrator can change or clear the node API address '.($nodeApiUrl ?? 'fallback').': '.$saved->getStatusCode().' '.$saved->getContent());
        $persisted = require $configPath;
        $expectedHost = rtrim((string)($nodeApiUrl ?: $persisted['app_url']), '/');
        $pipes=[];
        $probe=proc_open([PHP_BINARY,'-r','require "tests/support/autoload.php"; $app=require "bootstrap/app.php"; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo App\\Services\\NodeDeployment::host();'], [['pipe','r'],['pipe','w'],['pipe','w']], $pipes, base_path());
        fclose($pipes[0]);$freshHost=stream_get_contents($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        $assert(proc_close($probe)===0 && $freshHost===$expectedHost, 'A fresh application process immediately uses the saved node API address');
        config(['v2board.server_api_url'=>$persisted['server_api_url']]);
        foreach ((new App\Services\ServerService())->getAllV2node('v2box') as $deploymentNode) {
            if (!empty($deploymentNode['service_id'])) continue;
            foreach (['install_command','upgrade_command'] as $commandField) {
                $command=$deploymentNode[$commandField];
                $assert(str_contains($command, "'".$expectedHost.'/api/v10/public/node-deployment/bootstrap'."'") && str_contains($command,'--install v1.0.16') && !str_contains($command,'//api/'), 'Install and upgrade commands use the current saved API address and pinned release');
            }
            $assert(str_ends_with($deploymentNode['upgrade_command'],'--update'), 'Changing API address preserves the existing-installation upgrade mode');
        }
    }
    $assert(App\Models\ServerV2box::orderBy('id')->get()->toArray()===$nodeStateBeforeAddressChange, 'Saving node API settings leaves existing nodes and certificate fields unchanged');
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
    foreach (['v2node', 'v2box'] as $nodeType) {
        $model = 'App\\Models\\Server' . ucfirst($nodeType);
        $originalNode = $model::where('name', $nodeType === 'v2node' ? 'console-smoke-node' : 'console-smoke-' . $nodeType . '-vless')->first();
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
    // Invalid management input must not mutate records or leak an open transaction.
    foreach (['save','drop'] as $operation) {
        $invalid=$call('/api/v1/'.$securePath.'/server/group/'.$operation,[], $token);
        $assert($invalid->getStatusCode()===422,'Missing group input is a validation error');
    }
    $invalid=$call('/api/v1/'.$securePath.'/server/group/save',['id'=>2147483647,'name'=>'missing'],$token);
    $assert($invalid->getStatusCode()===404,'Missing group edit is not a null-object failure');
    $assert($call('/api/v1/'.$securePath.'/plan/drop',[],$token)->getStatusCode()===422,'Missing plan delete ID is rejected');
    $invalid=$call('/api/v1/'.$securePath.'/payment/save',['name'=>'invalid','payment'=>'UnknownProvider','config'=>['key'=>'fixture']],$token);
    $assert($invalid->getStatusCode()===422,'Unknown payment implementation cannot be saved');
    // Whole-console button regression: temporary records only, no external delivery.
    $plan2 = App\Models\Plan::create(['name' => 'console-sort-plan', 'group_id' => $group->id, 'transfer_enable' => 5, 'month_price' => 500]);
    $beforeSort = $plan2->fresh()->sort;
    $beforeLevel = Illuminate\Support\Facades\DB::transactionLevel();
    foreach ([[$plan2->id,2147483647],[$plan2->id,$plan2->id],['bad-id']] as $ids) {
        $invalid = $call('/api/v1/'.$securePath.'/plan/sort', ['plan_ids'=>$ids], $token);
        $assert($invalid->getStatusCode()===422 && $plan2->fresh()->sort===$beforeSort, 'Invalid plan/sort preserves the entire previous order');
        $assert(Illuminate\Support\Facades\DB::transactionLevel()===$beforeLevel, 'Invalid plan/sort releases its transaction');
    }
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
    $beforeSort = $payment2->fresh()->sort;
    $beforeLevel = Illuminate\Support\Facades\DB::transactionLevel();
    foreach ([[$payment2->id,2147483647],[$payment2->id,$payment2->id],['bad-id']] as $ids) {
        $invalid = $call('/api/v1/'.$securePath.'/payment/sort', ['ids'=>$ids], $token);
        $assert($invalid->getStatusCode()===422 && $payment2->fresh()->sort===$beforeSort, 'Invalid payment/sort preserves the entire previous order');
        $assert(Illuminate\Support\Facades\DB::transactionLevel()===$beforeLevel, 'Invalid payment/sort releases its transaction');
    }
    $response = $call('/api/v1/' . $securePath . '/payment/sort', ['ids' => [$payment2->id, $payment->id]], $token);
    $assert($response->getStatusCode() === 200 && $payment2->refresh()->sort == 1 && $payment->refresh()->sort == 2, 'Payment order failed');
    $response = $call('/api/v1/' . $securePath . '/payment/show', ['id' => $payment2->id], $token);
    $assert($response->getStatusCode() === 200 && $payment2->refresh()->enable == 1, 'Payment enable failed');
    $response = $call('/api/v1/' . $securePath . '/payment/drop', ['id' => $payment2->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\Payment::find($payment2->id), 'Payment deletion failed');
    $vmess = App\Models\ServerV2box::where('name', 'console-smoke-v2box-vmess')->first();
    $response = $call('/api/v1/' . $securePath . '/server/manage/sort', ['v2node' => [$node->id => 2], 'v2box' => [$vmess->id => 1]], $token);
    $assert($response->getStatusCode() === 200 && $node->refresh()->sort == 2 && $vmess->refresh()->sort == 1, 'Cross-backend node order failed: ' . $response->getContent());
    $maintenanceUrl='/api/v1/'.$securePath.'/server/manage/maintenance';
    $maintenanceInput=['type'=>'v2box','id'=>$vmess->id,'enabled'=>true,'reason'=>'升级维护','endsAt'=>time()+3600,'hideSubscription'=>true];
    foreach ([null,$subjectToken] as $unauthorized) $assert($call($maintenanceUrl,$maintenanceInput,$unauthorized)->getStatusCode()===403,'Maintenance is admin-only');
    $originalShow=$vmess->show;
    $assert($call($maintenanceUrl,$maintenanceInput,$token)->getStatusCode()===200,'Administrator may enable maintenance');
    $assert($vmess->refresh()->show===$originalShow,'Maintenance never overwrites subscription visibility setting');
    $assert($call($maintenanceUrl,array_merge($maintenanceInput,['endsAt'=>time()-1]),$token)->getStatusCode()===422,'Past maintenance end rejected');
    $assert($call($maintenanceUrl,array_merge($maintenanceInput,['endsAt'=>time()+31*86400]),$token)->getStatusCode()===422,'Unbounded maintenance end rejected');
    $assert($call($maintenanceUrl,array_merge($maintenanceInput,['type'=>'vless']),$token)->getStatusCode()===422,'Unknown maintenance backend rejected');
    $assert($call($maintenanceUrl,array_merge($maintenanceInput,['id'=>2147483647]),$token)->getStatusCode()===404,'Missing node maintenance rejected');
    $assert($call($maintenanceUrl,['type'=>'v2box','id'=>$vmess->id,'enabled'=>false,'hideSubscription'=>false],$token)->getStatusCode()===200,'Administrator may end maintenance');
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
    $beforeSort = $knowledge[1]->fresh()->sort;
    $beforeLevel = Illuminate\Support\Facades\DB::transactionLevel();
    foreach ([[$knowledge[1]->id,2147483647],[$knowledge[1]->id,$knowledge[1]->id],['bad-id']] as $ids) {
        $invalid = $call('/api/v1/'.$securePath.'/knowledge/sort', ['knowledge_ids'=>$ids], $token);
        $assert($invalid->getStatusCode()===422 && $knowledge[1]->fresh()->sort===$beforeSort, 'Invalid knowledge/sort preserves the entire previous order');
        $assert(Illuminate\Support\Facades\DB::transactionLevel()===$beforeLevel, 'Invalid knowledge/sort releases its transaction');
    }
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
    $assert((int) $ticket->status === 0, 'Admin reply immediately closed ticket');
    // A stale parent timestamp must not close a newly created admin message.
    App\Models\Ticket::whereKey($ticket->id)->update(['updated_at' => time() - 90000]);
    Illuminate\Support\Facades\Artisan::call('check:ticket');
    $assert((int) $ticket->refresh()->status === 0, 'Fresh admin message closed using stale ticket timestamp');
    App\Models\TicketMessage::where('ticket_id', $ticket->id)->update(['created_at' => time() - 86300]);
    Illuminate\Support\Facades\Artisan::call('check:ticket');
    $assert((int) $ticket->refresh()->status === 0, 'Ticket closed before 24 hours');
    App\Models\TicketMessage::where('ticket_id', $ticket->id)->update(['created_at' => time() - 86401]);
    Illuminate\Support\Facades\Artisan::call('check:ticket');
    $assert((int) $ticket->refresh()->status === 1, 'Unanswered admin reply not closed after 24 hours');
    $messageCount = App\Models\TicketMessage::where('ticket_id', $ticket->id)->count();
    $assert($call('/api/v1/' . $securePath . '/ticket/reply', ['id'=>$ticket->id, 'message'=>'stale form'], $token)->getStatusCode() === 409, 'Stale reply reopened a closed ticket');
    $assert(App\Models\TicketMessage::where('ticket_id', $ticket->id)->count() === $messageCount, 'Rejected reply stored a message');
    $ticket->status = 0; $ticket->save();
    App\Models\TicketMessage::create(['ticket_id'=>$ticket->id, 'user_id'=>$subscriber->id, 'message'=>'user follow-up', 'created_at'=>time()-90000]);
    App\Models\Ticket::whereKey($ticket->id)->update(['updated_at'=>time()-90000, 'reply_status'=>1]);
    Illuminate\Support\Facades\Artisan::call('check:ticket');
    $assert((int) $ticket->refresh()->status === 0, 'Latest user reply ignored due to stale reply flag');
    $assert($call('/api/v1/' . $securePath . '/ticket/reply', ['id'=>$ticket->id, 'message'=>['html'=>'invalid']], $token)->getStatusCode() === 422, 'Non-text reply accepted');
    // Simulate a reply arriving after the scheduler reads a candidate, before it saves.
    App\Models\TicketMessage::create(['ticket_id'=>$ticket->id, 'user_id'=>$user->id, 'message'=>'old admin reply', 'created_at'=>time()-90000]);
    App\Models\Ticket::whereKey($ticket->id)->update(['updated_at'=>time()-90000, 'reply_status'=>1]);
    $racePending = true;
    App\Models\Ticket::retrieved(function ($candidate) use (&$racePending, $ticket, $user) {
        if (!$racePending || (int)$candidate->id !== (int)$ticket->id) return;
        $racePending = false;
        App\Models\TicketMessage::create(['ticket_id'=>$ticket->id, 'user_id'=>$user->id, 'message'=>'new reply during scheduler scan']);
        App\Models\Ticket::whereKey($ticket->id)->update(['updated_at'=>time(), 'reply_status'=>1]);
    });
    Illuminate\Support\Facades\Artisan::call('check:ticket');
    $assert(!$racePending && (int)$ticket->refresh()->status === 0, 'Scheduler overwrote a reply received after its initial scan');
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
    $geoConfig=config('v2board');
    $readers=new ReflectionProperty(App\Services\GeoIpService::class,'readers');
    $savedReaders=$readers->getValue();
    $corrupt=storage_path('app/corrupt-geoip-'.bin2hex(random_bytes(6)).'.mmdb');
    file_put_contents($corrupt,'invalid optional geoip database');
    try {
        foreach (['country','city','asn'] as $type) {
            config(['v2board.geoip_'.$type.'_path'=>$corrupt]);
        }
        $readers->setValue(null,[]);
        $fallback=(new App\Services\GeoIpService())->lookup('8.8.8.8');
        $assert(count(array_filter($fallback,fn($v)=>$v!==null))===0,'Corrupt optional GeoIP must return empty metadata');
        $assert((new App\Services\GeoIpService())->sessionCountry('8.8.8.8')===null,'Corrupt GeoIP must not prevent session management');
    } finally { config(['v2board'=>$geoConfig]); $readers->setValue(null,$savedReaders); unlink($corrupt); }
    $geo = (new App\Services\GeoIpService())->lookup('8.8.8.8');
    $assert($geo['country'] !== null && $geo['asn'] === 'AS15169', 'GeoIP lookup failed');
    $footer = '<div data-console-smoke="footer">Footer smoke test</div>';
    $siteUrl=config('v2board.app_url');
    config(['v2board.app_url'=>'http://unsafe.example.test']);
    $assert($call('/api/v1/'.$securePath.'/config/save',['passkey_enable'=>1],$token)->getStatusCode()===503,'Passkey rejects insecure production origin');
    config(['v2board.app_url'=>'https://passkey.example.test','v2board.recaptcha_enable'=>1,'v2board.recaptcha_key'=>'retired-test-only','v2board.frontend_theme_google_analytics'=>'retired-test-only']);
    // config:cache boots a fresh container; validate with the transaction-bound user before that final save.
    $invalidPolicy=$call('/api/v1/'.$securePath.'/config/save',['browser_policy_wechat'=>'invalid'],$token);
    $assert($invalidPolicy->getStatusCode()===422,'Admin rejects invalid browser policy: '.$invalidPolicy->getStatusCode());
    $response = $call('/api/v1/' . $securePath . '/config/save', ['custom_footer_html' => $footer,'passkey_enable'=>1,'browser_policy_wechat'=>'prompt','browser_policy_qq'=>'allow','browser_policy_weibo'=>'guide'], $token);
    $assert($response->getStatusCode() === 200, 'Footer save failed: ' . $response->getContent());
    $saved=require $configPath;
    $assert($saved['browser_policy_wechat']==='prompt' && $saved['browser_policy_qq']==='allow' && $saved['browser_policy_weibo']==='guide','Admin API persists separate browser policy choices');
    $assert(($saved['passkey_enable']??0)==1,'Administrator can persist Passkey switch');
    $assert(!array_key_exists('recaptcha_enable',$saved) && !array_key_exists('recaptcha_key',$saved) && !array_key_exists('frontend_theme_google_analytics',$saved),'Saving settings removes legacy CAPTCHA and Google Analytics configuration');
    config(['v2board.app_url'=>$siteUrl]);
    $assert(config('v2board.password_limit_enable', 1) === ($originalConfig['password_limit_enable'] ?? 1), 'Partial settings update changed an unrelated switch');
    config(['v2board.custom_footer_html' => $footer]);
    $assert(strpos($call('/app')->getContent(), $footer) !== false, 'Footer was not rendered in user shell');
    $assert(strpos($call('/')->getContent(), '<title>' . e(config('v2board.app_name', 'V2Board')) . '</title>') !== false && strpos($call('/')->getContent(), $footer) === false, 'Public landing metadata or footer isolation failed');
    $assert(strpos($call('/' . $securePath)->getContent(), $footer) === false, 'User footer leaked into admin shell');
    $assert(Illuminate\Support\Facades\Artisan::call('console:verify')===0, 'Production console assets or Laravel rendering failed');
    echo "Console smoke tests: {$checks} checks passed\n";
} catch (Throwable $error) {
    $failure = $error;
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    file_put_contents($configPath, $originalFile);
    config(['v2board' => $originalConfig]);
    Illuminate\Support\Facades\Artisan::call('config:cache');
}
if ($failure) { fwrite(STDERR, $failure->getMessage() . "\n"); exit(1); }
