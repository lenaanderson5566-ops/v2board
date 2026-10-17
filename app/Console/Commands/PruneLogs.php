<?php
namespace App\Console\Commands;
use App\Services\LogRetentionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
class PruneLogs extends Command {
    protected $signature='logs:prune';
    protected $description='Prune expired logs in bounded batches using configured retention';
    public function handle(LogRetentionService $service) {
        $lock=Cache::lock('LOG_RETENTION_PRUNE_LOCK',300);
        if (!$lock->get()) return 0;
        $start=microtime(true);
        try {
            $counts=$service->prune();
            $counts['analytics_sessions']=app(\App\Services\ProductAnalytics::class)->prune();
            $indexed=(new \App\Services\SystemLogService())->backfill();
            Cache::put('LOG_RETENTION_LAST_RUN',['at'=>time(),'durationMs'=>(int)round((microtime(true)-$start)*1000),'deleted'=>$counts,'indexed'=>$indexed],172800);
            $this->info('Expired log cleanup completed: '.array_sum($counts).' rows');
            return 0;
        } finally { $lock->release(); }
    }
}
