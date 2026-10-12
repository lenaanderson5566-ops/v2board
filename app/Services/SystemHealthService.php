<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use App\Utils\CacheKey;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;

class SystemHealthService
{
    public function inspect(): array
    {
        $checks = [];
        $check = function (string $key, string $label, callable $probe) use (&$checks) {
            try { $result = $probe(); }
            catch (\Throwable $e) { $result = ['status' => 'error', 'message' => '检查失败，请查看系统日志与服务器配置']; }
            $checks[] = ['key' => $key, 'label' => $label] + $result;
        };
        $check('database', '数据库', function () {
            DB::select('SELECT 1');
            return ['status' => 'healthy', 'message' => '数据库连接正常'];
        });
        $check('redis', 'Redis', function () {
            Redis::connection()->ping();
            return ['status' => 'healthy', 'message' => 'Redis 连接正常'];
        });
        $check('cache', '缓存', function () {
            Cache::get('SYSTEM_HEALTH_READ_PROBE');
            return ['status' => 'healthy', 'message' => '缓存读取正常'];
        });
        $check('scheduler', '定时任务', function () {
            $last = (int) Cache::get(CacheKey::get('SCHEDULE_LAST_CHECK_AT', null));
            return ['status' => $last && $last >= time() - 180 ? 'healthy' : 'error',
                'message' => $last && $last >= time() - 180 ? '最近 3 分钟内执行过定时任务' : '未收到近期执行心跳，请检查 cron / schedule:work',
                'lastRunAt' => $last ?: null];
        });
        $check('queue', 'Horizon 队列', function () {
            $masters = collect(app(MasterSupervisorRepository::class)->all());
            $healthy = $masters->isNotEmpty() && $masters->every(fn ($master) => $master->status === 'running');
            return ['status' => $healthy ? 'healthy' : 'error', 'message' => $healthy ? '队列主进程运行中' : '队列主进程未运行或已暂停'];
        });
        $check('migrations', '数据库迁移', function () {
            $migrator = app('migrator');
            $files = $migrator->getMigrationFiles(database_path('migrations'));
            $ran = $migrator->repositoryExists() ? $migrator->getRepository()->getRan() : [];
            $pending = MigrationHealthService::pending($files, $ran,
                \Illuminate\Support\Facades\Schema::hasTable('failed_jobs'));
            return ['status' => $pending ? 'warning' : 'healthy',
                'message' => $pending ? '存在未执行迁移，请按升级流程运行 update.sh' : '数据库迁移已完成', 'pendingCount' => count($pending)];
        });
        return ['checks' => $checks, 'checkedAt' => time(), 'phpVersion' => PHP_VERSION,
            'frameworkVersion' => app()->version(), 'status' => collect($checks)->contains('status', 'error') ? 'error' : (collect($checks)->contains('status', 'warning') ? 'warning' : 'healthy')];
    }
}
