<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Operational classification only. Never consulted by authentication or format selection. */
final class ClientRecognition
{
    private ?array $snapshot = null;
    private ?array $catalogCache = null;
    private ?array $legacyNames = null;

    public function snapshot(): array
    {
        if ($this->snapshot !== null) return $this->snapshot;
        $row = Schema::hasTable('v2_client_recognition')
            ? DB::table('v2_client_recognition')->where('id', 1)->first() : null;
        return $this->snapshot = ['version'=>(int)($row->version ?? 0),
            'overrides'=>$row ? json_decode($row->rules, true, 512, JSON_THROW_ON_ERROR) : []];
    }

    public function catalog(?array $overrides = null): array
    {
        $cached = $overrides === null;
        if ($cached && $this->catalogCache !== null) return $this->catalogCache;
        $overrides ??= $this->snapshot()['overrides'];
        $this->legacyNames ??= Schema::hasTable('v2_client_strategy')
            ? DB::table('v2_client_strategy')->pluck('client_name','client_type')->all() : [];
        $items = [];
        foreach (SubscriptionClientRegistry::CLIENTS as $code=>$definition) {
            $entry = $overrides[$code] ?? [];
            $items[] = ['code'=>$code, 'name'=>$entry['name'] ?? (($this->legacyNames[$code] ?? '') ?: $definition[2]),
                'defaultName'=>$definition[2], 'builtinAliases'=>ClientIdentity::matchingAliases($code),
                'aliases'=>$entry['aliases'] ?? [], 'priority'=>$entry['priority'] ?? 100];
        }
        if ($cached) $this->catalogCache = $items;
        return $items;
    }

    public function identify(string $ua, ?array $overrides = null): array
    {
        $ua = trim(substr($ua, 0, 1024));
        $code = ClientIdentity::identify($ua);
        $items = $this->catalog($overrides);
        $source = $code ? 'builtin' : 'unknown';
        if (!$code) {
            usort($items, fn($a,$b)=>($b['priority'] <=> $a['priority']) ?: strcmp($a['code'],$b['code']));
            foreach ($items as $item) {
                foreach ($item['aliases'] as $alias) {
                    if (self::matches($alias, $ua)) {
                        $code = $item['code']; $source = 'custom'; break 2;
                    }
                }
            }
        }
        foreach ($items as $item) if ($item['code'] === $code) {
            return ['code'=>$code, 'name'=>$item['name'], 'source'=>$source];
        }
        return ['code'=>'other', 'name'=>'其他', 'source'=>'unknown'];
    }

    private static function matches(string $alias, string $ua): bool
    {
        return (bool)preg_match('/^'.preg_quote($alias,'/').'(?=$|[\/\s_-])/i', $ua);
    }

    public static function validate(array $rules): array
    {
        abort_if(count($rules) > count(SubscriptionClientRegistry::CLIENTS), 422, '客户端数量超出范围。');
        $aliases = [];
        foreach (SubscriptionClientRegistry::CLIENTS as $code=>$definition) {
            foreach (ClientIdentity::matchingAliases($code) as $alias) $aliases[] = [$code,$alias];
        }
        $result = [];
        foreach ($rules as $code=>$rule) {
            abort_unless(isset(SubscriptionClientRegistry::CLIENTS[$code]) && is_array($rule),422,'客户端代码不可新增或修改。');
            abort_if(array_diff(array_keys($rule),['name','aliases','priority']),422,'不支持的规则字段。');
            $name = $rule['name'] ?? null; $list = $rule['aliases'] ?? null; $priority = $rule['priority'] ?? null;
            abort_unless(is_string($name) && trim($name)!=='' && mb_strlen($name)<=100 && !preg_match('/[<>\x00-\x1f\x7f]/u',$name),422,'名称须为 1–100 字纯文本。');
            abort_unless(is_array($list) && array_is_list($list) && count($list)<=20 && is_int($priority) && $priority>=0 && $priority<=1000,422,'别名最多 20 项，优先级须为 0–1000 的整数。');
            $clean = [];
            foreach ($list as $alias) {
                abort_unless(is_string($alias) && preg_match('/^[A-Za-z][A-Za-z0-9. _%-]{1,63}$/D',$alias) && trim($alias)===$alias,422,'别名须为 2–64 位产品名称，不支持正则表达式。');
                abort_if(preg_match('/^(Mozilla|curl|wget|okhttp|Dalvik|Python|Java|Go-http-client)(?:$|[. _%-])/i',$alias),422,'不能将通用浏览器或网络工具设为客户端别名。');
                foreach ($aliases as [$owner,$existing]) {
                    abort_if(strcasecmp($existing,$alias)===0 || ($owner!==$code && (self::matches($existing,$alias) || self::matches($alias,$existing))),422,'客户端别名重复或与现有规则冲突：'.$alias);
                }
                $aliases[] = [$code,$alias]; $clean[] = $alias;
            }
            $result[$code] = ['name'=>trim($name),'aliases'=>$clean,'priority'=>$priority];
        }
        return $result;
    }

    public function save(array $rules, int $version, int $actor): void
    {
        $rules = self::validate($rules);
        DB::transaction(function() use($rules,$version,$actor) {
            DB::table('v2_client_recognition')->insertOrIgnore(['id'=>1,'rules'=>'{}','version'=>0,'updated_by'=>$actor,'updated_at'=>time()]);
            $row=DB::table('v2_client_recognition')->where('id',1)->lockForUpdate()->first();
            abort_unless((int)$row->version===$version,409,'识别库已被其他管理员修改，请重新加载后重试。');
            DB::table('v2_client_recognition')->where('id',1)->update(['rules'=>json_encode((object)$rules,JSON_UNESCAPED_UNICODE),'version'=>$version+1,'updated_by'=>$actor,'updated_at'=>time()]);
        });
        $this->snapshot = null;
        $this->catalogCache = null;
        \Log::info('Client recognition updated',['administrator_id'=>$actor,'version'=>$version+1]);
    }
}
