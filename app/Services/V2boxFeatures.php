<?php
namespace App\Services;

use Illuminate\Validation\ValidationException;

class V2boxFeatures {
    private static function fail(string $message): void { throw ValidationException::withMessages(['sing_box'=>$message]); }
    private static function keys(array $value, array $allowed): void {
        foreach ($value as $key => $_) if (!in_array($key, $allowed, true)) self::fail('Unsupported field: '.$key);
    }
    private static function walk(array $value): void {
        foreach ($value as $key=>$v) {
            if (in_array($key, ['certificate_path','client_certificate_path','client_key_path','key_path','auth_user'], true)) self::fail('Managed or unsupported field: '.$key);
            if (is_array($v)) self::walk($v);
        }
    }
    public static function validate(array $value, bool $complete = false): void {
        if (strlen(json_encode($value)) > 262144) self::fail('Configuration exceeds 256 KiB');
        self::keys($value, ['dns','route','outbounds']);
        foreach (['dns','route'] as $section) {
            if (isset($value[$section]) && (!is_array($value[$section]) || ($value[$section] && array_is_list($value[$section])))) self::fail($section.' must be an object');
        }
        self::walk($value);
        foreach (['outbounds'=> $value['outbounds'] ?? [], 'dns.servers'=>$value['dns']['servers'] ?? [], 'dns.rules'=>$value['dns']['rules'] ?? [], 'route.rules'=>$value['route']['rules'] ?? [], 'route.rule_set'=>$value['route']['rule_set'] ?? []] as $path=>$items) {
            if (!is_array($items) || array_values($items) !== $items) self::fail($path.' must be an array');
            $tags = [];
            foreach ($items as $item) {
                if (!is_array($item) || array_values($item) === $item) self::fail($path.' entries must be objects');
                if (in_array($path, ['outbounds','dns.servers','route.rule_set'], true)) {
                    $tag = $item['tag'] ?? null;
                    if (!is_string($tag) || $tag === '' || isset($tags[$tag])) self::fail('Missing or duplicate tag in '.$path);
                    $tags[$tag] = true;
                }
            }
        }
        if (isset($value['dns'])) {
            if (!is_array($value['dns'])) self::fail('dns must be an object');
            self::keys($value['dns'], ['servers','rules','final','strategy','disable_cache','disable_expire','independent_cache','cache_capacity','client_subnet']);
            if (empty($value['dns']['servers']) || !is_array($value['dns']['servers'])) self::fail('dns.servers must be a nonempty array');
            foreach ($value['dns']['servers'] as $s) if (!is_array($s) || !in_array($s['type'] ?? '', ['local','udp','tcp','tls','https'], true)) self::fail('Unsupported DNS server type');
        }
        if (isset($value['route'])) {
            if (!is_array($value['route'])) self::fail('route must be an object');
            self::keys($value['route'], ['rules','rule_set','final','default_domain_resolver']);
            foreach ($value['route']['rule_set'] ?? [] as $set) {
                if (!is_array($set) || !in_array($set['type'] ?? '', ['inline','remote'], true)) self::fail('Only inline and remote rule sets are supported');
                if ($set['type'] === 'remote' && (parse_url($set['url'] ?? '', PHP_URL_SCHEME) !== 'https' || !parse_url($set['url'] ?? '', PHP_URL_HOST))) self::fail('Remote rule sets require HTTPS');
            }
        }
        foreach (['route','dns'] as $section) self::rules($value[$section]['rules'] ?? [], $section);
        $seen = ['direct'=>true];
        if (isset($value['outbounds']) && !is_array($value['outbounds'])) self::fail('outbounds must be an array');
        foreach ($value['outbounds'] ?? [] as $out) {
            if (!is_array($out) || !in_array($out['type'] ?? '', ['direct','socks','http','vmess','vless','trojan','shadowsocks','hysteria2','tuic','anytls'], true)) self::fail('Unsupported outbound type');
            $tag = $out['tag'] ?? '';
            if (!is_string($tag) || $tag === '' || isset($seen[$tag])) self::fail('Missing or duplicate/reserved outbound tag');
            $seen[$tag]=true;
        }
        if ($complete) self::references($value);
    }

    private static function rules(array $rules, string $scope, int $depth = 0): void {
        if ($depth > 32) self::fail('Rule nesting exceeds 32 levels');
        foreach ($rules as $rule) {
            foreach (['geoip','geosite'] as $retired) if (array_key_exists($retired,$rule)) self::fail($retired.' 已退役，请改用 sing-box rule_set');
            $type=$rule['type']??'default';
            if (!in_array($type,['default','logical'],true)) self::fail('Unsupported rule type');
            if ($type==='logical') {
                if (!in_array($rule['mode']??null,['and','or'],true) || empty($rule['rules']) || !is_array($rule['rules']) || !array_is_list($rule['rules'])) self::fail('Logical rules require mode and/or and a nonempty rules array');
                foreach ($rule['rules'] as $child) if (!is_array($child) || !$child || array_is_list($child)) self::fail('Logical rule entries must be objects');
                self::rules($rule['rules'],$scope,$depth+1);
            }
            if (isset($rule['action'])) {
                $allowed=$scope==='dns' ? ['route','route-options','reject','predefined','evaluate','respond'] : ['route','route-options','direct','bypass','reject','hijack-dns','sniff','resolve'];
                if (!in_array($rule['action'],$allowed,true)) self::fail('Unsupported '.$scope.' rule action');
            }
        }
    }

    /** Validate after all selected catalog fragments have been merged. */
    private static function references(array $value): void {
        $outbounds=array_fill_keys(array_merge(['direct'],array_column($value['outbounds']??[],'tag')),true);
        $dns=$value['dns']??['servers'=>[['type'=>'local','tag'=>'local']],'final'=>'local'];
        $servers=array_fill_keys(array_column($dns['servers'],'tag'),true);
        $sets=array_fill_keys(array_column($value['route']['rule_set']??[],'tag'),true);
        $check=static function($tag,array $known,string $path): void {
            if (!is_string($tag) || !isset($known[$tag])) self::fail('Unknown configuration reference: '.$path);
        };
        $check($value['route']['final']??'direct',$outbounds,'route.final');
        if (isset($dns['final'])) $check($dns['final'],$servers,'dns.final');
        $walk=function($items,string $scope='',string $path='')use(&$walk,$check,$outbounds,$servers,$sets): void {
            if (!is_array($items)) return;
            foreach ($items as $key=>$item) {
                $at=$path===''?(string)$key:$path.'.'.$key;
                if (in_array($key,['outbound','detour','download_detour'],true)) $check($item,$outbounds,$at);
                elseif ($key==='server' && in_array($scope,['rules','resolver'],true)) $check($item,$servers,$at);
                elseif ($key==='rule_set' && $scope==='rules') {
                    foreach (is_array($item)?$item:[$item] as $tag) $check($tag,$sets,$at);
                    continue;
                } elseif (in_array($key,['default_domain_resolver','domain_resolver'],true)) {
                    if (is_string($item)) $check($item,$servers,$at);
                    elseif (is_array($item) && isset($item['server'])) $walk($item,'resolver',$at);
                    else self::fail('Invalid DNS resolver: '.$at);
                    continue;
                }
                $walk($item,$key==='rules'?'rules':$scope,$at);
            }
        };
        $walk($dns,'','dns');
        $walk($value['route']??[],'','route');
        $walk($value['outbounds']??[],'','outbounds');
    }
}
