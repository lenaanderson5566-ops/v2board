<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use App\Models\User;
use App\Services\{Totp,AuthService};
use Illuminate\Support\Facades\{DB,Cache,Crypt};
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
$jar=['user'=>[],'admin'=>[]];$csrf=[];
$call=function($path,$body=[],$scope='user',$method='GET',$sendCsrf=true,$origin='https://mfa.example.test')use($app,&$jar,&$csrf){
    $request=Illuminate\Http\Request::create('https://mfa.example.test/api/'.$path,$method,$body,$jar[$scope],[],['REMOTE_ADDR'=>'192.0.2.52','HTTP_USER_AGENT'=>'MfaBrowserContracts']);
    $request->headers->set('Accept','application/json');$request->headers->set('X-Browser-Client',$scope);$request->headers->set('Origin',$origin);
    if($sendCsrf && isset($csrf[$scope]))$request->headers->set('X-CSRF-Token',$csrf[$scope]);
    $app->instance('request',$request);$response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    foreach($response->headers->getCookies() as $cookie)$jar[$scope][$cookie->getName()]=$cookie->getValue();
    if($response->headers->has('X-CSRF-Token'))$csrf[$scope]=$response->headers->get('X-CSRF-Token');
    return [$response,json_decode($response->getContent(),true)];
};
DB::beginTransaction();
try {
 config(['v2board.app_url'=>'https://mfa.example.test','v2board.recaptcha_enable'=>0]);
 foreach(['user','admin'] as $scope){
  Cache::flush();$jar[$scope]=[];unset($csrf[$scope]);
  $user=User::create(['email'=>'browser-mfa-'.$scope.'@example.test','password'=>password_hash('BrowserMfa!2026',PASSWORD_DEFAULT),'token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'is_admin'=>$scope==='admin','transfer_enable'=>0]);
  $secret=Totp::secret();$recovery='AAAA-BBBB-CCCC-DDDD';
  DB::table('v2_user_mfa')->insert(['user_id'=>$user->id,'totp_secret'=>Crypt::encryptString($secret),'recovery_hashes'=>json_encode([hash('sha256',str_replace('-','',$recovery))]),'version'=>1]);
  [$response,$body]=$call('v10/auth/browser-session',[],$scope);$assert($response->getStatusCode()===200 && !$body['data']['authenticated'],'Anonymous cookie');
  $loginPath=$scope==='user'?'v10/auth/sessions':'v1/passport/auth/login';
  [$response,$body]=$call($loginPath,['email'=>$user->email,'password'=>'BrowserMfa!2026'],$scope,'POST');
  $assert($response->getStatusCode()===200 && $body['data']['mfaRequired'] && $body['data']['preferredMethod']==='totp','Browser password step challenges MFA');
  $assert(!isset($body['data']['accessToken']) && !isset($body['data']['auth_data']) && !isset($body['data']['authenticated']),'No premature browser grant');
  $challenge=$body['data']['challengeId'];
  [$response,$body]=$call('v10/me',[],$scope);$assert($response->getStatusCode()===401,'Password alone has no access');
  $finishPath=$scope==='user'?'v10/auth/mfa/verifications':'v1/passport/mfa/verifications';
  $proof=['challengeId'=>$challenge,'verificationMethod'=>'recovery','verificationCode'=>$recovery];
  [$response,$body]=$call($finishPath,$proof,$scope,'POST',false);$assert($response->getStatusCode()===419,'MFA requires CSRF');
  [$response,$body]=$call($finishPath,$proof,$scope,'POST',true,'https://evil.example');$assert($response->getStatusCode()===419,'MFA rejects foreign Origin');
  if($scope==='user'){[$response,$body]=$call('v1/passport/mfa/verifications',$proof,$scope,'POST');$assert($response->getStatusCode()===403,'Retained administrator MFA route does not serve ordinary users');}
  [$response,$body]=$call($finishPath,$proof,$scope,'POST');
  $assert($response->getStatusCode()===200 && $body['data']['authenticated'] && $body['data']['accountId']===$user->id,'MFA rotates authenticated browser cookie');
  $assert(!isset($body['data']['accessToken']) && !isset($body['data']['auth_data']),'No browser bearer disclosure');
  $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'Private MFA no-store');
  $statePath=$scope==='user'?'v10/me/security/mfa':'v1/'.config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key')))).'/security/mfa';
  [$response,$body]=$call($statePath,[],$scope);$assert($response->getStatusCode()===200 && $body['data']['totpEnabled'],'Both scopes read security state');
  $assert(array_keys($body['data'])===['emailEnabled','totpEnabled','recoveryCodesRemaining'],'State never discloses secrets');
  // A stolen challenge alone cannot switch the logged-in browser to another account.
  [$response,$body]=$call($finishPath,$proof,$scope,'POST');$assert($response->getStatusCode()===409,'Completed challenge cannot replay');
 }
 echo "MFA browser API: $checks checks passed; transaction rolled back.\n";
}finally{DB::rollBack();Cache::flush();}
