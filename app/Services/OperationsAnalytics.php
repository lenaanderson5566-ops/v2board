<?php
namespace App\Services;

use App\Console\Commands\RunDailyTask;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Horizon\Contracts\WorkloadRepository;

/** Read-only aggregates. Never return log payloads, identities or channel credentials. */
final class OperationsAnalytics
{
    private function window(string $table, string $time, int $from, int $to)
    {
        return DB::table($table)->where($time, '>=', $from)->where($time, '<=', $to);
    }

    public static function rate(int $part, int $total): ?float
    {
        return $total ? round($part / $total, 4) : null;
    }

    private function access(string $table, bool $login, int $from, int $to): array
    {
        if (!Schema::hasTable($table)) return ['available'=>false];
        $q = $this->window($table, 'created_at', $from, $to);
        $success = $login ? 'is_success = 1' : "status = 'success'";
        $failure = $login ? 'is_success = 0' : "status = 'failed'";
        $row = (clone $q)->selectRaw("COUNT(*) AS total, SUM(CASE WHEN $success THEN 1 ELSE 0 END) AS success, SUM(CASE WHEN $failure THEN 1 ELSE 0 END) AS failed, MAX(created_at) AS latest")->first();
        // Historical exception strings are intentionally reduced to a fixed category.
        $allowed = $login ? ['user_not_found','password_error','user_banned'] :
            ['client_disabled','client_version_too_low','client_ua_not_allowed','client_format_not_allowed','banned','no_plan','expired','traffic_exhausted','user_unavailable'];
        $expression = 'CASE WHEN reason IN ('.implode(',', array_fill(0, count($allowed), '?')).") THEN reason ELSE 'other' END";
        $reasons = DB::query()->fromSub((clone $q)->whereRaw($failure)->selectRaw("$expression AS category", $allowed),'failures')
            ->select('category')->selectRaw('COUNT(*) AS count')->groupBy('category')->orderByDesc('count')->orderBy('category')
            ->get()->map(fn($r)=>['reason'=>$r->category,'count'=>(int)$r->count])->all();
        return ['available'=>true,'total'=>(int)$row->total,'success'=>(int)$row->success,'failed'=>(int)$row->failed,
            'unknown'=>(int)$row->total-(int)$row->success-(int)$row->failed,
            'successRate'=>self::rate((int)$row->success,(int)$row->total),'latestAt'=>$row->latest ? gmdate('c',$row->latest) : null,'reasons'=>$reasons,'clients'=>$this->clients($q,$success,$failure)];
    }

    private function clients($q, string $success, string $failure): array
    {
        $category=BrowserAccess::logCategorySql();
        $browsers=DB::query()->fromSub((clone $q)->selectRaw("$category AS category, CASE WHEN $success THEN 1 ELSE 0 END AS succeeded, CASE WHEN $failure THEN 1 ELSE 0 END AS failed"),'clients')
            ->select('category')->selectRaw('COUNT(*) AS total, SUM(succeeded) AS success, SUM(failed) AS failed')->groupBy('category')->orderByDesc('total')->orderBy('category')->get()
            ->map(fn($r)=>['category'=>$r->category,'total'=>(int)$r->total,'success'=>(int)$r->success,'failed'=>(int)$r->failed])->all();
        // MySQL INET6_ATON canonicalizes IPv6 spellings and excludes invalid historical input.
        $ipQuery=(clone $q)->whereRaw('INET6_ATON(ip) IS NOT NULL');
        $unique=(clone $ipQuery)->selectRaw('COUNT(DISTINCT INET6_ATON(ip)) AS total')->first();
        $top=(clone $ipQuery)->selectRaw("HEX(INET6_ATON(ip)) AS packed, COUNT(*) AS total, SUM(CASE WHEN $failure THEN 1 ELSE 0 END) AS failed, COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id ELSE NULL END) AS accounts")
            ->groupBy('packed')->orderByDesc('failed')->orderByDesc('total')->orderBy('packed')->limit(20)->get()
            ->map(fn($r)=>['maskedIp'=>GeoIpService::maskSessionIp(inet_ntop(hex2bin($r->packed))),'total'=>(int)$r->total,'failed'=>(int)$r->failed,'accounts'=>(int)$r->accounts])->all();
        $countries=(clone $q)->selectRaw("COALESCE(NULLIF(country,''),'未知') AS location, COUNT(*) AS total")
            ->groupBy('location')->orderByDesc('total')->orderBy('location')->limit(30)->get()->map(fn($r)=>['country'=>$r->location,'total'=>(int)$r->total])->all();
        $applications=$this->applications($q,$success,$failure);
        return ['applications'=>$applications,'browsers'=>$browsers,'uniqueIps'=>(int)$unique->total,'unknownIpEvents'=>(clone $q)->whereRaw('INET6_ATON(ip) IS NULL')->count(),'topIps'=>$top,'countries'=>$countries];
    }

