<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Log as LogModel;
use App\Utils\CacheKey;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Horizon\Contracts\JobRepository;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;
use Laravel\Horizon\Contracts\MetricsRepository;
use Laravel\Horizon\Contracts\SupervisorRepository;
use Laravel\Horizon\Contracts\WorkloadRepository;
use Laravel\Horizon\WaitTimeCalculator;

class SystemController extends Controller
{
    public function health()
    {
        return response(['data' => (new \App\Services\SystemHealthService())->inspect()]);
    }

    public function getSystemStatus()
    {
        return response([
            'data' => [
                'schedule' => $this->getScheduleStatus(),
                'horizon' => $this->getHorizonStatus(),
                'schedule_last_runtime' => Cache::get(CacheKey::get('SCHEDULE_LAST_CHECK_AT', null))
            ]
        ]);
    }

    public function getQueueWorkload(WorkloadRepository $workload)
    {
        return response([
            'data' => collect($workload->get())->sortBy('name')->values()->toArray()
        ]);
    }

    public function getQueueMasters(MasterSupervisorRepository $masters, SupervisorRepository $supervisors)
    {
        $items = app(\Laravel\Horizon\Http\Controllers\MasterSupervisorController::class)->index($masters, $supervisors);
        return response(['data' => $items->values()->toArray()]);
    }

    protected function getScheduleStatus():bool
    {
        return (time() - 120) < Cache::get(CacheKey::get('SCHEDULE_LAST_CHECK_AT', null));
    }

    protected function getHorizonStatus():bool
    {
        if (! $masters = app(MasterSupervisorRepository::class)->all()) {
            return false;
        }

        return collect($masters)->contains(function ($master) {
            return $master->status === 'paused';
        }) ? false : true;
    }

    public function getQueueStats()
    {
        return response([
            'data' => [
                'failedJobs' => app(JobRepository::class)->countRecentlyFailed(),
                'jobsPerMinute' => app(MetricsRepository::class)->jobsProcessedPerMinute(),
                'pausedMasters' => $this->totalPausedMasters(),
                'periods' => [
                    'failedJobs' => config('horizon.trim.recent_failed', config('horizon.trim.failed')),
                    'recentJobs' => config('horizon.trim.recent'),
                ],
                'processes' => $this->totalProcessCount(),
                'queueWithMaxRuntime' => app(MetricsRepository::class)->queueWithMaximumRuntime(),
                'queueWithMaxThroughput' => app(MetricsRepository::class)->queueWithMaximumThroughput(),
                'recentJobs' => app(JobRepository::class)->countRecent(),
                'status' => $this->getHorizonStatus(),
                'wait' => collect(app(WaitTimeCalculator::class)->calculate())->take(1),
            ]
        ]);
    }

    /**
     * Get the total process count across all supervisors.
     *
     * @return int
     */
    protected function totalProcessCount()
    {
        $supervisors = app(SupervisorRepository::class)->all();

        return collect($supervisors)->reduce(function ($carry, $supervisor) {
            return $carry + collect($supervisor->processes)->sum();
        }, 0);
    }

    /**
     * Get the number of master supervisors that are currently paused.
     *
     * @return int
     */
    protected function totalPausedMasters()
    {
        if (! $masters = app(MasterSupervisorRepository::class)->all()) {
            return 0;
        }

        return collect($masters)->filter(function ($master) {
            return $master->status === 'paused';
        })->count();
    }

    public function getSystemLog(Request $request) {
        $params=$request->validate([
            'current'=>'nullable|integer|min:1','page_size'=>'nullable|integer|min:1|max:100',
            'level'=>'nullable|in:DEBUG,INFO,NOTICE,WARNING,ERROR,CRITICAL,ALERT,EMERGENCY',
            'status'=>'nullable|integer|between:100,599','request_id'=>'nullable|uuid',
            'from'=>'nullable|integer|min:0','to'=>'nullable|integer|min:0',
        ]);
        if (isset($params['from'],$params['to']) && $params['to']<$params['from']) abort(422,'结束时间不能早于开始时间');
        $builder=LogModel::orderByDesc('created_at')->orderByDesc('id')->setFilterAllowKeys('level');
        foreach (['level'=>'level','status'=>'http_status','request_id'=>'request_id'] as $input=>$column) if (isset($params[$input])) $builder->where($column,$input==='request_id' ? strtolower($params[$input]) : $params[$input]);
        if (isset($params['from'])) $builder->where('created_at','>=',$params['from']);
        if (isset($params['to'])) $builder->where('created_at','<=',$params['to']);
        $total=(clone $builder)->count();
        $rows=$builder->select(['id','title','level','method','route_template','request_id','http_status','duration_ms','created_at'])->forPage($params['current'] ?? 1,$params['page_size'] ?? 20)->get();
        return response(['data'=>$rows->map(fn($row)=>\App\Services\SystemLogService::resource($row)),'total'=>$total]);
    }
    public function getLogRetention(\App\Services\LogRetentionService $service) {
        return ['data'=>['settings'=>$service->configuration(),'lastRun'=>\Illuminate\Support\Facades\Cache::get('LOG_RETENTION_LAST_RUN')]];
    }
    public function saveLogRetention(Request $request, \App\Services\LogRetentionService $service) {
        return ['data'=>$service->save($request->only(array_merge(array_keys(\App\Services\LogRetentionService::DEFAULTS), ['connection_log_interval'])))];
    }
}
