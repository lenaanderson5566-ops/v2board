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
        $idList=$users->pluck('id')->all();
        try {
            DB::beginTransaction();
            // Lock recipients and their inviters together in ID order to avoid reciprocal-invite deadlocks.
            $inviterIds = User::whereIn('id', $idList)->whereNotNull('invite_user_id')->pluck('invite_user_id')->all();
            User::whereIn('id', array_unique(array_merge($idList, $inviterIds)))->orderBy('id')->lockForUpdate()->get(['id']);
            $casesU=[]; $casesD=[]; $now=time();
            foreach(User::whereIn('id',$idList)->orderBy('id')->lockForUpdate()->get() as $user) {
                $upload=max(0,(int)($uploads[$user->id]??0));
                $download=max(0,(int)($downloads[$user->id]??0));
                $base=\App\Services\TrafficCreditService::hasPeriod($user)?(int)$user->transfer_enable:0;
                $used=(int)$user->u+(int)$user->d;
                $debit=max(0,$used+$upload+$download-$base)-max(0,$used-$base);
                if ((int)($user->getAttributes()['credit_balance'] ?? 0)>0) {
                    \App\Services\CreditExpiryService::consume($user,$debit); $user->save();
                }
                $casesU[]="WHEN {$user->id} THEN u + {$upload}";
                $casesD[]="WHEN {$user->id} THEN d + {$download}";
            }
            $uSql=implode(' ',$casesU); $dSql=implode(' ',$casesD); $ids=implode(',',$idList);
            DB::statement("UPDATE v2_user SET u=CASE id {$uSql} END, d=CASE id {$dSql} END, t={$now}, updated_at={$now} WHERE id IN ({$ids})");
            // Reward only actual positive server-reported usage, never a page visit or client claim.
            $candidates = DB::table('v2_invitation_reward')->whereIn('user_id', $idList)->whereNull('first_use_at')->where('first_use_bytes', '>', 0)->pluck('user_id');
            foreach ($candidates as $id) {
                if (max(0, (int)($uploads[$id] ?? 0)) + max(0, (int)($downloads[$id] ?? 0)) > 0)
                    (new \App\Services\InvitationRewardService())->firstUse((int)$id);
            }
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('流量更新失败: ' . $e->getMessage());
            return;
        }
    }
}
