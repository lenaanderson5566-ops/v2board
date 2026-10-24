<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
$jar=['user'=>[],'admin'=>[]];$csrf=[];$keys=[];$auth=null;$registrationUsers=[];
$testIp='192.0.2.'.random_int(2,254);
$original=config('v2board.app_url');
$call=function($path,$body=[],$scope='user',$method='GET',$csrfOverride=null,$origin='https://fastdog.ws',$bearer=null) use ($app,&$jar,&$csrf,&$keys,$testIp) {
    $request=Illuminate\Http\Request::create('https://fastdog.ws/api/'.$path,$method,$body,$scope?$jar[$scope]:[],[],['REMOTE_ADDR'=>$testIp]);
    $request->headers->set('Accept','application/json');
    if ($scope) {
        $request->headers->set('X-Browser-Client',$scope);
        if ($csrfOverride !== false && ($csrfOverride || isset($csrf[$scope]))) $request->headers->set('X-CSRF-Token',$csrfOverride ?: $csrf[$scope]);
    }
    if ($origin) $request->headers->set('Origin',$origin);
    if ($bearer) $request->headers->set('Authorization','Bearer '.$bearer);
    $app->instance('request',$request);
    $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    foreach ($response->headers->getCookies() as $cookie) { if ($scope) { $jar[$scope][$cookie->getName()]=$cookie->getValue();$keys[]='BROWSER_SESSION:'.$scope.':'.hash('sha256',$cookie->getValue()); } }
    if ($scope && $response->headers->has('X-CSRF-Token')) $csrf[$scope]=$response->headers->get('X-CSRF-Token');
    return $response;
};
$data=fn($r)=>json_decode($r->getContent(),true)['data']??[];
Illuminate\Support\Facades\DB::beginTransaction();
try {
    config(['v2board.app_url'=>'https://fastdog.ws']);
    $email='cookie-'.bin2hex(random_bytes(5)).'@example.com';
    $user=App\Models\User::create(['email'=>$email,'password'=>password_hash('Testing!2026',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>1]);
    $auth=new App\Services\AuthService($user);
    $bootstrap=$call('v10/auth/browser-session');
    $assert($bootstrap->getStatusCode()===200 && !$data($bootstrap)['authenticated'],'Anonymous bootstrap');
    $cookie=$bootstrap->headers->getCookies()[0];
    $assert($cookie->isHttpOnly() && $cookie->getSameSite()==='lax' && $cookie->getDomain()===null,'Host-only HttpOnly SameSite cookie');
    $assert(!$bootstrap->headers->has('Access-Control-Allow-Origin') || $bootstrap->headers->get('Access-Control-Allow-Origin')==='https://fastdog.ws','Canonical CORS');
    $old=$jar['user'];
    $body=['email'=>$email,'password'=>'Testing!2026'];
    $assert($call('v10/auth/sessions',$body,'user','POST',false)->getStatusCode()===419,'Login CSRF rejected');
    $assert($call('v10/auth/sessions',$body,'user','POST',null,'https://evil.example')->getStatusCode()===419,'Untrusted Origin rejected');
    $login=$call('v10/auth/sessions',$body,'user','POST');
    $assert($login->getStatusCode()===200 && $data($login)['authenticated'],'Browser login');
    $assert(!isset($data($login)['accessToken'],$data($login)['auth_data']) && !str_contains($login->getContent(),$user->token),'No browser token in body');
    $assert($jar['user']!==$old,'Cookie rotated on login');
    $assert($call('v10/me')->getStatusCode()===200,'Cookie authorizes user');
    foreach (['plans','payment-methods','credit-packages','announcements','knowledge-categories'] as $resource) {
        $assert($call('v10/'.$resource)->getStatusCode()===200,'Cookie authorizes renewal/support resource '.$resource);
        $assert($call('v10/'.$resource,[],null)->getStatusCode()===401,'Renewal/support resource still requires authentication '.$resource);
    }
    $assert(!$call('v10/me')->headers->getCookies(),'Regular reads never overwrite a newly rotated login Cookie');
    $assert($call('v10/me',['auth_data'=>'evil'])->getStatusCode()===200,'Query credential cannot override Cookie');
    $assert($call('v10/me',[],null)->getStatusCode()===401,'Native requires Bearer');
    $assert($call('v10/me/preferences',['language'=>'en-US'],'user','PATCH',false)->getStatusCode()===419,'Cookie mutation requires CSRF');
    foreach ([null,'null','https://fastdog.ws.evil.example','https://fastdog.ws:444'] as $origin) $assert($call('v10/me/preferences',['language'=>'en-US'],'user','PATCH',null,$origin)->getStatusCode()===419,'Mutations require the exact trusted Origin');
    $native=$call('v10/auth/sessions',$body,null,'POST');
    $assert($native->getStatusCode()===200 && isset($data($native)['accessToken']),'App keeps Bearer login');
    $token=$data($native)['accessToken'];
    $assert($call('v10/me',[],null,'GET',null,null,$token)->getStatusCode()===200,'App Bearer remains usable');
    // Check the complete generated inventory at the authentication boundary without running mutations.
    $entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
    $middleware=app(App\Http\Middleware\BrowserSession::class);
    foreach ($entries as $entry) {
        $path='api/v10/'.preg_replace('/\{[^}]+\}/','test-resource',$entry['path']);
        $excluded=str_starts_with($path,'api/v10/public/') || str_starts_with($path,'api/v10/subscriptions/') || str_starts_with($path,'api/v10/webhooks/');
        $request=Illuminate\Http\Request::create('https://fastdog.ws/'.$path,$entry['method'],['auth_data'=>'injected'],$jar['user']);
        $request->headers->set('X-Browser-Client','user');
        $request->headers->set('Origin','https://fastdog.ws');
        $request->headers->set('X-CSRF-Token',$csrf['user']);
        $request->headers->set('Authorization','Bearer '.$token);
        $reached=false;
        $result=$middleware->handle($request,function($request) use (&$reached,$assert,$excluded,$path,$token) {
            $reached=true;
            $assert($request->attributes->has('browser.session')===!$excluded,'Cookie boundary '.$path);
            if (!$excluded) {
                $assert($request->input('auth_data')===null,'Strip supplied credential '.$path);
                $record=$request->attributes->get('browser.session');
                $assert($record['credential']!==$token && $request->bearerToken()===$record['credential'],'Cookie wins over Bearer '.$path);
            } else $assert($request->bearerToken()===$token,'Native protocol untouched '.$path);
            return response('',204);
        });
        $assert($reached && $result->getStatusCode()===204,'Inventory request reaches action '.$path);
        if (!in_array($entry['method'],['GET','HEAD','OPTIONS'],true) && !$excluded) {
            $request->headers->remove('X-CSRF-Token');
            $reached=false;
            $denied=$middleware->handle($request,function() use (&$reached) { $reached=true; return response('',204); });
            $assert(!$reached && $denied->getStatusCode()===419,'Every browser mutation requires CSRF '.$path);
            $assert(str_contains($denied->headers->get('Cache-Control'),'no-store'),'CSRF errors cannot be cached '.$path);
        }
    }
    foreach (['plans/test-resource','knowledge-articles/test-resource','announcements/test-resource','payment-methods/test-resource/public-key'] as $resource) {
        $error=$call('v10/'.$resource);
        $assert($error->getStatusCode()!==401,'Detail resources accept Cookie '.$resource);
        $assert(str_contains($error->headers->get('Cache-Control'),'no-store'),'Authenticated detail errors cannot be cached '.$resource);
    }
    $preflight=$call('v1/test',[],'user','OPTIONS');
    $allowedHeaders=strtolower($preflight->headers->get('Access-Control-Allow-Headers'));
    foreach (['content-language','accept-language','x-browser-client','x-csrf-token'] as $header) $assert(str_contains($allowedHeaders,$header),'Admin CORS header '.$header);

    $call('v10/auth/browser-session',[],'admin');
    $admin=$call('v1/passport/auth/login',$body,'admin','POST');
    $assert($admin->getStatusCode()===200 && $data($admin)['authenticated'] && !isset($data($admin)['auth_data']),'Admin login uses Cookie');
    $assert($call('v1/user/info',[],'admin')->getStatusCode()===200,'Retained admin account reads use scoped Cookie');
    $assert($jar['admin']!==$jar['user'],'Admin/user Cookies isolated');
    $path=config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
    $assert($call('v1/'.$path.'/config/fetch',[],'user')->getStatusCode()===403,'User-scoped Cookie cannot authorize administrative routes');
    $adminDenied=$call('v1/'.$path.'/config/fetch',[],'user');
    $assert(str_contains($adminDenied->headers->get('Cache-Control'),'no-store'),'Legacy admin authentication errors cannot be cached');
    $assert($call('v1/'.$path.'/config/fetch',[],'admin')->getStatusCode()===200,'Admin-scoped Cookie authorizes administrative routes');
    $line=App\Models\ServerV2box::create(['up_mbps'=>0,'down_mbps'=>0,'name'=>'Line auth test','group_id'=>[],'host'=>'auth.example.test','port'=>'443','server_port'=>443,'protocol'=>'vless','tls'=>0,'network'=>'tcp','rate'=>1]);
    $linePath='v1/'.$path.'/server/connections/default';
    $lineState=$data($call($linePath,['type'=>'v2box','id'=>$line->id],'admin'));
    $lineEdit=['type'=>'v2box','id'=>$line->id,'revision'=>$lineState['revision'],'name'=>'Business only','group_id'=>[],'rate'=>2];
    $assert($call($linePath,$lineEdit,'admin','PATCH',false)->getStatusCode()===419,'Default line PATCH requires CSRF');
    $assert($call($linePath,$lineEdit,'user','PATCH')->getStatusCode()===403,'User session cannot modify default line');
    $assert($call($linePath,$lineEdit,'admin','PATCH',null,'https://evil.example')->getStatusCode()===419,'Default line PATCH requires trusted Origin');
    $assert($call($linePath,$lineEdit+['protocol'=>'trojan'],'admin','PATCH')->getStatusCode()===422,'Default line PATCH rejects service settings');
    $assert($call($linePath,$lineEdit,'admin','PATCH')->getStatusCode()===200,'Admin cookie authorizes scoped PATCH');
    $assert($line->fresh()->name==='Business only' && $line->fresh()->protocol==='vless' && (int)$line->fresh()->server_port===443,'Scoped PATCH does not mutate service identity');
    $assert($call($linePath,$lineEdit,'admin','PATCH')->getStatusCode()===409,'Default line stale revision rejected through router');
    $user->update(['is_admin'=>0]);
    $assert($call('v1/'.$path.'/config/fetch',[],'admin')->getStatusCode()===403,'Admin permission is rechecked against current account');
    $rejectedAdmin=$call('v1/passport/auth/login',$body,'admin','POST');
    $assert($rejectedAdmin->getStatusCode()===403 && str_contains($rejectedAdmin->headers->get('Cache-Control'),'no-store'),'Rejected administrator login cannot be cached or grant a Cookie');
    $user->update(['is_admin'=>1]);
    $verifier=str_repeat('a',43);
    $challenge=rtrim(strtr(base64_encode(hash('sha256',$verifier,true)),'+/','-_'),'=');
    $started=$call('v10/auth/client-authorizations',['codeChallenge'=>$challenge,'state'=>str_repeat('s',43),'redirectUri'=>'http://127.0.0.1:48321/fastai-auth/callback','platform'=>'windows'],null,'POST');
    $id=$data($started)['authorizationId'];
    $approval=$call('v10/me/client-authorizations/'.$id.'/approval',[],'user','POST');
    parse_str(parse_url($data($approval)['callbackUrl'],PHP_URL_QUERY),$approved);
    $appSession=$call('v10/auth/client-session-exchanges',['authorizationCode'=>$approved['code'],'codeVerifier'=>$verifier,'redirectUri'=>'http://127.0.0.1:48321/fastai-auth/callback'],null,'POST');
    $assert($appSession->getStatusCode()===200 && isset($data($appSession)['accessToken']),'Cookie browser authorizes independent App PKCE session');

    $link=$call('v10/me/login-links',['redirect'=>'dashboard'],null,'POST',null,null,$token);
    parse_str(explode('?',parse_url($data($link),PHP_URL_FRAGMENT),2)[1],$query);
    $web=$call('v10/auth/session-exchanges',['verificationToken'=>$query['verify']],'user','POST');
    $assert($web->getStatusCode()===200 && $data($web)['authenticated'] && !isset($data($web)['accessToken']),'App-to-browser exchange sets Cookie');
    $assert($call('v10/auth/browser-session',[],'user','DELETE')->getStatusCode()===204,'Cookie logout');
    $assert($call('v10/me')->getStatusCode()===401,'Cookie logout revokes user session');
    $assert($call('v10/me',[],'user','GET',null,null,$token)->getStatusCode()===401,'Anonymous browser cannot authenticate using a supplied native Bearer');
    $assert($call('v10/me',[],null,'GET',null,null,$token)->getStatusCode()===200,'Cookie logout preserves App');
    $assert($call('v1/user/info',[],'admin')->getStatusCode()===200,'Cookie logout preserves admin scope');
    $legacy=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $before=$jar['user'];
    $upgrade=$call('v10/auth/browser-session',['legacyToken'=>$legacy],'user','POST');
    $assert($upgrade->getStatusCode()===405,'Retired token migration has no POST route');
    $assert($jar['user']===$before && !$data($call('v10/auth/browser-session'))['authenticated'],'Retired migration cannot authenticate a browser');
    $assert(App\Services\AuthService::decryptAuthData($legacy)!==false,'Retired migration does not mutate the supplied native session');
    $evil=$call('v10/auth/browser-session',[],'user','GET',null,'https://evil.example');
    $assert(!$evil->headers->has('Access-Control-Allow-Origin') && !$evil->headers->has('Access-Control-Allow-Credentials'),'CORS denies arbitrary credentialed origins');
    $auth->removeAllSession();
    $assert($call('v1/user/info',[],'admin')->getStatusCode()===403,'Account-wide revocation affects Cookies');
    $assert($call('v10/me',[],null,'GET',null,null,$token)->getStatusCode()===401,'Account-wide revocation affects App');
    $secure=config('browser.secure');
    try {
        config(['browser.secure'=>true]);
        $secureResponse=$call('v10/auth/browser-session');
        $secureCookie=$secureResponse->headers->getCookies()[0];
        $assert($secureCookie->isSecure() && str_starts_with($secureCookie->getName(),'__Host-') && $secureCookie->getPath()==='/' && $secureCookie->isHttpOnly(),'Production cookie attributes');
    } finally { config(['browser.secure'=>$secure]); }
    // Registration must follow the same HttpOnly grant boundary as password login.
    Illuminate\Support\Facades\Queue::fake();
    config(['v2board.stop_register'=>0,'v2board.invite_force'=>0,'v2board.email_verify'=>0,'v2board.email_whitelist_enable'=>0,'v2board.email_gmail_limit_enable'=>0,'v2board.register_limit_by_ip_enable'=>0,'v2board.try_out_plan_id'=>0]);
    $call('v10/auth/browser-session');
    $beforeSignup=$jar['user'];
    $signupEmail='browser-signup-'.bin2hex(random_bytes(6)).'@example.com';
    $signupBody=['email'=>$signupEmail,'password'=>'Browser-signup-123'];
    $assert($call('v10/auth/registrations',$signupBody,'user','POST',false)->getStatusCode()===419,'Browser registration requires CSRF');
    $assert($call('v10/auth/registrations',$signupBody,'user','POST',null,'https://evil.example')->getStatusCode()===419,'Browser registration requires trusted Origin');
    $signup=$call('v10/auth/registrations',$signupBody,'user','POST');
    $registered=App\Models\User::where('email',$signupEmail)->firstOrFail();$registrationUsers[]=$registered;
    $assert($signup->getStatusCode()===201 && ($data($signup)['authenticated']??false) && ($data($signup)['accountId']??null)===$registered->id,'Browser registration issues a scoped session');
    $assert(!array_intersect(['accessToken','auth_data','token','password'],array_keys($data($signup))) && !str_contains($signup->getContent(),$registered->token),'Browser registration body contains no native credentials');
    $assert($jar['user']!==$beforeSignup && $signup->headers->getCookies()[0]->isHttpOnly(),'Registration rotates an HttpOnly cookie');
    $assert(($data($call('v10/me'))['id']??null)===$registered->id,'Registration cookie authenticates the new account');
    $nativeEmail='native-signup-'.bin2hex(random_bytes(6)).'@example.com';
    $nativeSignup=$call('v10/auth/registrations',['email'=>$nativeEmail,'password'=>'Native-signup-123'],null,'POST');
    $registrationUsers[]=App\Models\User::where('email',$nativeEmail)->firstOrFail();
    $assert($nativeSignup->getStatusCode()===201 && isset($data($nativeSignup)['accessToken']) && App\Services\AuthService::decryptAuthData($data($nativeSignup)['accessToken']),'Native registration retains valid Bearer credentials');
    echo "Browser sessions: $checks checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    foreach ($registrationUsers as $registered) (new App\Services\AuthService($registered))->removeAllSession();
    foreach ($keys as $key) Illuminate\Support\Facades\Cache::forget($key);
    Illuminate\Support\Facades\DB::rollBack(); config(['v2board.app_url'=>$original]);
}
