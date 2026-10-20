<?php
namespace App\Services;

use App\Models\RiskSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class ObservabilitySettings
{
    public const DEFAULTS = [
        'sample_percent'=>10, 'slow_request_ms'=>2000, 'slow_query_ms'=>200,
        'error_percent'=>5, 'slow_percent'=>20, 'min_samples'=>20,
        'queue_length'=>100, 'queue_wait_seconds'=>60, 'failed_jobs'=>1,
    ];
    private ?array $values = null;

    public function get(): array
    {
        return $this->values ??= Cache::remember('observability:settings:v1',60,function() {
            $saved=RiskSetting::whereIn('key',array_map(fn($key)=>'observability_'.$key,array_keys(self::DEFAULTS)))->pluck('value','key');
            $values=self::DEFAULTS;
            foreach ($values as $key=>$default) {
                $value=$saved['observability_'.$key] ?? null;
                if ($value!==null && filter_var($value,FILTER_VALIDATE_INT)!==false) $values[$key]=(int)$value;
            }
            return $values;
        });
    }

    public function save(array $values): array
    {
        abort_if(array_diff(array_keys($values),array_keys(self::DEFAULTS)),422,'不支持的监控设置。');
        $rules=[];
        foreach (['sample_percent'=>'0,100','slow_request_ms'=>'100,60000','slow_query_ms'=>'10,10000',
            'error_percent'=>'1,100','slow_percent'=>'1,100','min_samples'=>'5,10000',
            'queue_length'=>'1,1000000','queue_wait_seconds'=>'1,86400','failed_jobs'=>'1,100000'] as $key=>$range) {
            $rules[$key]='sometimes|required|integer|between:'.$range;
        }
        $values=validator($values,$rules)->validate();
        DB::transaction(function() use($values) {
            foreach ($values as $key=>$value) RiskSetting::updateOrCreate(['key'=>'observability_'.$key],['value'=>(string)$value]);
        });
        Cache::forget('observability:settings:v1');$this->values=null;
        return $this->get();
    }
}
