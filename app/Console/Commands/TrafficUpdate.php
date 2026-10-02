<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class TrafficUpdate extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'traffic:update';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = '流量更新任务';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle()
    {
        ini_set('memory_limit', -1);
        if (Redis::exists('traffic_reset_lock')) {
            return;
        }
        $uploads = Redis::hgetall('v2board_upload_traffic');
        Redis::del('v2board_upload_traffic');
        $downloads = Redis::hgetall('v2board_download_traffic');
        Redis::del('v2board_download_traffic');
        if (empty($uploads) && empty($downloads)) {
            return;
        }

        $users = User::whereIn('id', array_unique(array_merge(array_keys($uploads), array_keys($downloads))))->get(['id']);
        if ($users->isEmpty()) return;
        $time = time();
        $casesU = [];
        $casesCredit = [];
        $casesD = [];
        $idList = [];

        foreach ($users as $user) {
            $upload = $uploads[$user->id] ?? 0;
            $download = $downloads[$user->id] ?? 0;

            // Add against the locked database value, never overwrite a concurrent usage reset.
            $delta = max(0, (int)$upload) + max(0, (int)$download);
            $base = "(CASE WHEN expired_at IS NULL OR expired_at > {$time} THEN transfer_enable ELSE 0 END)";
            $casesCredit[] = "WHEN {$user->id} THEN GREATEST(0, CAST(credit_balance AS SIGNED) - (GREATEST(0, u + d + {$delta} - {$base}) - GREATEST(0, u + d - {$base})))";
            $upload = max(0, (int)$upload);
            $download = max(0, (int)$download);
            $casesU[] = "WHEN {$user->id} THEN u + " . (int)$upload;
            $casesD[] = "WHEN {$user->id} THEN d + " . (int)$download;
            $idList[] = $user->id;
        }
        $idListStr = implode(',', $idList);
        $casesUStr = implode(' ', $casesU);
        $casesCreditStr = implode(' ', $casesCredit);
        $casesDStr = implode(' ', $casesD);
        // MySQL evaluates assignments left-to-right: calculate debit before incrementing u/d.
        $sql = "UPDATE v2_user SET credit_balance = CASE id {$casesCreditStr} END, u = CASE id {$casesUStr} END, d = CASE id {$casesDStr} END, t = {$time}, updated_at = {$time} WHERE id IN ({$idListStr})";
        try {
            DB::beginTransaction();
            DB::statement($sql);
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('流量更新失败: ' . $e->getMessage());
            return;
        }
    }
}
