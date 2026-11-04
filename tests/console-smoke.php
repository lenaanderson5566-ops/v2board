<?php
// Run with: php tests/console-smoke.php (requires a configured local database).
$app = require __DIR__.'/support/bootstrap.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$configPath = base_path('config/fastai.php');
$originalFile = is_file($configPath) ? file_get_contents($configPath) : null;
$originalConfig = config('fastai');
$securePath = config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
$opsPath = config('fastai.ops_api_path', 'ops');
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
    config(['fastai.app_url'=>'https://site.example.test']);
    $user = App\Models\User::create([
        'email' => 'console-smoke-' . bin2hex(random_bytes(5)) . '@example.com',
        'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'uuid' => App\Utils\Helper::guid(true), 'token' => App\Utils\Helper::guid(), 'is_admin' => 1,
    ]);
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $userDetail = function (int $id) use ($call, $securePath, $token): array {
        return json_decode($call('/api/v1/'.$securePath.'/user/getUserInfoById?id='.$id, null, $token)->getContent(), true)['data'];
    };
    $editPayload = fn (array $data) => $data + ['edit_versions'=>array_intersect_key($userDetail($data['id'])['edit_versions'], $data)];
    $confirmBulk = function (string $operation, array $filters, int $count) use ($call, $securePath, $token, $assert) {
        $payload = ['filter'=>$filters, 'expected_count'=>$count];
        $response = $call('/api/v1/'.$securePath.'/user/previewBulk', $payload + ['operation'=>$operation], $token);
        $data = json_decode($response->getContent(), true)['data'] ?? [];
        $assert($response->getStatusCode()===200 && ($data['total'] ?? null)===$count
            && is_string($data['scope_token'] ?? null), 'Bulk preview must capture the matching user set');
        return $payload + ['scope_token'=>$data['scope_token']];
    };
    $adminScope = [['key'=>'id', 'condition'=>'=', 'value'=>$user->id]];
    $adminFields = ['id'=>$user->id, 'email'=>$user->email, 'banned'=>0, 'is_admin'=>1];
    foreach ([
        ['update', $editPayload(array_replace($adminFields, ['is_admin'=>0]))],
        ['update', $editPayload(array_replace($adminFields, ['banned'=>1]))],
        ['ban', $confirmBulk('ban', $adminScope, 1)],
        ['delUser', ['id'=>$user->id]],
        ['allDel', $confirmBulk('delete', $adminScope, 1)],
    ] as [$action, $payload]) {
        $response = $call('/api/v1/'.$securePath.'/user/'.$action, $payload, $token);
        $assert($response->getStatusCode()===409 && $user->fresh()?->is_admin
            && !$user->fresh()->banned && App\Services\AuthService::decryptAuthData($token)!==false,
            'Last administrator must retain access after a rejected '.$action);
    }
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
        $browserHtml=$browserResponse->getContent();
        $assert($browserResponse->getStatusCode()===200 && str_contains($browserHtml,'window.FASTAI') && str_contains($browserHtml,'browserPolicies'),'All browser UAs receive the canonical frontend boot');
        $assert((bool)preg_match('/window\.V2BOARD\s*=\s*window\.FASTAI\s*;/', $browserHtml), 'Cached legacy frontend bundles must receive the same runtime object');
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
    $response = $call('/api/v1/' . $securePath . '/user/update', $editPayload($editUser + ['is_staff'=>1]), $token);
    $subject->refresh();
    $assert($response->getStatusCode() === 200 && $subject->u == 536870912 && $subject->d == 1073741824 && $subject->commission_type == 2, 'User traffic and commission fields did not persist');
    $assert($subject->invite_user_id == $user->id, 'Unrelated user update cleared the inviter');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editPayload($editUser + ['invite_user_email' => '']), $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id === null, 'Explicit inviter removal failed');
    $response = $call('/api/v1/' . $securePath . '/user/update', $editPayload($editUser + ['invite_user_email' => $user->email]), $token);
    $assert($response->getStatusCode() === 200 && $subject->refresh()->invite_user_id == $user->id, 'Inviter email assignment failed');
    $originalGroup=$subject->group_id;
    $subject->group_id=98765;$subject->save();
    $response=$call('/api/v1/'.$securePath.'/user/update',$editPayload($editUser),$token);
    $assert($response->getStatusCode()===200 && $subject->fresh()->group_id===98765,'Unrelated edits preserve access group without an explicit plan change');
    foreach ([$subject->email,'missing-inviter@example.invalid'] as $email) {
        $response=$call('/api/v1/'.$securePath.'/user/update',$editPayload($editUser+['invite_user_email'=>$email]),$token);
        $assert($response->getStatusCode()===422 && $subject->fresh()->invite_user_id===$user->id,'Invalid inviter edits preserve the current inviter');
    }
    $subject->group_id=$originalGroup;$subject->save();
    $updatePath = '/api/v1/'.$securePath.'/user/update';
    $staleVersions = $userDetail($subject->id)['edit_versions'];
    $subject->update(['balance'=>731, 'u'=>601295421, 'banned'=>1]);
    $assert($call($updatePath, ['id'=>$subject->id, 'remarks'=>'Independent note',
        'edit_versions'=>['remarks'=>$staleVersions['remarks']]], $token)->getStatusCode()===200,
        'Changes to untouched fields should not invalidate an independent edit');
    $assert($subject->refresh()->balance===731 && $subject->u===601295421 && $subject->banned===1,
        'Remarks-only update restored stale balance, usage, or access');
    $assert($call($updatePath, ['id'=>$subject->id, 'balance'=>1, 'banned'=>0,
        'edit_versions'=>array_intersect_key($staleVersions, ['balance'=>true, 'banned'=>true])], $token)->getStatusCode()===409
        && $subject->refresh()->balance===731 && $subject->banned===1,
        'Stale edit to a balance or permission must roll back the entire update');
    $assert($call($updatePath, ['id'=>$subject->id, 'banned'=>0], $token)->getStatusCode()===422,
        'An old full-form client must reload before submitting user edits');
    $subject->update(['balance'=>0, 'u'=>536870912, 'banned'=>0]);
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
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, ['filter' => $scope, 'expected_count' => 1], $token)->getStatusCode() === 422, 'Count-only destructive operation accepted: ' . $method);
        $assert($call('/api/v1/' . $securePath . '/user/' . $method, ['filter' => $scope, 'expected_count' => 2, 'scope_token'=>str_repeat('a', 64)], $token)->getStatusCode() === 409, 'Changed operation scope accepted: ' . $method);
    }
    $assert($subject->refresh()->banned === 0 && App\Models\User::find($subject->id), 'Rejected operation changed the user');
    Illuminate\Support\Facades\Bus::fake();
    $mailScope = ['filter' => $scope, 'expected_count' => 1, 'purpose' => 'service'];
    $preview = $call('/api/v1/'.$securePath.'/user/previewMailAudience', $mailScope, $token);
    $previewToken = json_decode($preview->getContent(), true)['data']['audience_token'] ?? null;
    $assert($preview->getStatusCode()===200 && is_string($previewToken), 'Scoped mail preview did not return an audience token');
    $response = $call('/api/v1/'.$securePath.'/user/sendMail', $mailScope + ['audience_token' => $previewToken,
        'request_key' => (string) Illuminate\Support\Str::uuid(), 'subject' => 'test', 'content' => '<p>test</p>'], $token);
    $campaignId = json_decode($response->getContent(), true)['data']['campaign_id'] ?? null;
    $recipients = Illuminate\Support\Facades\DB::table('v2_mail_campaign_recipient')->where('campaign_id', $campaignId)->get();
    $assert($response->getStatusCode() === 202 && $recipients->count() === 1 && (int) $recipients->first()->user_id === $subject->id && $recipients->first()->status === 'queued', 'Scoped mail did not reach the campaign queue');
    $oldUuid = $subject->uuid; $oldToken = $subject->token;
    $response = $call('/api/v1/' . $securePath . '/user/resetSecret', ['id' => $subject->id], $token);
    $subject->refresh();
    $assert($response->getStatusCode() === 200 && $subject->uuid !== $oldUuid && $subject->token !== $oldToken, 'Reset did not replace both credentials');
    $response = $call('/api/v1/' . $securePath . '/user/ban', $confirmBulk('ban', $scope, 1), $token);
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
    $batchUsers = [];
    for ($i=0;$i<3;$i++) $batchUsers[] = App\Models\User::create([
        'email'=>'delete-'.$i.'@'.$suffix,'password'=>'test-only-unusable-hash',
        'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),
    ]);
    $batchScope = [['key' => 'email', 'condition' => '模糊', 'value' => '@' . $suffix]];
    $banScope = $confirmBulk('ban', $batchScope, 3);
    $deleteScope = $confirmBulk('delete', $batchScope, 3);
    $assert($call('/api/v1/'.$securePath.'/user/allDel', $banScope, $token)->getStatusCode()===409,
        'A ban preview must not authorize deletion');
    $originalEmail = $batchUsers[0]->email;
    $batchUsers[0]->update(['email'=>'moved@outside-'.$suffix]);
    $substitute = App\Models\User::create([
        'email'=>$originalEmail, 'password'=>'test-only-unusable-hash',
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(),
    ]);
    $assert($call('/api/v1/'.$securePath.'/user/ban', $banScope, $token)->getStatusCode()===409
        && !$substitute->refresh()->banned, 'Same-count member swap must reject bulk ban');
    $assert($call('/api/v1/'.$securePath.'/user/allDel', $deleteScope, $token)->getStatusCode()===409
        && $substitute->fresh() && $batchUsers[1]->fresh(), 'Same-count member swap must reject bulk deletion');
    $response = $call('/api/v1/' . $securePath . '/user/allDel', $confirmBulk('delete', $batchScope, 3), $token);
    $assert($response->getStatusCode() === 200 && App\Models\User::where('email', 'like', '%@' . $suffix)->count() === 0 && App\Models\User::find($subject->id), 'Scoped deletion changed unrelated users');
    $assert($batchUsers[0]->fresh() !== null, 'User outside the newly confirmed scope was deleted');
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
    $assert(!array_key_exists('allow_new_period',$rules),'Retired traffic period advance is absent from the admin settings schema');
    $assert($call('/api/v1/' . $securePath . '/console/nodeSchema?type=v2box')->getStatusCode() === 403, 'Node schema must require admin authentication');
    foreach (['v2box'] as $type) {
        $response = $call('/api/v1/' . $securePath . '/console/nodeSchema?type=' . $type, null, $token);
        $rules = json_decode($response->getContent(), true)['data'] ?? [];
        $assert($response->getStatusCode() === 200 && isset($rules['host'], $rules['name'], $rules['group_id']), 'Node schema failed: ' . $type);
    }
    $group = new App\Models\ServerGroup();
    $group->name = 'console-smoke-group';
    $group->save();
    $nodeParams = ['name' => 'console-smoke-node', 'group_id' => [$group->id], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'protocol' => 'vless', 'tls' => 1, 'network' => 'ws', 'disable_sni' => 0, 'zero_rtt_handshake' => 0, 'show' => 0, 'tls_settings' => ['server_name' => 'example.invalid', 'allow_insecure' => 0], 'network_settings' => ['path' => '/test', 'headers' => ['Host' => 'example.invalid']]];
    $response = $call('/api/v1/' . $securePath . '/server/v2box/save', $nodeParams, $token);
    $assert($response->getStatusCode() === 200, 'Structured node save failed: ' . $response->getContent());
    $node = App\Models\ServerV2box::where('name', 'console-smoke-node')->first();
    $assert($node && $node->tls_settings['server_name'] === 'example.invalid' && $node->network_settings['headers']['Host'] === 'example.invalid', 'Structured node values did not persist');
    $updated = $nodeParams + ['id' => $node->id, 'region_code' => 'us', 'city_code' => 'San Jose', 'display_label' => 'A'];
    $updated['host'] = 'updated.example.invalid';
    $response = $call('/api/v1/' . $securePath . '/server/v2box/save', $updated, $token);
    $assert($response->getStatusCode() === 200, 'Updated address and location save failed');
    $assert($node->fresh()->host==='example.invalid','Protocol editing preserves the independent connection address');
    $address=json_decode($call('/api/v1/'.$securePath.'/server/connections/address?type=v2box&id='.$node->id,null,$token)->getContent(),true)['data'];
    $response=$call('/api/v1/'.$securePath.'/server/connections/address',['type'=>'v2box','id'=>$node->id,'revision'=>$address['revision'],'host'=>'updated.example.invalid','port'=>'443','confirm'=>true],$token,null,'application/json','PATCH');
    $assert($response->getStatusCode()===200 && $node->fresh()->host==='updated.example.invalid','Dedicated address editing persists the connection address');
    $line=json_decode($call('/api/v1/'.$securePath.'/server/connections/default?type=v2box&id='.$node->id,null,$token)->getContent(),true)['data'];
    $values=array_merge($line['values'],['type'=>'v2box','id'=>$node->id,'revision'=>$line['revision'],'region_code'=>'us','city_code'=>'San Jose','display_label'=>'A']);
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
    foreach (['v2box'] as $backend) foreach ($nodeVariants as $kind => $variant) {
        $body = array_merge(['name' => 'console-smoke-' . $backend . '-' . $kind, 'protocol' => $kind, 'group_id' => [$group->id], 'route_id' => [], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'show' => 0, 'tls' => 1, 'network' => 'tcp', 'disable_sni' => 0, 'zero_rtt_handshake' => 0], $variant);
        $response = $call('/api/v1/' . $securePath . '/server/' . $backend . '/save', $body, $token);
        $assert($response->getStatusCode() === 200, 'Node variant save failed: ' . $backend . '/' . $kind . ': ' . $response->getContent());
    }
    $assert(App\Models\ServerV2box::where('name', 'console-smoke-v2box-anytls')->first()->padding_scheme === ['stop=8', '0=30-30'], 'AnyTLS padding JSON failed to round-trip');
    $assert(App\Models\ServerV2box::where('name', 'console-smoke-v2box-tuic')->first()->congestion_control === 'bbr', 'TUIC option did not persist');
    $response = $call('/api/v1/' . $securePath . '/server/manage/getNodes', null, $token);
    $savedNodes = json_decode($response->getContent(), true)['data'] ?? [];
    foreach (['v2box'] as $kind) {
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
    $activeConfigPath=App\Support\SiteConfiguration::readPath();
    $configMode=fileperms($activeConfigPath)&0777;
    $zeroIntervalResponse = $call('/api/v1/' . $securePath . '/config/save', ['show_subscribe_expire' => 0], $token);
    $response = $call('/api/v1/' . $securePath . '/config/save', ['show_subscribe_expire' => 1], $token);
    // config:cache boots a fresh app; retain this test's transaction and kernel bindings.
    Illuminate\Container\Container::setInstance($app);
    Illuminate\Support\Facades\Facade::setFacadeApplication($app);
    Illuminate\Support\Facades\Facade::clearResolvedInstances();
    Illuminate\Database\Eloquent\Model::setConnectionResolver($app['db']);
    Illuminate\Database\Eloquent\Model::setEventDispatcher($app['events']);
    clearstatcache(true,$configPath);
    $assert($response->getStatusCode()===200 && is_file($configPath) && (fileperms($configPath)&0777)===$configMode,'Atomic configuration save creates the canonical file without widening permissions');
    $beforeFailure=file_get_contents($configPath);
    $writer=Illuminate\Support\Facades\File::getFacadeRoot();
    Illuminate\Support\Facades\File::partialMock()->shouldReceive('replace')->once()->andThrow(new RuntimeException('simulated storage failure'));
    try {
        $failedSave=$call('/api/v1/'.$securePath.'/config/save',['show_subscribe_expire'=>1],$token);
        $assert($failedSave->getStatusCode()===500 && file_get_contents($configPath)===$beforeFailure,'Failed configuration replacement preserves the last valid canonical file');
    } finally { Illuminate\Support\Facades\File::swap($writer); }

    // A first canonical save must not widen a legacy-only private configuration.
    $permissionDirectory=sys_get_temp_dir().'/fastai-private-config-'.bin2hex(random_bytes(8));
    mkdir($permissionDirectory,0700);
    $originalPermissionDirectory=$app->configPath();
    $permissionSettings=config('fastai');
    $legacyPermissionSettings=$permissionSettings;
    $legacyPermissionSettings['legacy_only_setting']='preserved';
    $legacyPermissionSettings = array_replace($legacyPermissionSettings, [
        'email_announcement_separate'=>0, 'email_announcement_provider'=>'smtp',
        'email_announcement_host'=>'smtp.example.test', 'email_announcement_port'=>587,
        'email_announcement_from_address'=>'announcement@example.test',
    ]);
    $release = ['platform'=>'windows', 'architecture'=>'x64', 'channel'=>'stable', 'latestVersion'=>'1.1.0',
        'latestBuild'=>1, 'minimumVersion'=>'1.0.0', 'downloadUrl'=>'https://example.invalid/fastai.exe',
        'sha256'=>str_repeat('a',64), 'publishedAt'=>'2026-10-06T00:00:00Z'];
    $legacyRelease = array_replace($release, ['architecture'=>'x86']);
    $legacyPermissionSettings['fastai_releases']=[$legacyRelease];
    $legacyPermissionBytes='<?php return '.var_export($legacyPermissionSettings,true).';';
    file_put_contents($permissionDirectory.'/v2board.php',$legacyPermissionBytes);
    chmod($permissionDirectory.'/v2board.php',0600);
    $artisan=Illuminate\Support\Facades\Artisan::getFacadeRoot();
    $fastaiStrategy=App\Models\ClientStrategy::query()->firstOrNew(['client_type'=>'fastai']);
    $previousMinimum=$fastaiStrategy->min_version;
    $strategyExisted=$fastaiStrategy->exists;
    try {
        $app->useConfigPath($permissionDirectory);
        config(['fastai'=>$legacyPermissionSettings]);
        // Other cases exercise real config:cache; this fixture isolates the actual file write.
        Illuminate\Support\Facades\Artisan::partialMock()->shouldReceive('call')->times(4)->with('config:cache')->andReturn(0);
        $permissionResponse=$call('/api/v1/'.$securePath.'/config/save',['app_name'=>'Permission fixture'],$token);
        clearstatcache(true,$permissionDirectory.'/fastai.php');
        $assert($permissionResponse->getStatusCode()===200 && is_file($permissionDirectory.'/fastai.php')
            && (fileperms($permissionDirectory.'/fastai.php')&0777)===0600, 'First canonical save must preserve restrictive legacy file permissions');
        $permissionPersisted=require $permissionDirectory.'/fastai.php';
        $assert(($permissionPersisted['legacy_only_setting']??null)==='preserved'
            && file_get_contents($permissionDirectory.'/v2board.php')===$legacyPermissionBytes,
            'Canonical settings must retain existing values without modifying the legacy file');
        if (!$strategyExisted) $fastaiStrategy->client_name='FastAI';
        $fastaiStrategy->min_version='1.0.0';
        $fastaiStrategy->save();
        $settings = json_decode($call('/api/v1/'.$securePath.'/config/fetch', null, $token)->getContent(), true)['data']['app'];
        $revision = $settings['fastai_releases_revision'];
        $assert($settings['fastai_release_min_version']==='1.0.0'
            && $settings['fastai_release_targets']['windows']===['x64','arm64'], 'Publication metadata exposes effective inputs');
        $saveCatalog = fn (array $payload) => $call('/api/v1/'.$securePath.'/config/save', $payload, $token);
        $assert($saveCatalog(['fastai_releases'=>[]])->getStatusCode()===422, 'Removing all releases still requires a revision');
        $unsupported = $saveCatalog(['fastai_releases'=>[array_replace($legacyRelease,['latestBuild'=>2])], 'fastai_releases_revision'=>$revision]);
        $unsupportedMessage = json_decode($unsupported->getContent(), true)['message'] ?? '';
        $assert($unsupported->getStatusCode()===422 && str_contains($unsupportedMessage, '构建流程不支持'),
            'Unsupported targets cannot be republished with changed metadata (HTTP '.$unsupported->getStatusCode().' '.$unsupportedMessage.')');
        $blocked = $saveCatalog(['fastai_releases'=>[array_replace($release,['latestVersion'=>'0.9.0','minimumVersion'=>'0.9.0'])], 'fastai_releases_revision'=>$revision]);
        $assert($blocked->getStatusCode()===422 && str_contains(json_decode($blocked->getContent(), true)['message'] ?? '', '客户端访问策略最低版本'),
            'Publish rejects versions below the global access policy');
        $catalog = [$legacyRelease, $release];
        $assert($saveCatalog(['fastai_releases'=>$catalog, 'fastai_releases_revision'=>$revision, 'custom_footer_html'=>'<p>Published footer</p>'])->getStatusCode()===200,
            'Supported releases publish alongside an unchanged legacy target');
        $assert($saveCatalog(['fastai_releases'=>[$legacyRelease], 'fastai_releases_revision'=>$revision])->getStatusCode()===409,
            'Stale release draft cannot overwrite the saved catalog');
        $freshSettings = json_decode($call('/api/v1/'.$securePath.'/config/fetch', null, $token)->getContent(), true)['data']['app'];
        $assert($freshSettings['fastai_releases']===$catalog && $freshSettings['fastai_releases_revision']!==$revision,
            'Reload uses the saved catalog even when the worker config cache is stale');
        $assert($saveCatalog(['app_name'=>'Another settings writer'])->getStatusCode()===200, 'Independent settings update succeeds');
        $persisted = App\Support\SiteConfiguration::read();
        $assert($persisted['fastai_releases']===$catalog && $persisted['custom_footer_html']==='<p>Published footer</p>',
            'Independent save uses current disk settings rather than the stale worker snapshot');
        $assert(!isset($persisted['fastai_releases_revision']), 'The computed revision is not stored as a setting');
        $assert($saveCatalog(['email_announcement_host'=>null])->getStatusCode()===200,
            'Disabled independent announcement SMTP can clear its host');
        $invalidAnnouncement = $saveCatalog(['email_announcement_separate'=>1]);
        $announcementErrors = json_decode($invalidAnnouncement->getContent(), true)['errors'] ?? [];
        $assert($invalidAnnouncement->getStatusCode()===422 && isset($announcementErrors['email_announcement_host'])
            && !App\Support\SiteConfiguration::read()['email_announcement_separate'],
            'Enabling SMTP with a stale worker snapshot cannot save a missing host');
    } finally {
        if ($strategyExisted) {
            $fastaiStrategy->min_version=$previousMinimum;
            $fastaiStrategy->save();
        } elseif ($fastaiStrategy->exists) {
            $fastaiStrategy->delete();
        }
        Illuminate\Support\Facades\Artisan::swap($artisan);
        $app->useConfigPath($originalPermissionDirectory);
        config(['fastai'=>$permissionSettings]);
        foreach (['fastai.php','fastai.php.lock','v2board.php'] as $file) if (is_file($permissionDirectory.'/'.$file)) unlink($permissionDirectory.'/'.$file);
        rmdir($permissionDirectory);
    }

    $brandingSettings=config('fastai');
    $brandingAppName=config('app.name');
    try {
        $withoutSiteName=$brandingSettings;
        unset($withoutSiteName['app_name']);
        config(['fastai'=>$withoutSiteName,'app.name'=>'Custom environment brand']);
        $assert(App\Support\FrontendRuntime::config('user')['title']==='Custom environment brand', 'A custom environment brand must survive when site settings omit the name');
        config(['fastai.app_name'=>'Custom site brand']);
        $assert(App\Support\FrontendRuntime::config('user')['title']==='Custom site brand', 'An explicit custom site brand must retain precedence');
        config(['fastai.app_name'=>'V2Board']);
        $assert(App\Support\FrontendRuntime::config('user')['title']==='FastAI', 'A stored legacy default must render as the canonical product name');
    } finally { config(['fastai'=>$brandingSettings,'app.name'=>$brandingAppName]); }

    $assert($zeroIntervalResponse->getStatusCode() === 422, 'Zero subscription interval should be rejected');
    $nodeStateBeforeAddressChange = App\Models\ServerV2box::orderBy('id')->get()->toArray();
    config(['fastai.app_url'=>'https://site.example.test']);
    foreach (['https://api-old.example.test/', 'https://api-new.example.test:8443/', null] as $nodeApiUrl) {
        $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Settings test administrator session remains valid before saving '.($nodeApiUrl ?? 'fallback'));
        $saved = $call('/api/v1/'.$securePath.'/config/save', ['server_api_url'=>$nodeApiUrl, 'app_url'=>'https://site.example.test'], $token);
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
        config(['fastai.server_api_url'=>$persisted['server_api_url']]);
        foreach ((new App\Services\ServerService())->getAllV2box('v2box') as $deploymentNode) {
            if (!empty($deploymentNode['service_id'])) continue;
            foreach (['install_command','upgrade_command'] as $commandField) {
                $command=$deploymentNode[$commandField];
                $assert(str_contains($command, "'".$expectedHost.'/api/v10/public/node-deployment/bootstrap'."'") && str_contains($command,'--install v1.0.19') && !str_contains($command,'//api/'), 'Install and upgrade commands use the current saved API address and pinned release');
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
    $response = $call('/api/v1/' . $securePath . '/server/v2box/save', $nodeParams, $token);
    $node->refresh();
    $assert($response->getStatusCode() === 200 && !empty($node->tls_settings['public_key']) && !empty($node->tls_settings['private_key']) && $node->network_settings['serviceName'] === 'test-service', 'Reality/gRPC mode transition failed');
    foreach (['coupon' => ['type' => 2, 'value' => 20, 'limit_plan_ids' => [], 'limit_period' => ['month_price']], 'giftcard' => ['type' => 4]] as $kind => $params) {
        $params += ['name' => 'console-smoke-' . $kind, 'generate_count' => 2, 'started_at' => time(), 'ended_at' => time() + 86400];
        $response = $call('/api/v1/' . $securePath . '/' . $kind . '/generate', $params, $token);
        $payload = json_decode($response->getContent(), true);
        $assert($response->getStatusCode() === 200 && ($payload['generated_count'] ?? 0) === 2 && ($payload['data'] ?? null) === true, 'Batch JSON generation failed: ' . $kind);
    }
    foreach (['v2box'] as $nodeType) {
        $model = 'App\\Models\\Server' . ucfirst($nodeType);
        $originalNode = $model::where('name', 'console-smoke-' . $nodeType . '-vless')->first();
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
    $groupPlan = App\Models\Plan::create(['name'=>'Permission group fixture', 'group_id'=>$tempGroup->id, 'transfer_enable'=>5, 'month_price'=>500]);
    $groups = json_decode($call('/api/v1/'.$securePath.'/server/group/fetch', null, $token)->getContent(), true)['data'];
    $groupRow = collect($groups)->firstWhere('id', $tempGroup->id);
    $assert(($groupRow['plan_count'] ?? null) === 1, 'Group list shows how many plans depend on the group');
    $response = $call('/api/v1/'.$securePath.'/server/group/drop', ['id'=>$tempGroup->id], $token);
    $assert($response->getStatusCode()===422 && str_contains(json_decode($response->getContent(), true)['message'] ?? '', '套餐') && $tempGroup->fresh(), 'Group referenced by a plan is preserved with an actionable message');
    $groupPlan->delete();
    $previousGroupId = $user->refresh()->group_id;
    $user->update(['group_id'=>$tempGroup->id]);
    $response = $call('/api/v1/'.$securePath.'/server/group/drop', ['id'=>$tempGroup->id], $token);
    $assert($response->getStatusCode()===422 && str_contains(json_decode($response->getContent(), true)['message'] ?? '', '用户') && $tempGroup->fresh(), 'Group referenced by a user is preserved with an actionable message');
    $user->update(['group_id'=>$previousGroupId]);
    $response = $call('/api/v1/' . $securePath . '/server/group/drop', ['id' => $tempGroup->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\ServerGroup::find($tempGroup->id), 'Group deletion failed');
    $routeBody = ['remarks' => 'console-button-route', 'action' => 'sing_box', 'sing_box' => ['route'=>['rules'=>[['domain_suffix'=>['example.invalid'],'action'=>'reject']]]]];
    $response = $call('/api/v1/' . $securePath . '/server/route/save', $routeBody, $token);
    $tempRoute = App\Models\ServerRoute::where('remarks', $routeBody['remarks'])->first();
    $assert($response->getStatusCode() === 200 && $tempRoute, 'Route creation failed');
    $routeBody['id'] = $tempRoute->id; $routeBody['sing_box'] = ['dns'=>['servers'=>[['type'=>'udp','tag'=>'resolver','server'=>'8.8.8.8']],'final'=>'resolver']];
    $response = $call('/api/v1/' . $securePath . '/server/route/save', $routeBody, $token);
    $assert($response->getStatusCode() === 200 && $tempRoute->refresh()->sing_box['dns']['final'] === 'resolver', 'Native route edit failed');
    $invalidRouteBody = array_replace($routeBody, ['id'=>[$tempRoute->id]]);
    $assert($call('/api/v1/'.$securePath.'/server/route/save', $invalidRouteBody, $token)->getStatusCode()===422, 'Route save requires a scalar ID');
    foreach ([[], ['id'=>[$tempRoute->id]]] as $invalidRouteDrop) {
        $assert($call('/api/v1/'.$securePath.'/server/route/drop', $invalidRouteDrop, $token)->getStatusCode()===422 && $tempRoute->fresh(), 'Invalid route deletion is rejected without changing the saved route');
    }
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
    $assert($call('/api/v1/'.$securePath.'/notice/show', ['id'=>$notice->id], $token)->getStatusCode()===404
        && $call('/api/v1/'.$securePath.'/notice/drop', ['id'=>[$notice->id]], $token)->getStatusCode()===422, 'Notice actions distinguish missing records from invalid IDs');
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
    $response = $call('/api/v1/' . $securePath . '/server/manage/sort', ['v2box' => [$node->id => 2, $vmess->id => 1]], $token);
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
    $knowledgeEdit = ['id'=>$knowledge[0]->id,'title'=>$knowledge[0]->title,'category'=>$knowledge[0]->category,'language'=>'ja-JP'];
    $knowledgeSave = '/api/v1/'.$securePath.'/knowledge/save';
    $articlePath = '/api/v10/knowledge-articles/'.$knowledge[0]->id;
    $limitedReader = App\Models\User::create([
        'email'=>'knowledge-reader-'.bin2hex(random_bytes(5)).'@example.invalid',
        'password'=>password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(),
    ]);
    $limitedAuth = new App\Services\AuthService($limitedReader);
    $subscriberAuth = new App\Services\AuthService($subscriber);
    $subscriberExpiry = $subscriber->expired_at;
    try {
        $subscriber->update(['expired_at'=>time()+3600]);
        $assert((new App\Services\UserService())->isAvailable($subscriber->fresh()),
            'Knowledge fixture subscriber must have an active term');
        $limitedBearer = 'Bearer '.$limitedAuth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
        $subscriberBearer = 'Bearer '.$subscriberAuth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
        $balancedBody = 'public start<!--access start-->outer secret<!--access start-->inner secret<!--access end-->protected tail<!--access end-->public middle<!--access start-->another secret<!--access end-->public end';
        $assert($call($knowledgeSave, $knowledgeEdit + ['body'=>$balancedBody], $token)->getStatusCode()===200,
            'Balanced nested knowledge access blocks can be saved');
        $limitedArticle = $call($articlePath, null, $limitedBearer);
        $limitedBody = json_decode($limitedArticle->getContent(), true)['data']['body'] ?? '';
        $assert($limitedArticle->getStatusCode()===200 && substr_count($limitedBody, 'fastai-no-access')===2
            && !str_contains($limitedBody, 'secret') && !str_contains($limitedBody, 'protected tail')
            && str_contains($limitedBody, 'public start') && str_contains($limitedBody, 'public middle') && str_contains($limitedBody, 'public end'),
            'Knowledge renders public spans and hides complete nested sections for an unsubscribed reader');
        $fullArticle = $call($articlePath, null, $subscriberBearer);
        $assert($fullArticle->getStatusCode()===200 && (json_decode($fullArticle->getContent(), true)['data']['body'] ?? null)===$balancedBody,
            'Knowledge keeps protected text for an entitled reader');
        foreach (['<!--access start-->unclosed secret', 'stray secret<!--access end-->'] as $malformedBody) {
            $assert($call($knowledgeSave, $knowledgeEdit + ['body'=>$malformedBody], $token)->getStatusCode()===422
                && $knowledge[0]->fresh()->body===$balancedBody, 'Admin save rejects unpaired markers without changing the article');
        }
        foreach (['<!--access start-->unclosed secret', 'stray secret<!--access end--><!--access start-->another secret<!--access end-->'] as $legacyBody) {
            $knowledge[0]->update(['body'=>$legacyBody]);
            $legacyArticle = $call($articlePath, null, $limitedBearer);
            $legacyBody = json_decode($legacyArticle->getContent(), true)['data']['body'] ?? '';
            $assert($legacyArticle->getStatusCode()===200 && str_contains($legacyBody, 'fastai-no-access') && !str_contains($legacyBody, 'secret'),
                'A malformed legacy article returns a safe placeholder rather than hanging or exposing text');
        }
    } finally {
        $limitedAuth->removeAllSession();
        $subscriberAuth->removeAllSession();
        $subscriber->update(['expired_at'=>$subscriberExpiry]);
    }
    $response = $call('/api/v1/' . $securePath . '/knowledge/drop', ['id' => $knowledge[1]->id], $token);
    $assert($response->getStatusCode() === 200 && !App\Models\Knowledge::find($knowledge[1]->id), 'Knowledge deletion failed');
    $assert($call('/api/v1/'.$securePath.'/knowledge/fetch?id='.$knowledge[1]->id, null, $token)->getStatusCode()===404
        && $call('/api/v1/'.$securePath.'/knowledge/show', [], $token)->getStatusCode()===422, 'Knowledge actions distinguish missing records from invalid IDs');
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
        if ($kind === 'giftcard') {
            $redeemed = $model::where('name', $params['name'])->firstOrFail();
            $redeemed->used_user_ids = [$subscriber->id];
            $redeemed->save();
            $response = $call('/api/v1/'.$securePath.'/giftcard/drop', ['id'=>$redeemed->id], $token);
            $assert($response->getStatusCode()===409 && $redeemed->fresh()?->used_user_ids===[$subscriber->id], 'Gift-card deletion preserves redemption history');
        }
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
    $missingTicket = (int) App\Models\Ticket::max('id') + 1;
    $ticketPath = '/api/v1/'.$securePath.'/ticket/';
    $assert($call($ticketPath.'fetch?id='.$missingTicket, null, $token)->getStatusCode()===404
        && $call($ticketPath.'close', ['id'=>$missingTicket], $token)->getStatusCode()===404, 'A stale ticket ID returns not found');
    $assert($call($ticketPath.'fetch?id[]=1', null, $token)->getStatusCode()===422
        && $call($ticketPath.'close', [], $token)->getStatusCode()===422, 'Invalid ticket IDs are rejected before lookup');
    $ticketBus = Illuminate\Support\Facades\Bus::getFacadeRoot();
    $ticketThrottle = 'ticket_sendEmailNotify_'.$subscriber->id;
    Illuminate\Support\Facades\Cache::forget($ticketThrottle);
    Illuminate\Support\Facades\Bus::swap(new class($ticketBus) extends Illuminate\Support\Testing\Fakes\BusFake {
        public function dispatch($command)
        {
            if ($command instanceof App\Jobs\SendEmailJob) throw new RuntimeException('Synthetic ticket queue outage');
            return parent::dispatch($command);
        }
    });
    try {
        $response = $call($ticketPath.'reply', ['id'=>$ticket->id, 'message'=>'fixture reply'], $token);
        $assert($response->getStatusCode()===200 && $ticket->refresh()->reply_status===1
            && App\Models\TicketMessage::where('ticket_id', $ticket->id)->count()===1,
            'Queue failure made a persisted ticket reply appear unsuccessful');
        $assert(!Illuminate\Support\Facades\Cache::has($ticketThrottle), 'Failed ticket notification still blocked subsequent notifications');
    } finally {
        Illuminate\Support\Facades\Bus::swap($ticketBus);
    }
    $replyBus = Illuminate\Support\Facades\Bus::fake();
    try {
        $response = $call($ticketPath.'reply', ['id'=>$ticket->id, 'message'=>'follow-up reply'], $token);
        $assert($response->getStatusCode()===200, 'Follow-up reply failed after the queue recovered');
        $replyBus->assertDispatched(App\Jobs\SendEmailJob::class);
    } finally {
        Illuminate\Support\Facades\Bus::swap($ticketBus);
        Illuminate\Support\Facades\Cache::forget($ticketThrottle);
    }
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
    App\Models\Ticket::whereKey($ticket->id)->update(['reply_status' => 0]);
    $pendingTickets = App\Models\Ticket::where('status', 0)->where('reply_status', 0)->count();
    $overviewPath = '/api/v1/' . $securePath . '/stat/getOverride';
    $overviewBeforeClose = $call($overviewPath, null, $token);
    $assert($overviewBeforeClose->getStatusCode() === 200 && json_decode($overviewBeforeClose->getContent(), true)['data']['ticket_pending_total'] === $pendingTickets, 'Dashboard did not count the open unanswered ticket');
    $response = $call('/api/v1/' . $securePath . '/ticket/close', ['id' => $ticket->id], $token);
    $assert($response->getStatusCode() === 200 && $ticket->refresh()->status === 1, 'Ticket close failed');
    $overviewAfterClose = $call($overviewPath, null, $token);
    $assert($overviewAfterClose->getStatusCode() === 200 && json_decode($overviewAfterClose->getContent(), true)['data']['ticket_pending_total'] === $pendingTickets - 1, 'Dashboard retained the closed ticket after a cached overview was loaded');
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
    $geoConfig=config('fastai');
    $readers=new ReflectionProperty(App\Services\GeoIpService::class,'readers');
    $savedReaders=$readers->getValue();
    $corrupt=storage_path('app/corrupt-geoip-'.bin2hex(random_bytes(6)).'.mmdb');
    file_put_contents($corrupt,'invalid optional geoip database');
    try {
        foreach (['country','city','asn'] as $type) {
            config(['fastai.geoip_'.$type.'_path'=>$corrupt]);
        }
        $readers->setValue(null,[]);
        $fallback=(new App\Services\GeoIpService())->lookup('8.8.8.8');
        $assert(count(array_filter($fallback,fn($v)=>$v!==null))===0,'Corrupt optional GeoIP must return empty metadata');
        $assert((new App\Services\GeoIpService())->sessionCountry('8.8.8.8')===null,'Corrupt GeoIP must not prevent session management');
    } finally { config(['fastai'=>$geoConfig]); $readers->setValue(null,$savedReaders); unlink($corrupt); }
    $geo = (new App\Services\GeoIpService())->lookup('8.8.8.8');
    $assert($geo['country'] !== null && $geo['asn'] === 'AS15169', 'GeoIP lookup failed');
    $footer = '<div data-console-smoke="footer">Footer smoke test</div>';
    $siteUrl=config('fastai.app_url');
    config(['fastai.app_url'=>'http://unsafe.example.test']);
    $assert($call('/api/v1/'.$securePath.'/config/save',['passkey_enable'=>1,'app_url'=>'http://unsafe.example.test'],$token)->getStatusCode()===503,'Passkey rejects insecure production origin');
    config(['fastai.recaptcha_enable'=>1,'fastai.recaptcha_key'=>'retired-test-only','fastai.frontend_theme_google_analytics'=>'retired-test-only']);
    // config:cache boots a fresh container; validate with the transaction-bound user before that final save.
    $invalidPolicy=$call('/api/v1/'.$securePath.'/config/save',['browser_policy_wechat'=>'invalid'],$token);
    $assert($invalidPolicy->getStatusCode()===422,'Admin rejects invalid browser policy: '.$invalidPolicy->getStatusCode());
    $response = $call('/api/v1/' . $securePath . '/config/save', ['custom_footer_html' => $footer,'app_url'=>'https://passkey.example.test','passkey_enable'=>1,'browser_policy_wechat'=>'prompt','browser_policy_qq'=>'allow','browser_policy_weibo'=>'guide'], $token);
    $assert($response->getStatusCode() === 200, 'Footer save failed: ' . $response->getContent());
    $saved=require $configPath;
    $assert($saved['browser_policy_wechat']==='prompt' && $saved['browser_policy_qq']==='allow' && $saved['browser_policy_weibo']==='guide','Admin API persists separate browser policy choices');
    $assert(($saved['passkey_enable']??0)==1 && $saved['app_url']==='https://passkey.example.test','Administrator can enable Passkey while saving a valid new origin');
    $assert(!array_key_exists('recaptcha_enable',$saved) && !array_key_exists('recaptcha_key',$saved) && !array_key_exists('frontend_theme_google_analytics',$saved),'Saving settings removes legacy CAPTCHA and Google Analytics configuration');
    config(['fastai.app_url'=>$siteUrl]);
    $assert(config('fastai.password_limit_enable', 1) === ($originalConfig['password_limit_enable'] ?? 1), 'Partial settings update changed an unrelated switch');
    config(['fastai.custom_footer_html' => $footer]);
    $assert(strpos($call('/app')->getContent(), $footer) !== false, 'Footer was not rendered in user shell');
    $assert(strpos($call('/')->getContent(), '<title>' . e(App\Support\Branding::name(config('fastai.app_name'))) . '</title>') !== false && strpos($call('/')->getContent(), $footer) === false, 'Public landing metadata or footer isolation failed');
    $assert(strpos($call('/' . $securePath)->getContent(), $footer) === false, 'User footer leaked into admin shell');
    $assert(Illuminate\Support\Facades\Artisan::call('console:verify')===0, 'Production console assets or Laravel rendering failed');
    // The preceding real config:cache boot replaced globals; restore this fixture's transaction.
    Illuminate\Container\Container::setInstance($app);
    Illuminate\Support\Facades\Facade::setFacadeApplication($app);
    Illuminate\Support\Facades\Facade::clearResolvedInstances();
    Illuminate\Database\Eloquent\Model::setConnectionResolver($app['db']);
    Illuminate\Database\Eloquent\Model::setEventDispatcher($app['events']);
    $assert(Illuminate\Support\Facades\DB::transactionLevel()>0,'Custom settings checks must remain in the existing disposable transaction');
    $savedWithPasskey = file_get_contents($configPath);
    $invalidPasskeyOrigin = $call('/api/v1/'.$securePath.'/config/save',['app_url'=>'http://unsafe.example.test'],$token);
    $assert($invalidPasskeyOrigin->getStatusCode()===503 && file_get_contents($configPath)===$savedWithPasskey,
        'Saving only an insecure URL cannot break persisted Passkey settings');
    // Preserve the complete custom tree when only one ordinary setting is saved.
    $customFixture=sys_get_temp_dir().'/custom-settings-'.bin2hex(random_bytes(8));
    foreach (['config','storage/app','storage/framework/cache/data','storage/framework/views','storage/framework/sessions','bootstrap/cache'] as $directory) mkdir($customFixture.'/'.$directory,0700,true);
    $customSourceConfigPath=$app->configPath();
    foreach (glob($customSourceConfigPath.'/*.php') as $publicConfig) {
        if (!in_array(basename($publicConfig),['fastai.php','v2board.php'],true)) copy($publicConfig,$customFixture.'/config/'.basename($publicConfig));
    }
    $customShim="<?php\n\$app=require ".var_export(base_path('bootstrap/app.php'),true).";\n"
        ."\$app->useConfigPath(".var_export($customFixture.'/config',true).");\n"
        ."\$app->useStoragePath(".var_export($customFixture.'/storage',true).");\n"
        ."\$app->useBootstrapPath(".var_export($customFixture.'/bootstrap',true).");\nreturn \$app;\n";
    file_put_contents($customFixture.'/bootstrap/app.php',$customShim);
    $customCache=$customFixture.'/bootstrap/cache/config.php';
    $customProbe=<<<'PHP'
require 'tests/support/autoload.php';
set_exception_handler(static function(Throwable $error) { fwrite(STDERR,get_class($error).' at '.basename($error->getFile()).':'.$error->getLine()); exit(1); });
$input=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
$app=require $input['bootstrap'];
$kernel=$app->make(Illuminate\Contracts\Console\Kernel::class); $kernel->bootstrap();
if ($input['cache']) {
    $status=$kernel->call('config:cache',[],new Symfony\Component\Console\Output\NullOutput);
    echo json_encode(['cacheReady'=>$status===0 && is_file($app->getCachedConfigPath())],JSON_THROW_ON_ERROR); exit;
}
$site=config('fastai');
echo json_encode([
    'matches'=>$site===$input['expected'],
    'legacyAlias'=>config('v2board')===$site,
    'canonicalExport'=>!array_key_exists('v2board',app('config')->all()),
    'footer'=>App\Support\FrontendConfig::footer()===$input['expected']['custom_footer_html'],
    'mailSecret'=>Illuminate\Support\Facades\Crypt::decryptString(config('fastai.email_password'))==='synthetic-smtp-secret',
],JSON_THROW_ON_ERROR);
PHP;
    $customRun=function(array $expected,bool $cache) use($customFixture,$customCache,$customProbe): array {
        $environment=array_merge(getenv(),[
            'APP_CONFIG_CACHE'=>$customCache,'APP_SERVICES_CACHE'=>$customFixture.'/bootstrap/cache/services.php',
            'APP_PACKAGES_CACHE'=>$customFixture.'/bootstrap/cache/packages.php','APP_EVENTS_CACHE'=>$customFixture.'/bootstrap/cache/events.php',
            'APP_ROUTES_CACHE'=>$customFixture.'/bootstrap/cache/routes.php','FASTAI_ENTRYPOINT_SIGNING_SEED'=>'',
        ]);
        $process=proc_open([PHP_BINARY,'-r',$customProbe],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,base_path(),$environment);
        if (!is_resource($process)) throw new RuntimeException('Cannot start the custom settings fixture');
        fwrite($pipes[0],json_encode(['bootstrap'=>$customFixture.'/bootstrap/app.php','expected'=>$expected,'cache'=>$cache],JSON_THROW_ON_ERROR)); fclose($pipes[0]);
        $output=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if (proc_close($process)!==0) throw new RuntimeException('Custom settings bootstrap failed: '.$error);
        return json_decode($output,true,512,JSON_THROW_ON_ERROR);
    };
    $customOriginalSettings=config('fastai');
    $customArtisan=Illuminate\Support\Facades\Artisan::getFacadeRoot();
    $customSecret=Illuminate\Support\Facades\Crypt::encryptString('synthetic-smtp-secret');
    $customPayment=App\Models\Payment::create(['name'=>'custom-settings-payment','payment'=>'Paytaro','uuid'=>App\Utils\Helper::guid(),
        'config'=>['pid'=>'synthetic-custom-merchant','key'=>'synthetic-custom-payment-secret','options'=>['disabled'=>false,'zero'=>0]],'enable'=>0]);
    $customPaymentId=$customPayment->id;
    $customPaymentConnection=$app['db']->connection();
    $customPaymentBefore=$customPaymentConnection->table('v2_payment')->where('id',$customPaymentId)->value('config');
    $assert(is_string($customPaymentBefore),'The dedicated payment fixture must exist on the original transaction connection');
    $customBase=[
        'app_name'=>'Custom owner brand','app_description'=>'Original custom description',
        'app_url'=>'https://owner.example.test','subscribe_url'=>'https://subscriptions.owner.example.test','subscribe_path'=>'/owner-subscription',
        'server_api_url'=>'https://nodes.owner.example.test','secure_path'=>$securePath,'ops_api_path'=>$opsPath,
        'custom_footer_html'=>'<p>Owner footer &amp; custom content</p>',
        'email_provider'=>'smtp','email_host'=>'smtp.owner.example.test','email_port'=>587,'email_username'=>'synthetic-mail-user',
        'email_password'=>$customSecret,'email_password_encrypted'=>true,'email_encryption'=>'tls','email_from_address'=>'owner@example.test',
        'email_announcement_separate'=>0,'email_announcements_enabled'=>0,'new_user_currency'=>'CNY',
        'stop_register'=>0,'force_https'=>0,'plan_change_enable'=>0,'email_verify'=>0,
        'system_timezone'=>'UTC','show_subscribe_method'=>0,'show_subscribe_expire'=>5,'allow_new_period'=>1,
        'payment_extension'=>['merchant_key'=>'synthetic-payment-secret'],
        'unknown_null'=>null,'unknown_false'=>false,'unknown_zero'=>0,'unknown_empty'=>[],
        'unknown_extension'=>['null'=>null,'false'=>false,'zero'=>0,'empty'=>[],'nested'=>['values'=>[null,false,0,[]]]],
    ];
    try {
        foreach (['legacy-only','canonical-only','both'] as $layout) {
            foreach (['fastai.php','v2board.php'] as $file) if (is_file($customFixture.'/config/'.$file)) unlink($customFixture.'/config/'.$file);
            if (is_file($customCache)) unlink($customCache);
            $legacyCustom=$customBase; $legacyCustom['app_name']='Legacy custom owner'; $legacyCustom['legacy_only_key']='must-not-be-merged';
            $canonicalCustom=$customBase; $canonicalCustom['app_name']='Canonical custom owner'; $canonicalCustom['app_url']='https://canonical.owner.example.test';
            if ($layout!=='canonical-only') { file_put_contents($customFixture.'/config/v2board.php','<?php return '.var_export($legacyCustom,true).';'); chmod($customFixture.'/config/v2board.php',0600); }
            if ($layout!=='legacy-only') { file_put_contents($customFixture.'/config/fastai.php','<?php return '.var_export($canonicalCustom,true).';'); chmod($customFixture.'/config/fastai.php',0600); }
            $expectedCustom=$layout==='legacy-only' ? $legacyCustom : $canonicalCustom;
            $legacyCustomHash=is_file($customFixture.'/config/v2board.php') ? hash_file('sha256',$customFixture.'/config/v2board.php') : null;
            $assert($customRun($expectedCustom,true)['cacheReady']===true,'Custom settings cache preparation failed: '.$layout);
            foreach ($customRun($expectedCustom,false) as $boundary=>$valid) $assert($valid===true,'Custom settings initial bootstrap failed '.$layout.': '.$boundary);
            $compiledCustom=require $customCache;
            config(['fastai'=>$compiledCustom['fastai']]);
            $app->useConfigPath($customFixture.'/config');
            try {
                // Assert the controller requests cache rebuilding, then run it in a real fresh process.
                Illuminate\Support\Facades\Artisan::partialMock()->shouldReceive('call')->once()->with('config:cache')->andReturn(0);
                $customResponse=$call('/api/v1/'.$securePath.'/config/save',['app_description'=>'Changed description '.$layout,'email_password'=>'','allow_new_period'=>1],$token);
            } finally {
                Illuminate\Support\Facades\Artisan::swap($customArtisan);
                $app->useConfigPath($customSourceConfigPath);
            }
            $assert($customResponse->getStatusCode()===200,'Partial custom settings save failed: '.$layout);
            unset($expectedCustom['allow_new_period']);
            $expectedCustom['app_description']='Changed description '.$layout;
            $persistedCustom=require $customFixture.'/config/fastai.php';
            $assert(!array_key_exists('allow_new_period',$persistedCustom),'A legacy payload cannot save the retired traffic period advance setting: '.$layout);
            $assert($persistedCustom===$expectedCustom,'Partial save changed an unrelated custom setting: '.$layout);
            clearstatcache(true,$customFixture.'/config/fastai.php');
            $assert((fileperms($customFixture.'/config/fastai.php')&0777)===0600,'Custom settings save changed private permissions: '.$layout);
            $currentCustomPayment=App\Models\Payment::find($customPaymentId);
            $assert($currentCustomPayment!==null,'Site settings save removed the dedicated payment fixture: '.$layout);
            $assert($currentCustomPayment->getRawOriginal('config')===$customPaymentBefore
                && $customPaymentConnection->table('v2_payment')->where('id',$customPaymentId)->value('config')===$customPaymentBefore,
                'Site settings save changed payment-channel credentials: '.$layout);
            $assert($legacyCustomHash===null || hash_file('sha256',$customFixture.'/config/v2board.php')===$legacyCustomHash,'Site settings save changed the legacy file: '.$layout);
            $assert($customRun($expectedCustom,true)['cacheReady']===true,'Saved custom settings could not rebuild the real cache: '.$layout);
            foreach ($customRun($expectedCustom,false) as $boundary=>$valid) $assert($valid===true,'Saved custom settings fresh bootstrap failed '.$layout.': '.$boundary);
        }
    } finally {
        Illuminate\Support\Facades\Artisan::swap($customArtisan);
        $app->useConfigPath($customSourceConfigPath);
        config(['fastai'=>$customOriginalSettings]);
        (new Illuminate\Filesystem\Filesystem)->deleteDirectory($customFixture);
    }
    echo "Console smoke tests: {$checks} checks passed\n";
} catch (Throwable $error) {
    $failure = $error;
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    if ($originalFile===null) { if (is_file($configPath)) unlink($configPath); }
    else file_put_contents($configPath, $originalFile);
    config(['fastai' => $originalConfig]);
    Illuminate\Support\Facades\Artisan::call('config:cache');
}
if ($failure) { fwrite(STDERR, $failure->getMessage() . "\n"); exit(1); }
