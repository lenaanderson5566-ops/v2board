<?php
namespace App\Console\Commands;
use App\Models\Plan;
use App\Models\User;
use App\Services\TimeZones;
use App\Services\TrafficResetSchedule;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class ResetTraffic extends Command {
    protected $signature='reset:traffic';
    protected $description='Reset due period traffic once per user and business date';
    public function handle(): int {
        $now=time();
        $zone=TimeZones::system();
        $local=(new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone($zone));
        $date=$local->format('Y-m-d');
        $methods=Plan::pluck('reset_traffic_method','id');
        Redis::setex('traffic_reset_lock',300,1);
        try {
            User::whereNotNull('expired_at')->where('expired_at','>',$now)->orderBy('id')->chunkById(500,function ($users) use ($methods,$now,$date,$zone) {
                Redis::setex('traffic_reset_lock',300,1);
                foreach ($users as $candidate) {
                    $method=(int)($methods[$candidate->plan_id]??config('fastai.reset_traffic_method',0));
                    if (!TrafficResetSchedule::due($method,(int)$candidate->expired_at,$now,$zone,$candidate->traffic_reset_anchor_at)) continue;
                    DB::transaction(function () use ($candidate,$methods,$now,$date,$zone) {
                        $user=User::where('id',$candidate->id)->lockForUpdate()->first();
                        if (!$user || !$user->plan_id || !$methods->has($user->plan_id)) return;
                        $method=(int)($methods[$user->plan_id]??config('fastai.reset_traffic_method',0));
                        if (!TrafficResetSchedule::due($method,(int)$user->expired_at,$now,$zone,$user->traffic_reset_anchor_at)) return;
                        if (!DB::table('v2_daily_user_reset')->insertOrIgnore(['user_id'=>$user->id,'business_date'=>$date])) return;
                        $user->u=0; $user->d=0; $user->save();
                    },3);
                }
            });
            DB::table('v2_daily_user_reset')->where('business_date','<',$local->modify('-400 days')->format('Y-m-d'))->delete();
        } finally { Redis::del('traffic_reset_lock'); }
        return 0;
    }
}
