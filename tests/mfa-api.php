<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function(Throwable $error){fwrite(STDERR,$error->getMessage()."\n");exit(1);});
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use App\Models\User;
use App\Services\{Totp,AuthService};
use Illuminate\Support\Facades\{DB,Cache,Crypt};
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
$assert(Illuminate\Support\Facades\Schema::hasTable('v2_passkey') && DB::table('v2_passkey')->count()===0,'Fresh installation has empty Passkey table');
$columns=Illuminate\Support\Facades\Schema::getColumnListing('v2_passkey');
Illuminate\Support\Facades\Schema::drop('v2_passkey');
$migration=require database_path('migrations/2026_10_19_000002_create_passkeys.php');$migration->up();$migration->up();
$assert(Illuminate\Support\Facades\Schema::getColumnListing('v2_passkey')===$columns,'Upgrade creates the same schema and is idempotent');
$jar=['user'=>[],'admin'=>[]];$csrf=[];
$call=function($path,$body=[],$scope='user',$method='GET',$sendCsrf=true,$origin='https://mfa.example.test')use($app,&$jar,&$csrf){
    $json=str_contains($path,'passkeys') && $method!=='GET';
    $request=Illuminate\Http\Request::create('https://mfa.example.test/api/'.$path,$method,$json?[]:$body,$jar[$scope],[],['REMOTE_ADDR'=>'192.0.2.52','HTTP_USER_AGENT'=>'MfaBrowserContracts'], $json?json_encode((object)$body):null);
    if($json)$request->headers->set('Content-Type','application/json');
    $request->headers->set('Accept','application/json');$request->headers->set('X-Browser-Client',$scope);$request->headers->set('Origin',$origin);
    if($sendCsrf && isset($csrf[$scope]))$request->headers->set('X-CSRF-Token',$csrf[$scope]);
    $app->instance('request',$request);$response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    foreach($response->headers->getCookies() as $cookie)$jar[$scope][$cookie->getName()]=$cookie->getValue();
    if($response->headers->has('X-CSRF-Token'))$csrf[$scope]=$response->headers->get('X-CSRF-Token');
    return [$response,json_decode($response->getContent(),true)];
};
DB::beginTransaction();
try {
 config(['v2board.app_url'=>'https://mfa.example.test','v2board.passkey_enable'=>1,'browser.legacy_exchange_until'=>'2099-01-01T00:00:00Z']);
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
  $record=app(App\Services\BrowserSession::class)->load(Illuminate\Http\Request::create('/','GET',[],$jar[$scope]),$scope);
  [$response,$body]=$call('v10/auth/browser-session',['legacyToken'=>$record['credential']],$scope,'POST');
  $assert($response->getStatusCode()===200 && $body['data']['authenticated'],'Validated MFA session can migrate without losing MFA assurance');
  // A stolen challenge alone cannot switch the logged-in browser to another account.
  [$response,$body]=$call($finishPath,$proof,$scope,'POST');$assert($response->getStatusCode()===409,'Completed challenge cannot replay');
 }
 // Real ES256 ceremonies through the router, scoped cookies, CSRF and authentication middleware.
 $encode=[App\Services\PasskeyService::class,'encode'];
 $bytes=fn($v)=>strlen($v)<24?chr(0x40+strlen($v)).$v:(strlen($v)<256?"\x58".chr(strlen($v)).$v:"\x59".pack('n',strlen($v)).$v);
 foreach(['user','admin'] as $scope){
  Cache::flush();$jar[$scope]=[];unset($csrf[$scope]);
  $password='PasskeyBrowser!2026';
  $user=User::create(['email'=>'browser-passkey-'.$scope.'@example.test','password'=>password_hash($password,PASSWORD_DEFAULT),'token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'is_admin'=>$scope==='admin','transfer_enable'=>0]);
  $fresh=function()use($call,$user,$password,$scope){$call('v10/auth/browser-session',[],$scope);return $call($scope==='admin'?'v1/passport/auth/login':'v10/auth/sessions',['email'=>$user->email,'password'=>$password],$scope,'POST');};
  [$response]=$fresh();$assert($response->getStatusCode()===200,'Fresh password sign-in');
  $sessionKey=App\Utils\CacheKey::get('USER_SESSIONS',$user->id);$sessions=Cache::get($sessionKey);$stale=$sessions;foreach($stale as &$session)$session['authenticated_at']=time()-301;unset($session);Cache::put($sessionKey,$stale);
  [$response]=$call('v10/me/security/passkeys/registration-options',['password'=>$password,'name'=>'Stale'],$scope,'POST');$assert($response->getStatusCode()===409,'Binding requires recent complete sign-in');
  $source=array_values($sessions)[0]['auth_data'];$code=app(App\Services\SessionAuthorizationCode::class)->issue(App\Services\SessionAuthorizationCode::BROWSER,$source);
  [$response]=$call('v10/auth/session-exchanges',['verificationToken'=>$code],$scope,'POST');$assert($response->getStatusCode()===200,'Old browser session can exchange normally');
  [$response]=$call('v10/me/security/passkeys/registration-options',['password'=>$password,'name'=>'Exchanged'],$scope,'POST');$assert($response->getStatusCode()===409,'Session exchange cannot refresh Passkey management assurance');
  [$response]=$fresh();$assert($response->getStatusCode()===200,'Real password sign-in restores management assurance');
  $pk=function($path,$body=[],$method='POST',$origin='https://mfa.example.test',$sendCsrf=true)use($call,$scope,$user){
   // Clear only test throttles between independent rejection scenarios; production routes retain their limits.
   Illuminate\Support\Facades\RateLimiter::clear('passkey:'.sha1('|192.0.2.52'));
   Illuminate\Support\Facades\RateLimiter::clear('PASSKEY_MANAGE_LIMIT:'.$user->id);
   return $call('v10/'.$path,$body,$scope,$method,$sendCsrf,$origin);
  };
  if($scope==='admin'){
   // Isolate current-password verification from the existing password-login length policy.
   $originalPassword=$user->password;$user->update(['password'=>password_hash('old7',PASSWORD_DEFAULT)]);
   [$response]=$pk('me/security/passkeys/registration-options',['password'=>'old7','name'=>'Legacy password']);$assert($response->getStatusCode()===201,'Management verifies existing short passwords without applying new-password policy');
   $user->update(['password'=>$originalPassword]);
  }
  [$response]=$pk('me/security/passkeys/registration-options',['password'=>'wrong-password','name'=>'Device']);$assert($response->getStatusCode()===422,'Binding checks current password');
  [$response]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Device'],'POST','https://evil.example');$assert($response->getStatusCode()===419,'Binding rejects foreign Origin');
  [$response]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Device'],'POST','https://mfa.example.test',false);$assert($response->getStatusCode()===419,'Binding requires CSRF');
  [$response,$body]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Device']);
  $assert($response->getStatusCode()===201,'Binding options created: '.$response->getContent());$setup=$body['data'];
  $assert($setup['publicKey']['authenticatorSelection']['userVerification']==='required' && $setup['publicKey']['authenticatorSelection']['residentKey']==='required','Discoverable credential and UV required');
  $private=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);$details=openssl_pkey_get_details($private);
  $raw=random_bytes(32);$cose="\xa5\x01\x02\x03\x26\x20\x01\x21".$bytes($details['ec']['x'])."\x22".$bytes($details['ec']['y']);
  $registration=function($options,$flags=0x45,$origin='https://mfa.example.test')use($encode,$raw,$cose,$bytes){
   $client=json_encode(['type'=>'webauthn.create','challenge'=>$options['publicKey']['challenge'],'origin'=>$origin,'crossOrigin'=>false]);
   $auth=hash('sha256','mfa.example.test',true).chr($flags).pack('N',0).str_repeat("\0",16).pack('n',strlen($raw)).$raw.$cose;
   return ['challengeId'=>$options['challengeId'],'credentialId'=>$encode($raw),'clientDataJSON'=>$encode($client),'attestationObject'=>$encode("\xa3\x63fmt\x64none\x67attStmt\xa0\x68authData".$bytes($auth))];
  };
  [$response,$body]=$pk('me/security/passkeys',$registration($setup));$assert($response->getStatusCode()===201,'Valid ES256 registration: '.$response->getContent());$id=$body['data']['id'];
  [$response]=$pk('me/security/passkeys',$registration($setup));$assert($response->getStatusCode()===409,'Registration cannot replay');
  foreach(['challengeArray','crossOrigin','topOrigin','truncatedCbor','backupFlags'] as $invalid){
   [, $body]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Malformed']);$payload=$registration($body['data'],$invalid==='backupFlags'?0x55:0x45);
   $client=json_decode(App\Services\PasskeyService::decode($payload['clientDataJSON']),true);
   if($invalid==='challengeArray')$client['challenge']=[];
   if($invalid==='crossOrigin')$client['crossOrigin']=true;
   if($invalid==='topOrigin')$client['topOrigin']='https://evil.example';
   $payload['clientDataJSON']=$encode(json_encode($client));
   if($invalid==='truncatedCbor')$payload['attestationObject']=$encode("\xa3\x63fmt");
   [$response]=$pk('me/security/passkeys',$payload);$assert($response->getStatusCode()===422,'Malformed registration fails safely: '.$invalid.' '.$response->getContent());
   [$response]=$pk('me/security/passkeys',$payload);$assert($response->getStatusCode()===409,'Malformed registration consumes challenge');
  }
  foreach([[0x41,'https://mfa.example.test'],[0x45,'https://evil.example']] as [$flags,$origin]){
   [, $body]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Invalid']);
   [$response]=$pk('me/security/passkeys',$registration($body['data'],$flags,$origin));$assert($response->getStatusCode()===422,'Invalid UV/client Origin rejected');
  }
  [$response,$body]=$pk('me/security/passkeys',[],'GET');$assert($response->getStatusCode()===200 && count($body['data']['credentials'])===1,'Scoped safe credential list');
  $assert(array_keys($body['data']['credentials'][0])===['id','name','rpId','createdAt','lastUsedAt'],'Never expose credential or public key material');
  $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'Credential list private and non-cacheable');
  $other=User::create(['email'=>'other-passkey-'.$scope.'@example.test','password'=>'unused','token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'transfer_enable'=>0]);
  $row=(array)DB::table('v2_passkey')->where('id',$id)->first();unset($row['id']);$row['user_id']=$other->id;$row['credential_hash']=hash('sha256',random_bytes(32));$otherId=DB::table('v2_passkey')->insertGetId($row);
  [$response]=$pk('me/security/passkeys/'.$otherId,['password'=>$password],'DELETE');$assert($response->getStatusCode()===404 && DB::table('v2_passkey')->where('id',$otherId)->exists(),'Cannot delete another account credential');
  $extra=[];for($i=0;$i<9;$i++){$row['user_id']=$user->id;$row['credential_hash']=hash('sha256',random_bytes(32));$extra[]=DB::table('v2_passkey')->insertGetId($row);}
  [$response]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Over limit']);$assert($response->getStatusCode()===409,'Credential count is bounded');DB::table('v2_passkey')->whereIn('id',$extra)->delete();
  // Exercise every advertised algorithm and authenticators with no signature counter (synced Passkeys).
  $rsa=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_RSA,'private_key_bits'=>2048]);$rsaDetails=openssl_pkey_get_details($rsa);
  $variants=[['RS256',"\xa4\x01\x03\x03\x39\x01\x00\x20".$bytes($rsaDetails['rsa']['n'])."\x21".$bytes($rsaDetails['rsa']['e']),fn($input)=>openssl_sign($input,$sig,$rsa,OPENSSL_ALGO_SHA256)?$sig:'']];
  if(function_exists('sodium_crypto_sign_keypair')){$pair=sodium_crypto_sign_keypair();$variants[]=['EdDSA',"\xa4\x01\x01\x03\x27\x20\x06\x21".$bytes(sodium_crypto_sign_publickey($pair)),fn($input)=>sodium_crypto_sign_detached($input,sodium_crypto_sign_secretkey($pair))];}
  foreach($variants as [$algorithm,$variantCose,$sign]){
   [, $body]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>$algorithm]);$variantSetup=$body['data'];$variantRaw=random_bytes(32);
   $client=json_encode(['type'=>'webauthn.create','challenge'=>$variantSetup['publicKey']['challenge'],'origin'=>'https://mfa.example.test']);
   $auth=hash('sha256','mfa.example.test',true)."\x4d".pack('N',0).str_repeat("\0",16).pack('n',32).$variantRaw.$variantCose;
   [$response,$body]=$pk('me/security/passkeys',['challengeId'=>$variantSetup['challengeId'],'credentialId'=>$encode($variantRaw),'clientDataJSON'=>$encode($client),'attestationObject'=>$encode("\xa3\x63fmt\x64none\x67attStmt\xa0\x68authData".$bytes($auth))]);
   $assert($response->getStatusCode()===201,'Real '.$algorithm.' registration succeeds: '.$response->getContent());$variantId=$body['data']['id'];
   for($attempt=0;$attempt<2;$attempt++){
    [, $body]=$pk('auth/passkeys/options');$options=$body['data'];$client=json_encode(['type'=>'webauthn.get','challenge'=>$options['publicKey']['challenge'],'origin'=>'https://mfa.example.test']);
    $auth=hash('sha256','mfa.example.test',true)."\x1d".pack('N',0);
    [$response,$body]=$pk('auth/passkeys/sessions',['challengeId'=>$options['challengeId'],'credentialId'=>$encode($variantRaw),'clientDataJSON'=>$encode($client),'authenticatorData'=>$encode($auth),'signature'=>$encode($sign($auth.hash('sha256',$client,true))),'userHandle'=>$variantSetup['publicKey']['user']['id']]);
    $assert($response->getStatusCode()===200 && $body['data']['authenticated'],'Real '.$algorithm.' zero-counter backed-up credential logs in: '.$response->getContent());
   }
   DB::table('v2_passkey')->where('id',$variantId)->delete();
  }
  $revokeDuringLock=(object)['active'=>true];
  DB::listen(function($query)use($revokeDuringLock,$user){if($revokeDuringLock->active && str_contains(strtolower($query->sql),'for update')){$revokeDuringLock->active=false;(new AuthService($user))->removeAllSession();}});
  [$response]=$pk('me/security/passkeys/'.$id,['password'=>$password],'DELETE');$assert($response->getStatusCode()===409 && DB::table('v2_passkey')->where('id',$id)->exists(),'Deletion rechecks revocation after acquiring user lock');
  [$response]=$fresh();$assert($response->getStatusCode()===200,'Fresh sign-in after revocation race');
  $assertion=function($options,$count=1,$flags=5,$origin='https://mfa.example.test',$rp='mfa.example.test')use($encode,$raw,$private,$setup){
   $client=json_encode(['type'=>'webauthn.get','challenge'=>$options['publicKey']['challenge'],'origin'=>$origin,'crossOrigin'=>false]);
   $auth=hash('sha256',$rp,true).chr($flags).pack('N',$count);openssl_sign($auth.hash('sha256',$client,true),$signature,$private,OPENSSL_ALGO_SHA256);
   return ['challengeId'=>$options['challengeId'],'credentialId'=>$encode($raw),'clientDataJSON'=>$encode($client),'authenticatorData'=>$encode($auth),'signature'=>$encode($signature),'userHandle'=>$setup['publicKey']['user']['id']];
  };
  // Reset to a separate anonymous browser before the sign-in ceremony.
  $jar[$scope]=[];unset($csrf[$scope]);$call('v10/auth/browser-session',[],$scope);
  [, $body]=$pk('auth/passkeys/options');$expired=$body['data'];$challengeKey='PASSKEY_CHALLENGE:'.hash('sha256',$expired['challengeId']);$record=Cache::get($challengeKey);$record['expiresAt']=time()-1;Cache::put($challengeKey,$record,300);
  [$response]=$pk('auth/passkeys/sessions',$assertion($expired));$assert($response->getStatusCode()===409,'Expired challenge rejected');
  foreach(['signature','uv','origin','rp','handle','unknown','challengeArray','truncatedAuth','backupFlags'] as $invalid){
   [, $body]=$pk('auth/passkeys/options');$payload=$assertion($body['data'],1,$invalid==='uv'?1:5,$invalid==='origin'?'https://evil.example':'https://mfa.example.test',$invalid==='rp'?'evil.example':'mfa.example.test');
   if($invalid==='signature')$payload['signature']=$encode(random_bytes(64));
   if($invalid==='handle')$payload['userHandle']=$encode(random_bytes(32));
   if($invalid==='unknown')$payload['credentialId']=$encode(random_bytes(32));
   if($invalid==='challengeArray'){$client=json_decode(App\Services\PasskeyService::decode($payload['clientDataJSON']),true);$client['challenge']=[];$payload['clientDataJSON']=$encode(json_encode($client));}
   if($invalid==='truncatedAuth')$payload['authenticatorData']=$encode('short');
   if($invalid==='backupFlags')$payload=$assertion($body['data'],1,0x15);
   [$response]=$pk('auth/passkeys/sessions',$payload);$assert($response->getStatusCode()===($invalid==='unknown'?401:422),'Invalid '.$invalid.' rejected: '.$response->getContent());
   [$response]=$pk('auth/passkeys/sessions',$payload);$assert($response->getStatusCode()===409,'Failed login challenge consumed');
  }
  config(['v2board.app_url'=>'HTTPS://MFA.EXAMPLE.TEST:443']);
  [, $body]=$pk('auth/passkeys/options');$payload=$assertion($body['data']);
  $previousJar=$jar[$scope];$previousCsrf=$csrf[$scope];$jar[$scope]=[];unset($csrf[$scope]);$call('v10/auth/browser-session',[],$scope);
  [$response]=$pk('auth/passkeys/sessions',$payload);$assert($response->getStatusCode()===409,'Challenge is bound to initiating browser');$jar[$scope]=$previousJar;$csrf[$scope]=$previousCsrf;
  [$response,$body]=$pk('auth/passkeys/sessions',$payload);$assert($response->getStatusCode()===200 && $body['data']['authenticated'] && $body['data']['accountId']===$user->id,'Signed assertion grants scoped cookie: '.$response->getContent());
  $assert(!isset($body['data']['accessToken']) && !isset($body['data']['auth_data']),'Passkey never exposes browser bearer');
  config(['v2board.app_url'=>'https://mfa.example.test']);
  if($scope==='user'){
   $jar['admin']=[];unset($csrf['admin']);$call('v10/auth/browser-session',[],'admin');
   Illuminate\Support\Facades\RateLimiter::clear('passkey:'.sha1('|192.0.2.52'));
   [, $body]=$call('v10/auth/passkeys/options',[],'admin','POST');
   [$response]=$call('v10/auth/passkeys/sessions',$assertion($body['data'],2),'admin','POST');$assert($response->getStatusCode()===401,'Ordinary credential cannot grant an administrator cookie');
  }
  [, $body]=$pk('auth/passkeys/options');[$response]=$pk('auth/passkeys/sessions',$assertion($body['data']));$assert($response->getStatusCode()===422,'Signature counter replay rejected');
  // Existing MFA must still complete after a valid Passkey assertion.
  $recovery='EEEE-FFFF-AAAA-BBBB';$secret=Totp::secret();
  DB::table('v2_user_mfa')->insert(['user_id'=>$user->id,'totp_secret'=>Crypt::encryptString($secret),'recovery_hashes'=>json_encode([hash('sha256',str_replace('-','',$recovery))]),'version'=>1]);
  $jar[$scope]=[];unset($csrf[$scope]);$call('v10/auth/browser-session',[],$scope);
  [, $body]=$pk('auth/passkeys/options');[$response,$body]=$pk('auth/passkeys/sessions',$assertion($body['data'],2));
  $assert($response->getStatusCode()===200 && $body['data']['mfaRequired'] && !isset($body['data']['authenticated']),'Passkey preserves existing MFA');$challenge=$body['data']['challengeId'];
  [$response]=$call('v10/me',[],$scope);$assert($response->getStatusCode()===401,'No grant before MFA');
  $finish=$scope==='user'?'v10/auth/mfa/verifications':'v1/passport/mfa/verifications';
  [$response,$body]=$call($finish,['challengeId'=>$challenge,'verificationMethod'=>'recovery','verificationCode'=>$recovery],$scope,'POST');$assert($response->getStatusCode()===200 && $body['data']['authenticated'],'Passkey MFA completion grants cookie');
  [, $body]=$pk('auth/passkeys/options');[$response,$body]=$pk('auth/passkeys/sessions',$assertion($body['data'],3));$challenge=$body['data']['challengeId'];
  config(['v2board.passkey_enable'=>0]);
  [$response]=$pk('auth/passkeys/options');$assert($response->getStatusCode()===409,'Disabled feature rejects login options');
  [$response]=$pk('me/security/passkeys/registration-options',['password'=>$password,'name'=>'Disabled']);$assert($response->getStatusCode()===409,'Disabled feature rejects binding');
  [$response,$body]=$pk('me/security/passkeys',[],'GET');$assert($response->getStatusCode()===200 && !$body['data']['enabled'] && count($body['data']['credentials'])===1,'Disabled credentials remain manageable');
  [$response]=$call($finish,['challengeId'=>$challenge,'verificationMethod'=>'totp','verificationCode'=>Totp::code($secret,intdiv(time(),30))],$scope,'POST');$assert($response->getStatusCode()===409,'Disabled feature invalidates pending Passkey MFA');
  // A pending proof from another credential must not recreate a session after account-wide revocation.
  config(['v2board.passkey_enable'=>1]);$secondRaw=random_bytes(32);$row=(array)DB::table('v2_passkey')->where('id',$id)->first();unset($row['id']);$row['credential_hash']=hash('sha256',$secondRaw);$row['credential_id']=$encode($secondRaw);$row['sign_count']=0;DB::table('v2_passkey')->insert($row);
  [, $body]=$pk('auth/passkeys/options');$payload=$assertion($body['data'],1);$payload['credentialId']=$encode($secondRaw);[$response,$body]=$pk('auth/passkeys/sessions',$payload);$assert($response->getStatusCode()===200 && $body['data']['mfaRequired'],'Another credential has a pending login proof');$otherChallenge=$body['data']['challengeId'];
  config(['v2board.passkey_enable'=>0]);
  [$response]=$pk('me/security/passkeys/'.$id,['password'=>$password],'DELETE');$assert($response->getStatusCode()===204,'Owner may remove disabled credential');
  config(['v2board.passkey_enable'=>1]);
  [$response]=$call($finish,['challengeId'=>$otherChallenge,'verificationMethod'=>'totp','verificationCode'=>Totp::code($secret,intdiv(time(),30))],$scope,'POST');$assert($response->getStatusCode()===409,'Deletion invalidates pending MFA using other still-bound credentials');
  [$response]=$call('v10/me',[],$scope);$assert($response->getStatusCode()===401,'Removal revokes authenticated sessions');
  $assert(!DB::table('v2_passkey')->where('id',$id)->exists(),'Credential removed');config(['v2board.passkey_enable'=>1]);
  Illuminate\Support\Facades\RateLimiter::clear('passkey:'.sha1('|192.0.2.52'));
  for($i=0;$i<10;$i++){[$response]=$call('v10/auth/passkeys/options',[],$scope,'POST');$assert($response->getStatusCode()===201,'Allowed login options within throttle');}
  [$response]=$call('v10/auth/passkeys/options',[],$scope,'POST');$assert($response->getStatusCode()===429,'Repeated Passkey challenge creation is rate limited');
 }
 echo "MFA and Passkey browser API: $checks checks passed; transaction rolled back.\n";
}finally{DB::rollBack();Cache::flush();}
