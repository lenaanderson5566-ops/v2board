<?php
namespace App\Services;
use App\Models\RiskSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LogRetentionService {
    // New categories stay opt-in so deploying this code does not erase historical records.
    public const DEFAULTS=['system_log_retention_days'=>30,'connection_log_retention_days'=>30,'login_log_retention_days'=>0,'subscribe_log_retention_days'=>0,'risk_log_retention_days'=>0,'ddns_log_retention_days'=>30];
    public const TABLES=[
        'system_log_retention_days'=>['v2_log','created_at'],
        'connection_log_retention_days'=>['v2_user_connection_log','connected_at'],
        'login_log_retention_days'=>['v2_login_log','created_at'],
        'subscribe_log_retention_days'=>['v2_subscribe_log','created_at'],
        'risk_log_retention_days'=>['v2_risk_rule_hit','hit_at'],
        'ddns_log_retention_days'=>['v2_ddns_event','created_at'],
    ];
    public function settings(): array {
        $values=RiskSetting::whereIn('key',array_keys(self::DEFAULTS))->pluck('value','key');
        $result=self::DEFAULTS;
        foreach ($result as $key=>$default) {
            $raw=$values[$key] ?? null;
            if ($raw===null || filter_var($raw,FILTER_VALIDATE_INT)===false) continue;
            $value=(int)$raw;
            $optional=in_array($key,['login_log_retention_days','subscribe_log_retention_days','risk_log_retention_days'],true);
            if ($value<=365 && ($value>=($optional ? 30 : 1) || ($optional && $value===0))) $result[$key]=$value;
        }
        return $result;
    }
    public function configuration(): array {
        $interval=(int) RiskSetting::where('key','connection_log_interval')->value('value');
        return $this->settings()+['connection_log_interval'=>($interval>=60 && $interval<=86400) ? $interval : 3600];
    }
    public function save(array $values): array {
        $rules=[];
        foreach (self::DEFAULTS as $key=>$default) $rules[$key]='sometimes|required|integer|between:'.(in_array($key,['login_log_retention_days','subscribe_log_retention_days','risk_log_retention_days']) ? '0' : '1').',365';
        $rules['connection_log_interval']='sometimes|required|integer|between:60,86400';
        $values=validator($values,$rules)->validate();
        foreach (['login_log_retention_days','subscribe_log_retention_days','risk_log_retention_days'] as $key) {
            if (isset($values[$key]) && $values[$key]>0 && $values[$key]<30) throw \Illuminate\Validation\ValidationException::withMessages([$key=>'请填写 0（不自动清理）或 30 至 365 天，以保留最近 30 天统计。']);
        }
        DB::transaction(function () use ($values) {
            foreach ($values as $key=>$value) RiskSetting::updateOrCreate(['key'=>$key],['value'=>(string)$value]);
        });
        Cache::forget('RISK_CONNECTION_LOG_RETENTION_DAYS');
        Cache::forget('RISK_CONNECTION_LOG_INTERVAL');
        return $this->configuration();
    }
    private function expired(string $key, int $cutoff) {
        [$table,$column]=self::TABLES[$key];
        $q=DB::table($table)->where($column,'<',$cutoff);
        if ($key==='risk_log_retention_days') {
            // Keep unreviewed/pending cases and recent review history, including cases
            // whose original hit is old. Recheck on DELETE to respect concurrent reviews.
            $q->whereIn('payload->review->state',['confirmed','false_positive','ignored'])
                ->where(function($q) use($cutoff) { $q->whereNull('updated_at')->orWhere('updated_at','<',$cutoff); });
        }
        return $q;
    }
    public function prune(int $batchSize=1000, int $rounds=5, ?int $now=null): array {
        $now=$now ?? time(); $deadline=microtime(true)+20;
        $settings=$this->settings(); $counts=array_fill_keys(array_keys(self::TABLES),0);
        // Each table gets one small batch per round; no long transaction or full-table DELETE.
        for ($round=0;$round<$rounds;$round++) {
            foreach ($settings as $key=>$days) {
                if (!$days) continue;
                [$table,$column]=self::TABLES[$key];
                $q=$this->expired($key,$now-$days*86400);
                $ids=(clone $q)->orderBy($column)->orderBy('id')->limit($batchSize)->pluck('id');
                if ($ids->isNotEmpty()) $counts[$key]+=$q->whereIn('id',$ids)->delete();
                if (microtime(true)>$deadline) return $counts;
            }
        }
        return $counts;
    }
}
