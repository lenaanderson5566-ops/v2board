<?php
namespace App\Console\Commands;
use App\Models\Plan;
use App\Models\User;
use App\Services\TrafficResetSchedule;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class ResetTraffic extends Command {
    protected $signature='reset:traffic';
    protected $description='Reset due period traffic once per user and business date';
    public function handle(): int {
        $now=time(); $date=date('Y-m-d',$now);
        $methods=Plan::pluck('reset_traffic_method','id');
        Redis::setex('traffic_reset_lock',300,1);
        try {
            User::whereNotNull('expired_at')->where('expired_at','>',$now)->orderBy('id')->chunkById(500,function ($users) use ($methods,$now,$date) {
                Redis::setex('traffic_reset_lock',300,1);
                foreach ($users as $candidate) {
                    $method=(int)($methods[$candidate->plan_id]??config('v2board.reset_traffic_method',0));
                    if (!TrafficResetSchedule::due($method,(int)$candidate->expired_at,$now)) continue;
                    DB::transaction(function () use ($candidate,$methods,$now,$date) {
                        $user=User::where('id',$candidate->id)->lockForUpdate()->first();
                        if (!$user || !$user->plan_id || !$methods->has($user->plan_id)) return;
                        $method=(int)($methods[$user->plan_id]??config('v2board.reset_traffic_method',0));
                        if (!TrafficResetSchedule::due($method,(int)$user->expired_at,$now)) return;
                        if (!DB::table('v2_daily_user_reset')->insertOrIgnore(['user_id'=>$user->id,'business_date'=>$date])) return;
                        $user->u=0; $user->d=0; $user->save();
                    },3);
                }
            });
            DB::table('v2_daily_user_reset')->where('business_date','<',date('Y-m-d',strtotime('-400 days',$now)))->delete();
        } finally { Redis::del('traffic_reset_lock'); }
        return 0;
    }
}
