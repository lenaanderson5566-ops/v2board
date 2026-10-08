<?php
namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class FastaiEntrypoints
{
    public static function origin(string $value): string
    {
        $parts=parse_url($value);
        if (!$parts || ($parts['scheme'] ?? '')!=='https' || empty($parts['host']) || isset($parts['user']) || isset($parts['query']) || isset($parts['fragment']) || !in_array($parts['path'] ?? '', ['', '/'],true) || isset($parts['port']) && $parts['port']!==443 || filter_var($parts['host'],FILTER_VALIDATE_IP) || !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iD',$parts['host'])) {
            throw ValidationException::withMessages(['fastai_entrypoints'=>'Use an HTTPS domain origin without paths, credentials or custom ports.']);
        }
        return 'https://'.strtolower($parts['host']);
    }

    public static function validate(array $entries): array
    {
        Validator::make(['entries'=>$entries],[
            'entries'=>'array|max:16','entries.*'=>'array:origin,enabled,priority',
            'entries.*.origin'=>'required|string|max:253','entries.*.enabled'=>'required|boolean',
            'entries.*.priority'=>'required|integer|min:1|max:100',
        ])->validate();
        $seen=[];
        foreach ($entries as &$entry) {
            $entry['origin']=self::origin($entry['origin']);
            if (isset($seen[$entry['origin']])) throw ValidationException::withMessages(['fastai_entrypoints'=>'Duplicate domain origin.']);
            $seen[$entry['origin']]=true;
        }
        unset($entry);
        if ($entries && !array_filter($entries,fn($entry)=>$entry['enabled'])) throw ValidationException::withMessages(['fastai_entrypoints'=>'Keep at least one enabled service origin.']);
        return $entries;
    }

    private function secret(): string
    {
        $seed=base64_decode((string)config('fastai.entrypoint_signing_seed'),true);
        abort_unless(function_exists('sodium_crypto_sign_seed_keypair') && is_string($seed) && strlen($seed)===32,503,'Service entrypoint signing is not configured.');
        return sodium_crypto_sign_secretkey(sodium_crypto_sign_seed_keypair($seed));
    }

    public function publicKey(): ?string
    {
        $seed=base64_decode((string)config('fastai.entrypoint_signing_seed'),true);
        if (!function_exists('sodium_crypto_sign_seed_keypair') || !is_string($seed) || strlen($seed)!==32) return null;
        return base64_encode(sodium_crypto_sign_publickey_from_secretkey($this->secret()));
    }

    public function envelope(): array
    {
        $entries=self::validate(config('v2board.fastai_entrypoints',[]));
        $entries=array_values(array_filter($entries,fn($entry)=>$entry['enabled']));
        if (!$entries) $entries=[['origin'=>self::origin(config('v2board.app_url')),'enabled'=>true,'priority'=>1]];
        usort($entries,fn($a,$b)=>$a['priority']<=>$b['priority']);
        $key=$this->secret();
        $payload=json_encode(['serviceId'=>hash('sha256',sodium_crypto_sign_publickey_from_secretkey($key)),
            'version'=>(int)config('v2board.fastai_entrypoints_version',1),
            'issuedAt'=>time(),'expiresAt'=>time()+7*86400,
            'endpoints'=>array_map(fn($entry)=>['origin'=>$entry['origin'],'priority'=>$entry['priority']],$entries)],JSON_UNESCAPED_SLASHES);
        return ['payload'=>base64_encode($payload),'signature'=>base64_encode(sodium_crypto_sign_detached($payload,$key))];
    }

    private function verificationKey(string $origin): string
    {
        return 'FASTAI_ENTRYPOINT_VERIFIED:'.hash('sha256',$origin.':'.$this->publicKey());
    }

    public function check(string $value): array
    {
        $origin=self::origin($value);
        $public=$this->publicKey();
        abort_unless($public,503,'Configure the entrypoint signing key first.');
        $host=parse_url($origin,PHP_URL_HOST);
        $records=dns_get_record($host,DNS_A);
        $addresses=array_column($records ?: [],'ip');
        abort_unless($addresses,422,'The domain has no public IPv4 address.');
        foreach ($addresses as $ip) abort_unless(filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE),422,'Private or reserved destination addresses are not allowed.');
        $started=microtime(true);
        try {
            $response=\Illuminate\Support\Facades\Http::withOptions(['allow_redirects'=>false,'proxy'=>'','curl'=>[CURLOPT_RESOLVE=>[$host.':443:'.$addresses[0]]]])->connectTimeout(3)->timeout(6)->get($origin.'/api/v10/public/fastai/entrypoints');
            $envelope=$response->json('data');
            $payload=is_array($envelope) ? base64_decode($envelope['payload'] ?? '',true) : false;
            $signature=is_array($envelope) ? base64_decode($envelope['signature'] ?? '',true) : false;
            abort_unless($response->status()===200 && is_string($payload) && is_string($signature) && strlen($signature)===64 && sodium_crypto_sign_verify_detached($signature,$payload,base64_decode($public)),422,'The domain does not provide this service with a valid HTTPS certificate and signature.');
            $data=json_decode($payload,true);
            abort_unless(($data['expiresAt'] ?? 0)>time() && ($data['serviceId'] ?? '')===hash('sha256',base64_decode($public)),422,'Service entrypoint response is expired or belongs to another service.');
        } catch (\Illuminate\Http\Client\ConnectionException $error) { abort(422,'The domain is unreachable or its HTTPS certificate is invalid.'); }
        \Illuminate\Support\Facades\Cache::put($this->verificationKey($origin),true,600);
        return ['origin'=>$origin,'checkedAt'=>gmdate('Y-m-d\TH:i:s\Z'),'durationMs'=>(int)((microtime(true)-$started)*1000)];
    }

    public function requireVerified(array $entries): void
    {
        if (!$entries) throw ValidationException::withMessages(['fastai_entrypoints'=>'Keep at least one enabled service origin.']);
        $previous=array_column(array_filter(config('v2board.fastai_entrypoints',[]),fn($entry)=>$entry['enabled']),'origin');
        foreach ($entries as $entry) if ($entry['enabled'] && !in_array($entry['origin'],$previous,true)) {
            if (!\Illuminate\Support\Facades\Cache::get($this->verificationKey($entry['origin']))) throw ValidationException::withMessages(['fastai_entrypoints'=>'Check each new enabled domain before publishing (checks expire after ten minutes).']);
        }
    }

    public function requestOrigin(Request $request): string
    {
        $canonical=self::origin((string)config('v2board.app_url'));
        $incoming=rtrim($request->getSchemeAndHttpHost(),'/');
        foreach (self::validate(config('v2board.fastai_entrypoints',[])) as $entry) if ($entry['enabled'] && $entry['origin']===$incoming) return $incoming;
        return $canonical;
    }
}
