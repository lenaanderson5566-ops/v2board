<?php
namespace App\Services;

use Illuminate\Support\Facades\{DB, Schema};

/** Request-scoped display overrides. Never used for GeoIP, flags or business enums. */
final class NodeDictionary
{
    private ?array $rows = null;
    private ?array $catalog = null;
    public function rows(): array
    {
        return $this->rows ??= Schema::hasTable('v2_node_dictionary')
            ? DB::table('v2_node_dictionary')->get()->keyBy('key')->all() : [];
    }
    public function reset(): void { $this->rows = null; $this->catalog = null; }
    public function catalog(callable $build): array { return $this->catalog ??= $build(); }
    public function apply(string $kind, array $defaults): array
    {
        foreach ($this->rows() as $key=>$row) {
            [$type,$code]=explode(':',$key,2);
            if ($type===$kind && isset($defaults[$code])) $defaults[$code]=array_replace($defaults[$code],json_decode($row->names,true,512,JSON_THROW_ON_ERROR));
        }
        return $defaults;
    }
    public static function defaults(): array
    {
        static $defaults;
        return $defaults ??= [
            'regions'=>json_decode(file_get_contents(resource_path('client/node-countries.json')),true,512,JSON_THROW_ON_ERROR),
            'cities'=>json_decode(file_get_contents(resource_path('client/node-locations.json')),true,512,JSON_THROW_ON_ERROR)['cities'],
        ];
    }
    public function save(array $data, int $actor): void
    {
        $defaults=self::defaults();
        abort_unless(isset($defaults[$data['kind']][$data['code']]),422,'字典代码不存在，不能更改代码或归属关系。');
        $names=[];
        foreach ($data['names'] as $language=>$name) {
            abort_unless(in_array($language,LanguagePreferenceService::SUPPORTED,true),422,'不支持的语言。');
            abort_unless(is_string($name) && mb_strlen($name)<=100 && !preg_match('/[<>\x00-\x1f\x7f]/u',$name),422,'名称必须是 100 字以内的纯文本。');
            $name=trim($name);
            if ($name!=='' && $name!==($defaults[$data['kind']][$data['code']][$language] ?? '')) $names[$language]=$name;
        }
        $key=$data['kind'].':'.$data['code'];
        DB::transaction(function() use($data,$names,$key,$actor) {
            DB::table('v2_node_dictionary')->insertOrIgnore(['key'=>$key,'names'=>'{}','version'=>0,'updated_at'=>time(),'updated_by'=>$actor]);
            $row=DB::table('v2_node_dictionary')->where('key',$key)->lockForUpdate()->first();
            abort_unless((int)$row->version===(int)$data['version'],409,'该字典项已被其他管理员修改，请刷新后重试。');
            DB::table('v2_node_dictionary')->where('key',$key)->update(['names'=>json_encode((object)$names,JSON_UNESCAPED_UNICODE),'version'=>$row->version+1,'updated_at'=>time(),'updated_by'=>$actor]);
        });
        $this->reset();
        \Log::info('Node dictionary updated',['key'=>$key,'administrator_id'=>$actor,'action'=>$names ? 'update' : 'restore']);
    }
}