    private function applications($q, string $success, string $failure): array
    {
        $applications=[];
        $recognition=app(ClientRecognition::class);
        $recognition->catalog(); // Load rules before opening the UA cursor.
        // Group raw UAs in SQL; accumulate only the fixed client categories in memory.
        foreach ((clone $q)->select('user_agent')->selectRaw("COUNT(*) AS total, SUM(CASE WHEN $success THEN 1 ELSE 0 END) AS success, SUM(CASE WHEN $failure THEN 1 ELSE 0 END) AS failed")->groupBy('user_agent')->cursor() as $row) {
            $client=$recognition->identify((string)$row->user_agent); $code=$client['code'];
            $applications[$code] ??= ['code'=>$code,'name'=>$client['name'],'total'=>0,'success'=>0,'failed'=>0];
            foreach (['total','success','failed'] as $key) $applications[$code][$key]+=(int)$row->$key;
        }
        usort($applications,fn($a,$b)=>($b['total']<=>$a['total']) ?: strcmp($a['code'],$b['code']));
        return $applications;
    }

    private function risk(int $from, int $to): array
    {
        if (!Schema::hasTable('v2_risk_rule_hit')) return ['available'=>false];
        $q = $this->window('v2_risk_rule_hit','hit_at',$from,$to);
        $review = "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.review.state'))";
        $rows = $q->select('rule_key')->selectRaw("COUNT(*) AS hits, COUNT(DISTINCT user_id) AS users,
            SUM(CASE WHEN $review = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
            SUM(CASE WHEN $review = 'false_positive' THEN 1 ELSE 0 END) AS mistakes,
            SUM(CASE WHEN $review = 'ignored' THEN 1 ELSE 0 END) AS ignored")
            ->groupBy('rule_key')->orderByDesc('hits')->orderBy('rule_key')->get();
        return ['available'=>true,'rules'=>$rows->map(function ($r) {
            $reviewed=(int)$r->confirmed+(int)$r->mistakes+(int)$r->ignored;
            return ['rule'=>RiskLogService::ruleName($r->rule_key),'hits'=>(int)$r->hits,'users'=>(int)$r->users,
                'confirmed'=>(int)$r->confirmed,'falsePositive'=>(int)$r->mistakes,'ignored'=>(int)$r->ignored,
                'pending'=>(int)$r->hits-$reviewed,'coverage'=>self::rate($reviewed,(int)$r->hits),
                'falsePositiveRate'=>self::rate((int)$r->mistakes,$reviewed)];
        })->all()];
    }

    private function payments(int $from, int $to): array
    {
        if (!Schema::hasTable('v2_order') || !Schema::hasTable('v2_payment')) return ['available'=>false];
        // Channel attribution uses the order's current/final payment_id, not an invented attempt history.
        $rows = $this->window('v2_order as o','o.created_at',$from,$to)
            ->leftJoin('v2_payment as p','p.id','=','o.payment_id')->select('o.payment_id','p.name','o.currency')
            ->selectRaw('COUNT(*) AS orders, SUM(CASE WHEN o.paid_at > 0 AND o.paid_at <= ? THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN o.paid_at > 0 AND o.paid_at <= ? AND o.status IN (3,4) THEN 1 ELSE 0 END) AS completed,
                AVG(CASE WHEN o.paid_at >= o.created_at AND o.paid_at <= ? THEN o.paid_at-o.created_at ELSE NULL END) AS wait_seconds',[$to,$to,$to])
            ->groupBy('o.payment_id','p.name','o.currency')->orderByDesc('orders')->orderBy('o.payment_id')->orderBy('o.currency')->get();
        $pending = DB::table('v2_order')->where('status',1)->where('paid_at','>',0)->where('paid_at','<=',$to);
        $oldest = (clone $pending)->min('paid_at');
        $events = Schema::hasTable('v2_payment_callback_event');
        $callbacks = $events ? $this->window('v2_payment_callback_event as e','e.created_at',$from,$to)
            ->leftJoin('v2_payment as p','p.id','=','e.payment_id')->select('e.payment_id','p.name')
            ->selectRaw("COUNT(*) AS total, SUM(CASE WHEN e.result='handled' THEN 1 ELSE 0 END) AS handled,
                SUM(CASE WHEN e.result='failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN e.result='acknowledged' THEN 1 ELSE 0 END) AS acknowledged")
            ->groupBy('e.payment_id','p.name')->orderByDesc('total')->orderBy('e.payment_id')->get()->map(fn($r)=>[
                'channel'=>$r->name ?? ($r->payment_id ? '已删除渠道 #'.$r->payment_id : '未识别渠道'),
                'total'=>(int)$r->total,'handled'=>(int)$r->handled,'failed'=>(int)$r->failed,'acknowledged'=>(int)$r->acknowledged,
            ])->all() : [];
        return ['available'=>true,'channels'=>$rows->map(fn($r)=>[
            'channel'=>$r->name ?? ($r->payment_id ? '已删除渠道 #'.$r->payment_id : '余额／零元／未选择渠道'),
            'currency'=>$r->currency,'orders'=>(int)$r->orders,'paid'=>(int)$r->paid,'completed'=>(int)$r->completed,
            'paidRate'=>self::rate((int)$r->paid,(int)$r->orders),'averagePaymentWaitSeconds'=>$r->wait_seconds===null ? null : (int)round($r->wait_seconds),
        ])->all(),'callbacksAvailable'=>$events,'callbacks'=>$callbacks,'pendingActivation'=>$pending->count(),
            'oldestActivationWaitSeconds'=>$oldest ? max(0,$to-$oldest) : null];
    }

    private function mail(int $from, int $to): array
    {
        if (!Schema::hasTable('v2_mail_log')) return ['available'=>false];
        $rows = $this->window('v2_mail_log','created_at',$from,$to)->select('provider','stream')
            ->selectRaw("COUNT(*) AS total,
                SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status='uncertain' OR (status='sending' AND created_at < ?) THEN 1 ELSE 0 END) AS uncertain,
                SUM(CASE WHEN delivery_status='delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN delivery_status IN ('bounced','rejected','complained') THEN 1 ELSE 0 END) AS negative,
                AVG(duration_ms) AS duration, MAX(created_at) AS latest",[$to-120])
            ->groupBy('provider','stream')->orderByDesc('total')->orderBy('provider')->orderBy('stream')->get();
        return ['available'=>true,'providers'=>$rows->map(fn($r)=>[
            'provider'=>in_array($r->provider,['smtp','mailgun','ses','resend'],true) ? $r->provider : 'legacy',
            'stream'=>in_array($r->stream,['transactional','announcement'],true) ? $r->stream : 'legacy',
            'total'=>(int)$r->total,'accepted'=>(int)$r->accepted,'failed'=>(int)$r->failed,'uncertain'=>(int)$r->uncertain,
            'other'=>(int)$r->total-(int)$r->accepted-(int)$r->failed-(int)$r->uncertain,
            'acceptedRate'=>self::rate((int)$r->accepted,(int)$r->total),'delivered'=>(int)$r->delivered,'negative'=>(int)$r->negative,
            'averageTransportMs'=>$r->duration===null ? null : (int)round($r->duration),
            'latestAt'=>$r->latest ? gmdate('c',$r->latest) : null,
        ])->all()];
    }

    private function health(int $now): array
    {
        $health = app(SystemHealthService::class)->inspect();
        try {
            $queues = collect(app(WorkloadRepository::class)->get())->map(fn($r)=>[
                'name'=>(string)$r['name'],'length'=>(int)$r['length'],'waitSeconds'=>(int)$r['wait'],'processes'=>(int)$r['processes'],
            ])->values()->all();
        } catch (\Throwable $e) { $queues = null; }
        $tasks = null;
        if (Schema::hasTable('v2_daily_task_run')) {
            $date=(new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone(TimeZones::system()));
            $today=DB::table('v2_daily_task_run')->where('business_date',$date->format('Y-m-d'))->get()->keyBy('task');
            $success=DB::table('v2_daily_task_run')->where('status','completed')->select('task')->selectRaw('MAX(updated_at) AS latest')->groupBy('task')->pluck('latest','task');
            $tasks=[];
            foreach (RunDailyTask::TASKS as $task=>$at) {
                $row=$today->get($task);
                $tasks[]=['task'=>$task,'scheduledAt'=>$at,'status'=>$row->status ?? (RunDailyTask::due($task,$date) ? 'pending' : 'not_due'),
                    'lastSuccessAt'=>isset($success[$task]) ? gmdate('c',$success[$task]) : null];
            }
        }
        $failedTable=config('queue.failed.table','failed_jobs');
        $failed=Schema::hasTable($failedTable) ? DB::table($failedTable)->count() : null;
        $prune=Cache::get('LOG_RETENTION_LAST_RUN');
        return ['checks'=>array_map(fn($r)=>['key'=>$r['key'],'label'=>$r['label'],'status'=>$r['status'],'message'=>$r['message']],$health['checks']),
            'queues'=>$queues,'failedJobsRetained'=>$failed,'dailyTasks'=>$tasks,
            'lastPruneAt'=>is_array($prune) && isset($prune['at']) ? gmdate('c',$prune['at']) : null];
    }

    public function report(int $days): array
    {
        $now=time();
        $from=(new \DateTimeImmutable('tomorrow',new \DateTimeZone(TimeZones::system())))->modify('-'.$days.' days')->getTimestamp();
        return ['from'=>gmdate('c',$from),'to'=>gmdate('c',$now),'generatedAt'=>gmdate('c',$now),'timeZone'=>TimeZones::system(),
            'retention'=>(new LogRetentionService())->settings(),
            'login'=>$this->access('v2_login_log',true,$from,$now),'subscription'=>$this->access('v2_subscribe_log',false,$from,$now),
            'risk'=>$this->risk($from,$now),'payments'=>$this->payments($from,$now),'mail'=>$this->mail($from,$now),'health'=>$this->health($now)];
    }
}
