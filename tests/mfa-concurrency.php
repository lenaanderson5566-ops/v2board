<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
require __DIR__.'/commerce-bootstrap.php';
$database=getenv('COMMERCE_TEST_DATABASE');
if(!$database)throw new RuntimeException('Requires isolated database');
use App\Models\User;
use App\Services\{MfaService,Totp};
use Illuminate\Support\Facades\{DB,Cache,Crypt};
use App\Utils\CacheKey;
config(['cache.default'=>'redis']);
// Never flush Redis: every cache key and lock has an isolated test prefix.
Cache::store('redis')->getStore()->setPrefix('MFA_TEST:'.$database.':');
$make=function($body=[]){$request=Illuminate\Http\Request::create('/','POST',$body,[],[],['HTTP_USER_AGENT'=>'MfaConcurrency','REMOTE_ADDR'=>'192.0.2.72']);app()->instance('request',$request);return $request;};
if(($argv[1]??'')==='worker') {
    $input=json_decode(stream_get_contents(STDIN),true);
    try {
      if(($input['type']??'')==='passkey'){
       config(['v2board.passkey_enable'=>1,'v2board.app_url'=>'https://concurrency.example.test']);
       $request=$make($input['proof']);$request->headers->set('Origin','https://concurrency.example.test');$request->attributes->set('browser.session',$input['browser']);
       (new App\Services\PasskeyService())->login($request);
      } else (new MfaService())->finish($input['challenge'],$make(['verificationMethod'=>$input['method'],'verificationCode'=>$input['code']]));
      echo 'ok';
    }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $error){if(!in_array($error->getStatusCode(),[409,422],true))exit(2);echo 'rejected';}
    catch(Throwable $error){echo get_class($error);exit(2);}exit;
}
$run=function($proofs){
    $jobs=[];
    foreach($proofs as $proof){$process=proc_open([PHP_BINARY,__FILE__,'worker'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Cannot start worker');fwrite($pipes[0],json_encode($proof));fclose($pipes[0]);$jobs[]=[$process,$pipes];}
    $results=[];foreach($jobs as [$process,$pipes]){$results[]=trim(stream_get_contents($pipes[1]));stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($process)!==0)throw new RuntimeException('Concurrency worker failed');}
    sort($results);if($results!==['ok','rejected'])throw new RuntimeException('Proof consumed more than once');
};
$service=new MfaService();$users=[];$tokens=[];
try {
    foreach(['sameChallenge','recovery','totp'] as $case){
        $user=User::create(['email'=>'mfa-concurrent-'.$case.'-'.bin2hex(random_bytes(4)).'@example.test','password'=>password_hash('Concurrent!2026',PASSWORD_DEFAULT),'uuid'=>Illuminate\Support\Str::uuid(),'token'=>bin2hex(random_bytes(16)),'transfer_enable'=>0]);$users[]=$user->id;
        $secret=Totp::secret();$recovery=strtoupper(bin2hex(random_bytes(16)));
        DB::table('v2_user_mfa')->insert(['user_id'=>$user->id,'totp_secret'=>Crypt::encryptString($secret),'recovery_hashes'=>json_encode([hash('sha256',$recovery)]),'version'=>1]);
        $first=$service->login($user,$make());$tokens[]=$first['challengeId'];
        $second=$case==='sameChallenge'?$first:$service->login($user,$make());$tokens[]=$second['challengeId'];
        $method=$case==='totp'?'totp':'recovery';$code=$case==='totp'?Totp::code($secret,intdiv(time(),30)):$recovery;
        $run([['challenge'=>$first['challengeId'],'method'=>$method,'code'=>$code],['challenge'=>$second['challengeId'],'method'=>$method,'code'=>$code]]);
    }
    config(['v2board.passkey_enable'=>1,'v2board.app_url'=>'https://concurrency.example.test']);
    $encode=[App\Services\PasskeyService::class,'encode'];
    foreach(['sameChallenge','sameCounter'] as $case){
      $user=User::create(['email'=>'passkey-concurrent-'.$case.'-'.bin2hex(random_bytes(4)).'@example.test','password'=>'unused','uuid'=>Illuminate\Support\Str::uuid(),'token'=>bin2hex(random_bytes(16)),'transfer_enable'=>0]);$users[]=$user->id;
      $private=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);$public=openssl_pkey_get_details($private)['key'];$raw=random_bytes(32);$handle=$encode(random_bytes(32));
      DB::table('v2_passkey')->insert(['user_id'=>$user->id,'credential_hash'=>hash('sha256',$raw),'credential_id'=>$encode($raw),'public_key'=>$public,'user_handle'=>$handle,'rp_id'=>'concurrency.example.test','name'=>'Race','sign_count'=>0,'created_at'=>time()]);
      $browser=['scope'=>'user','id'=>bin2hex(random_bytes(32))];$request=$make();$request->headers->set('Origin','https://concurrency.example.test');$request->attributes->set('browser.session',$browser);$passkeys=new App\Services\PasskeyService();
      $first=$passkeys->loginOptions($request);$second=$case==='sameChallenge'?$first:$passkeys->loginOptions($request);$proofs=[];
      foreach([$first,$second] as $options){
       $client=json_encode(['type'=>'webauthn.get','challenge'=>$options['publicKey']['challenge'],'origin'=>'https://concurrency.example.test']);$auth=hash('sha256','concurrency.example.test',true)."\x05".pack('N',1);openssl_sign($auth.hash('sha256',$client,true),$signature,$private,OPENSSL_ALGO_SHA256);
       $proofs[]=['type'=>'passkey','browser'=>$browser,'proof'=>['challengeId'=>$options['challengeId'],'credentialId'=>$encode($raw),'clientDataJSON'=>$encode($client),'authenticatorData'=>$encode($auth),'signature'=>$encode($signature),'userHandle'=>$handle]];
      }
      $run($proofs);
      if(count((new App\Services\AuthService($user))->getSessions())!==1)throw new RuntimeException('Parallel Passkey assertions granted multiple sessions');
    }
    echo "MFA and Passkey concurrency: challenge, recovery, TOTP and signature counter enforce single consumption across real parallel processes.\n";
}finally{
    foreach($tokens as $token)Cache::forget('MFA_CHALLENGE:'.hash('sha256',$token));
    DB::table('v2_user_mfa')->whereIn('user_id',$users)->delete();
    DB::table('v2_passkey')->whereIn('user_id',$users)->delete();
    User::whereIn('id',$users)->delete();
    foreach($users as $id){Cache::forget(CacheKey::get('USER_SESSIONS',$id));foreach(['login:','verify:'] as $purpose)Cache::forget('MFA_LIMIT:'.hash('sha256',$purpose.$id));}
}
