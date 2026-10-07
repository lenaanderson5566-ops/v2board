<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$call=function($path,$body=[],$token=null,$method='POST') use ($app) {
    $request=Illuminate\Http\Request::create('/api/v10/'.$path,$method,$body);
    $request->headers->set('Accept','application/json');
    if ($token) $request->headers->set('Authorization','Bearer '.$token);
    $app->instance('request',$request);
    return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
};
$data=fn($response)=>json_decode($response->getContent(),true)['data'] ?? [];
$verifier=str_repeat('a',43);
$challenge=rtrim(strtr(base64_encode(hash('sha256',$verifier,true)),'+/','-_'),'=');
$body=['codeChallenge'=>$challenge,'state'=>str_repeat('s',43),'redirectUri'=>'http://127.0.0.1:48321/fastai-auth/callback','platform'=>'windows'];
$original=config('v2board.app_url'); $sessions=[]; $user=null;
Illuminate\Support\Facades\DB::beginTransaction();
try {
    config(['v2board.app_url'=>'https://fastdog.ws']);
    $user=new App\Models\User(); $user->email='browser-auth-'.bin2hex(random_bytes(4)).'@example.com';
    $user->password=password_hash('Testing!2026',PASSWORD_DEFAULT); $user->token=bin2hex(random_bytes(16)); $user->uuid=Illuminate\Support\Str::uuid(); $user->save();
    $browser=(new App\Services\AuthService($user))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']; $sessions[]=$browser;
    $start=$call('auth/client-authorizations',$body); $assert($start->getStatusCode()===201,'Start returns 201');
    $d=$data($start); $id=$d['authorizationId'];
    $assert(str_contains($d['authorizationUrl'],'/app#/client-authorize?authorizationId='.$id),'Fixed browser URL');
    $assert(isset($d['expiresAt']) && !isset($d['codeChallenge']),'Public request projection');
    $assert($call('me/client-authorizations/'.$id,[],null,'GET')->getStatusCode()===401,'Approval requires browser session');
    $detail=$call('me/client-authorizations/'.$id,[],$browser,'GET');
    $assert($detail->getStatusCode()===200 && $data($detail)['platform']==='windows','Authenticated details');
    $assert(!isset($data($detail)['redirectUri']),'No callback credential in details');
    $approve=$call('me/client-authorizations/'.$id.'/approval',[],$browser); $assert($approve->getStatusCode()===200,'Explicit consent');
    parse_str(parse_url($data($approve)['callbackUrl'],PHP_URL_QUERY),$query);
    $assert($query['state']===$body['state'],'State round trip');
    $assert($call('me/client-authorizations/'.$id.'/approval',[],$browser)->getStatusCode()===410,'Request approval only once');
    $exchange=['authorizationCode'=>$query['code'],'codeVerifier'=>$verifier,'redirectUri'=>$body['redirectUri']];
    $assert($call('auth/client-session-exchanges',array_replace($exchange,['codeVerifier'=>str_repeat('b',43)]))->getStatusCode()===403,'PKCE mismatch rejected');
    $assert($call('auth/client-session-exchanges',array_replace($exchange,['redirectUri'=>'http://127.0.0.1:48322/fastai-auth/callback']))->getStatusCode()===403,'Redirect mismatch rejected');
    $result=$call('auth/client-session-exchanges',$exchange);$assert($result->getStatusCode()===200,'Valid exchange');
    $token=$data($result)['accessToken']; $sessions[]=$token;
    $assert($token!==$browser && $data($result)['tokenType']==='Bearer','Independent app session');
    $assert($call('me',[],$token,'GET')->getStatusCode()===200,'App session usable');
    $assert($call('auth/client-session-exchanges',$exchange)->getStatusCode()===410,'Code consumed once');
    foreach (['https://evil.example/callback','http://localhost:48321/fastai-auth/callback','http://127.0.0.1:80/fastai-auth/callback','ws.fastdog.fastai://import/profile'] as $uri) {
        $assert($call('auth/client-authorizations',array_replace($body,['redirectUri'=>$uri]))->getStatusCode()===422,'Untrusted callback rejected');
    }
    $assert($call('auth/client-authorizations',array_replace($body,['codeChallenge'=>'plain']))->getStatusCode()===422,'S256 mandatory');
    $mobile=$call('auth/client-authorizations',array_replace($body,['platform'=>'android','redirectUri'=>'ws.fastdog.fastai://oauth/callback'])); $assert($mobile->getStatusCode()===201,'Scoped Android callback');
    $id=$data($mobile)['authorizationId'];
    Illuminate\Support\Facades\Cache::forget('FASTAI_AUTH:request:'.hash('sha256',$id));
    $assert($call('me/client-authorizations/'.$id,[],$browser,'GET')->getStatusCode()===410,'Expired request rejected');
    $id=$data($call('auth/client-authorizations',$body))['authorizationId'];
    parse_str(parse_url($data($call('me/client-authorizations/'.$id.'/approval',[],$browser))['callbackUrl'],PHP_URL_QUERY),$query);
    (new App\Services\AuthService($user))->removeCurrentSession($browser);
    $assert($call('auth/client-session-exchanges',array_replace($exchange,['authorizationCode'=>$query['code']]))->getStatusCode()===403,'Revoked browser session cannot authorize app');
    $assert($call('me',[],$token,'GET')->getStatusCode()===200,'Already authorized App survives browser logout');
} finally {
    if ($user) (new App\Services\AuthService($user))->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack(); config(['v2board.app_url'=>$original]);
}
echo "FastAI browser login: $checks checks passed\n";
