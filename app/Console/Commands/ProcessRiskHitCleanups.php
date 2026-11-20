<?php

namespace App\Console\Commands;

use App\Services\RiskHitCleanup;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProcessRiskHitCleanups extends Command
{
    protected $signature = 'risk:process-cleanups';
    protected $description = 'Process confirmed risk hit cleanups in bounded transactions';

    public function handle(RiskHitCleanup $cleanup): int
    {
        $deadline = microtime(true) + 45;
        $result = self::SUCCESS;
        do {
            $ids = DB::table('v2_risk_cleanup_task')->whereIn('state', ['queued', 'running'])
                ->orderBy('updated_at')->orderBy('id')->limit(16)->pluck('id');
            foreach ($ids as $id) {
                try {
                    $cleanup->processBatch((int) $id);
                } catch (\Throwable $error) {
                    $cleanup->markFailed((int) $id);
                    Log::error('Risk hit cleanup batch failed', ['taskId' => (int) $id, 'exceptionType' => get_class($error)]);
                    $result = self::FAILURE;
                }
                if (microtime(true) >= $deadline) {
                    break;
                }
            }
        } while ($ids->isNotEmpty() && microtime(true) < $deadline);

        $cleanup->purgeExpired();
        return $result;
    }
}
