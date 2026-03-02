<?php

namespace App\Console\Commands;

use App\Models\Plan;
use App\Models\User;
use App\Services\QuotaPackageService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class TrafficUpdate extends Command
{
    protected $signature = 'traffic:update';

    protected $description = '流量更新任务';

    public function __construct()
    {
        parent::__construct();
    }

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

        $idMap = array_fill_keys(array_keys($uploads), true);
        foreach (array_keys($downloads) as $id) {
            $idMap[$id] = true;
        }

        $ids = array_keys($idMap);
        $users = User::whereIn('id', $ids)->get(['id', 'u', 'd', 'plan_id', 'expired_at']);
        $plans = Plan::whereIn('id', array_filter($users->pluck('plan_id')->unique()->toArray()))
            ->pluck('transfer_enable', 'id')
            ->toArray();

        $time = time();
        $casesU = [];
        $casesD = [];
        $idList = [];
        $packageConsumeMap = [];

        foreach ($users as $user) {
            $upload = (int) ($uploads[$user->id] ?? 0);
            $download = (int) ($downloads[$user->id] ?? 0);
            $delta = $upload + $download;
            if ($delta <= 0) {
                continue;
            }

            $oldUsed = (int) $user->u + (int) $user->d;
            $baseBytes = 0;
            if ($user->plan_id && ($user->expired_at === null || $user->expired_at > $time)) {
                $baseBytes = (int) (($plans[$user->plan_id] ?? 0) * 1073741824);
            }
            $baseRemain = max($baseBytes - $oldUsed, 0);
            $packageConsume = max($delta - $baseRemain, 0);
            $packageConsumeMap[$user->id] = $packageConsume;

            $casesU[] = "WHEN {$user->id} THEN " . ($user->u + $upload);
            $casesD[] = "WHEN {$user->id} THEN " . ($user->d + $download);
            $idList[] = $user->id;
        }

        if (empty($idList)) {
            return;
        }

        $idListStr = implode(',', $idList);
        $casesUStr = implode(' ', $casesU);
        $casesDStr = implode(' ', $casesD);
        $sql = "UPDATE v2_user SET u = CASE id {$casesUStr} END, d = CASE id {$casesDStr} END, t = {$time}, updated_at = {$time} WHERE id IN ({$idListStr})";

        // 关键原则：节点上报的 u/d 落库不能被额度包逻辑影响。
        // 先单独提交上报数据，再尽力执行额度包扣减与总额度同步。
        try {
            DB::statement($sql);
        } catch (\Exception $e) {
            \Log::error('流量更新失败(u/d落库): ' . $e->getMessage());
            return;
        }

        try {
            DB::beginTransaction();
            $quotaService = new QuotaPackageService();
            foreach ($idList as $userId) {
                $freshUser = User::lockForUpdate()->find($userId);
                if (!$freshUser) {
                    continue;
                }
                $quotaService->consume($freshUser, (int) ($packageConsumeMap[$userId] ?? 0));
                $quotaService->syncUserTransferEnable($freshUser);
            }
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('额度包结算失败(不影响节点上报): ' . $e->getMessage());
        }
    }
}
