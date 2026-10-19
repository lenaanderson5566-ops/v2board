<?php
namespace App\Services;

use App\Models\User;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache,DB,Schema};
use lbuchs\WebAuthn\WebAuthn;
use lbuchs\WebAuthn\Binary\ByteBuffer;

final class PasskeyService
{
    public function available(): bool { return Schema::hasTable('v2_passkey') && class_exists(WebAuthn::class); }
    public function enabled(): bool { return (bool)config('v2board.passkey_enable',0) && $this->available(); }
    public function assertConfigured(): void { $this->origin(); }
    public static function encode(string $bytes): string { return rtrim(strtr(base64_encode($bytes),'+/','-_'),'='); }
    public static function decode(string $value): string {
        abort_unless($value!=='' && preg_match('/^[A-Za-z0-9_-]+$/D',$value),422,'Invalid Passkey response.');
        $bytes=base64_decode(strtr($value,'-_','+/'),true);
        abort_unless(is_string($bytes) && self::encode($bytes)===$value,422,'Invalid Passkey response.');
        return $bytes;
    }
    private function origin(): array {
        $p=parse_url((string)config('v2board.app_url'));
        $host=strtolower($p['host'] ?? ''); $scheme=strtolower($p['scheme'] ?? '');
        $local=app()->environment('local') && $host==='localhost' && $scheme==='http';
        abort_unless($p && !isset($p['user']) && !isset($p['pass']) && $host!=='' && (bool)filter_var($host,FILTER_VALIDATE_DOMAIN,FILTER_FLAG_HOSTNAME)
            && !filter_var($host,FILTER_VALIDATE_IP) && ($scheme==='https' || $local),503,'请先配置 HTTPS 站点 URL，再启用 Passkey。');
        return [$host,\App\Http\Middleware\BrowserOrigins::canonical((string)config('v2board.app_url'))];
    }
    private function browser(Request $request, bool $enabled=true): array {
        abort_unless($enabled ? $this->enabled() : $this->available(),409,'Passkey 当前未开启或尚未安装。');
        $session=$request->attributes->get('browser.session');
        abort_unless(is_array($session) && in_array($session['scope'] ?? '',['user','admin'],true),403,'Passkey 仅支持本站浏览器会话。');
        [$rp,$origin]=$this->origin();
        if (!$request->isMethod('GET')) abort_unless($request->header('Origin')===$origin,403,'Passkey Origin is not allowed.');
        return [$rp,$origin,hash_hmac('sha256',$session['scope'].':'.$session['id'],config('app.key'))];
    }
    private function management(User $user, Request $request): array {
        $request->validate(['password'=>'required|string|max:128']);
        $key='PASSKEY_MANAGE_LIMIT:'.$user->id;
        \Illuminate\Support\Facades\RateLimiter::attempt($key,5,fn()=>true,300) || abort(429,'请稍后再试。');
        abort_unless(Helper::multiPasswordVerify($user->password_algo,$user->password_salt,$request->input('password'),$user->password),422,'Incorrect email or password');
        $reference=AuthService::sessionReference($request->bearerToken() ?: $request->header('Authorization',''));
        $sessions=(new AuthService($user))->getSessions();
        $meta=$reference ? ($sessions[$reference['sessionId']] ?? null) : null;
        abort_unless($reference && (int)$reference['userId']===(int)$user->id && $meta && AuthService::authenticatedAt($reference)>=time()-300,409,'请先重新登录并完成已有安全验证，再于 5 分钟内管理 Passkey。');
        return $reference;
    }
    private function engine(string $rp): WebAuthn { return new WebAuthn((string)config('v2board.app_name','V2Board'),$rp,['none']); }
    private function verify(callable $operation) {
        try { return $operation(); }
        catch (\lbuchs\WebAuthn\WebAuthnException|\TypeError|\ValueError|\ErrorException $e) { abort(422,'Passkey 验证失败，请重试。'); }
    }
    private function normalize($value) {
        if ($value instanceof ByteBuffer) return self::encode($value->getBinaryString());
        if (is_object($value) || is_array($value)) { $out=[]; foreach ($value as $k=>$v) $out[$k]=$this->normalize($v); return $out; }
        return $value;
    }
    private function issue(array $record, Request $request, WebAuthn $engine, $options): array {
        [$rp,$origin,$binding]=$this->browser($request);
        $token=bin2hex(random_bytes(32));
        $record+=['rp'=>$rp,'origin'=>$origin,'binding'=>$binding,'challenge'=>self::encode($engine->getChallenge()->getBinaryString()),'expiresAt'=>time()+300];
        Cache::put('PASSKEY_CHALLENGE:'.hash('sha256',$token),$record,300);
        return ['challengeId'=>$token,'expiresAt'=>gmdate('c',$record['expiresAt']),'publicKey'=>$this->normalize($options->publicKey)];
    }
    private function ceremony(Request $request, string $kind, callable $operation) {
        $request->validate(['challengeId'=>'required|string|regex:/^[a-f0-9]{64}$/D']);
        [$rp,$origin,$binding]=$this->browser($request);
        $key='PASSKEY_CHALLENGE:'.hash('sha256',$request->input('challengeId'));
        return Cache::lock($key.':lock',10)->block(5,function()use($key,$binding,$rp,$origin,$kind,$request,$operation) {
            $record=Cache::get($key);
            abort_unless($record && $record['kind']===$kind && $record['rp']===$rp && $record['origin']===$origin && $record['expiresAt']>time() && hash_equals($record['binding'],$binding),409,'Passkey 验证已过期，请重试。');
            Cache::forget($key); // One attempt per challenge, including invalid signatures.
            $client=self::decode($request->input('clientDataJSON'));
            $data=json_decode($client,true);
            abort_unless(is_array($data) && ($data['origin'] ?? null)===$origin && ($data['crossOrigin'] ?? false)===false
                && !isset($data['topOrigin']) && ($data['type'] ?? null)===($kind==='create'?'webauthn.create':'webauthn.get')
                && is_string($data['challenge'] ?? null) && hash_equals($record['challenge'],$data['challenge']),422,'Invalid Passkey response.');
            try { return $operation($record,$client,$this->engine($rp)); }
            catch (\lbuchs\WebAuthn\WebAuthnException $e) { abort(422,'Passkey 验证失败，请重试。'); }
        });
    }
    public function state(User $user): array {
        $rows=$this->available() ? DB::table('v2_passkey')->where('user_id',$user->id)->orderBy('id')->get(['id','name','rp_id','created_at','last_used_at']) : collect();
        return ['enabled'=>$this->enabled(),'credentials'=>$rows->map(fn($r)=>['id'=>(int)$r->id,'name'=>$r->name,'rpId'=>$r->rp_id,'createdAt'=>gmdate('c',$r->created_at),'lastUsedAt'=>$r->last_used_at ? gmdate('c',$r->last_used_at) : null])->all()];
    }
    public function registrationOptions(User $user, Request $request): array {
        [$rp]=$this->browser($request); $ref=$this->management($user,$request);
        $request->validate(['name'=>'required|string|max:64']);
        $ids=DB::table('v2_passkey')->where('user_id',$user->id)->where('rp_id',$rp)->pluck('credential_id');
        abort_if(DB::table('v2_passkey')->where('user_id',$user->id)->count()>=10,409,'每个账户最多绑定 10 个 Passkey。');
        $handle=self::encode(hash_hmac('sha256','passkey:'.$user->id.':'.$rp,config('app.key'),true));
        $engine=$this->engine($rp);
        $options=$engine->getCreateArgs(self::decode($handle),$user->email,$user->email,300,true,'required',null,$ids->map(fn($id)=>self::decode($id))->all());
        unset($options->publicKey->extensions);
        return $this->issue(['kind'=>'create','userId'=>(int)$user->id,'name'=>$request->input('name'),'handle'=>$handle,'reference'=>$ref,'passwordHash'=>hash('sha256',$user->password),'emailHash'=>hash('sha256',$user->email)],$request,$engine,$options);
    }
    public function register(User $user, Request $request): array {
        return $this->ceremony($request,'create',function($record,$client,$engine)use($user,$request) {
            return DB::transaction(function()use($record,$client,$engine,$user,$request) {
                $current=User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                $ref=AuthService::sessionReference($request->bearerToken() ?: $request->header('Authorization',''));
                abort_unless(!$current->banned && $record['userId']===(int)$current->id && $ref && $ref===$record['reference'] && AuthService::sessionUser($ref)
                    && hash_equals($record['passwordHash'],hash('sha256',$current->password)) && hash_equals($record['emailHash'],hash('sha256',$current->email)),409,'安全设置已变化，请重新验证。');
                abort_unless(AuthService::authenticatedAt($ref)>=time()-300,409,'请重新登录后绑定 Passkey。');
                abort_if(DB::table('v2_passkey')->where('user_id',$user->id)->count()>=10,409,'每个账户最多绑定 10 个 Passkey。');
                $attestation=self::decode($request->input('attestationObject'));
                $result=$this->verify(fn()=>$engine->processCreate($client,$attestation,self::decode($record['challenge']),true,true));
                abort_if($result->isBackedUp && !$result->isBackupEligible,422,'Invalid Passkey response.');
                abort_unless(hash_equals($result->credentialId,self::decode($request->input('credentialId'))),422,'Invalid Passkey response.');
                $hash=hash('sha256',$result->credentialId);
                abort_if(DB::table('v2_passkey')->where('credential_hash',$hash)->exists(),409,'此 Passkey 已绑定。');
                $id=DB::table('v2_passkey')->insertGetId(['user_id'=>$user->id,'credential_hash'=>$hash,'credential_id'=>self::encode($result->credentialId),
                    'public_key'=>$result->credentialPublicKey,'user_handle'=>$record['handle'],'rp_id'=>$record['rp'],'name'=>$record['name'],'sign_count'=>$result->signatureCounter ?? 0,'created_at'=>time()]);
                return ['id'=>$id];
            },3);
        });
    }
    public function loginOptions(Request $request): array {
        [$rp]=$this->browser($request); $engine=$this->engine($rp);
        return $this->issue(['kind'=>'login'],$request,$engine,$engine->getGetArgs([],300,true,true,true,true,true,'required'));
    }
    public function login(Request $request): array {
        return $this->ceremony($request,'login',function($record,$client,$engine)use($request) {
            $hash=hash('sha256',self::decode($request->input('credentialId')));
            $owner=DB::table('v2_passkey')->where('credential_hash',$hash)->value('user_id');
            abort_unless($owner,401,'Passkey 登录失败。');
            return DB::transaction(function()use($owner,$hash,$record,$client,$engine,$request) {
                $user=User::whereKey($owner)->lockForUpdate()->first();
                $credential=DB::table('v2_passkey')->where('credential_hash',$hash)->lockForUpdate()->first();
                $admin=$request->attributes->get('browser.session')['scope']==='admin';
                abort_unless($user && !$user->banned && (!$admin || $user->is_admin) && $credential && $credential->rp_id===$record['rp'],401,'Passkey 登录失败。');
                abort_unless(hash_equals($credential->user_handle,$request->input('userHandle')),422,'Invalid Passkey response.');
                $authenticator=self::decode($request->input('authenticatorData'));
                abort_unless(strlen($authenticator)>=37,422,'Invalid Passkey response.');
                $flags=ord($authenticator[32]);
                abort_if(($flags & 16) && !($flags & 8),422,'Invalid Passkey response.');
                $signature=self::decode($request->input('signature'));
                $this->verify(fn()=>$engine->processGet($client,$authenticator,$signature,$credential->public_key,self::decode($record['challenge']),(int)$credential->sign_count,true,true));
                DB::table('v2_passkey')->where('id',$credential->id)->update(['sign_count'=>$engine->getSignatureCounter() ?? 0,'last_used_at'=>time()]);
                $request->attributes->set('passkey.credentialHash',$hash);
                if ($mfa=app(MfaService::class)->login($user,$request)) return $mfa;
                $user->last_login_at=time(); $user->last_login_ip=filter_var($request->ip(),FILTER_VALIDATE_IP) ? $request->ip() : null; $user->save();
                (new RiskLogService())->createLoginLog(['user_id'=>$user->id,'email'=>$user->email,'is_success'=>true,'reason'=>'passkey_success']);
                return (new AuthService($user))->generateAuthData($request);
            },3);
        });
    }
    public function remove(User $user, Request $request, int $id): void {
        $this->browser($request,false); $ref=$this->management($user,$request);
        DB::transaction(function()use($user,$id,$ref) {
            $current=User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            abort_unless(!$current->banned && hash_equals($current->password,$user->password) && hash_equals($current->email,$user->email)
                && AuthService::sessionUser($ref) && AuthService::authenticatedAt($ref)>=time()-300,409,'安全设置已变化，请重新登录。');
            abort_unless(DB::table('v2_passkey')->where('id',$id)->where('user_id',$user->id)->delete(),404,'Passkey 不存在。');
            // Revoke pending MFA/authorization proofs too, including those using another credential.
            DB::table('v2_user_mfa')->insertOrIgnore(['user_id'=>$current->id]);
            DB::table('v2_user_mfa')->where('user_id',$current->id)->increment('version');
            (new AuthService($current))->removeAllSession();
        },3);
    }
}
