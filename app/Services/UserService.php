<?php

namespace App\Services;

use App\Jobs\StatServerJob;
use App\Jobs\StatUserJob;
use App\Jobs\TrafficFetchJob;
use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UserService
{
    private function calcResetDayByMonthFirstDay()
    {
        $today = date('d');
        $lastDay = date('d', strtotime('last day of +0 months'));
        return $lastDay - $today;
    }

    private function calcResetDayByExpireDay(int $expiredAt)
    {
        $day = date('d', $expiredAt);
        $today = date('d');
        $lastDay = date('d', strtotime('last day of +0 months'));
        if ((int)$day >= (int)$today && (int)$day >= (int)$lastDay) {
            return $lastDay - $today;
        }
        if ((int)$day >= (int)$today) {
            return $day - $today;
        }

        return $lastDay - $today + $day;
    }

    private function calcResetDayByYearFirstDay(): int
    {
        $nextYear = strtotime(date("Y-01-01", strtotime('+1 year')));
        return (int)(($nextYear - time()) / 86400);
    }

    private function calcResetDayByYearExpiredAt(int $expiredAt): int
    {
        $md = date('m-d', $expiredAt);
        $nowYear = strtotime(date("Y-{$md}"));
        $nextYear = strtotime('+1 year', $nowYear);
        if ($nowYear > time()) {
            return (int)(($nowYear - time()) / 86400);
        }
        return (int)(($nextYear - time()) / 86400);
    }

    public function getResetDay(User $user)
    {
        if (!isset($user->plan)) {
            if ($user->plan_id === NULL) return null;
            $user->plan = Plan::find($user->plan_id);
        }
        if ($user->expired_at <= time() || $user->expired_at === NULL) return null;
        // if reset method is not reset
        if ($user->plan->reset_traffic_method === 2) return null;
        switch (true) {
            case ($user->plan->reset_traffic_method === NULL): {
                $resetTrafficMethod = config('v2board.reset_traffic_method', 0);
                switch ((int)$resetTrafficMethod) {
                    // month first day
                    case 0:
                        return $this->calcResetDayByMonthFirstDay();
                    // expire day
                    case 1:
                        return $this->calcResetDayByExpireDay($user->expired_at);
                    // no action
                    case 2:
                        return null;
                    // year first day
                    case 3:
                        return $this->calcResetDayByYearFirstDay();
                    // year expire day
                    case 4:
                        return $this->calcResetDayByYearExpiredAt($user->expired_at);
                }
                break;
            }
            case ($user->plan->reset_traffic_method === 0): {
                return $this->calcResetDayByMonthFirstDay();
            }
            case ($user->plan->reset_traffic_method === 1): {
                return $this->calcResetDayByExpireDay($user->expired_at);
            }
            case ($user->plan->reset_traffic_method === 2): {
                return null;
            }
            case ($user->plan->reset_traffic_method === 3): {
                return $this->calcResetDayByYearFirstDay();
            }
            case ($user->plan->reset_traffic_method === 4): {
                return $this->calcResetDayByYearExpiredAt($user->expired_at);
            }
        }
        return null;
    }

    public function getResetAt(User $user): ?int
    {
        return $this->getResetInfo($user)['at'];
    }

    /** Read-only reset status; a pending daily run must not look like next month's reset. */
    public function getResetInfo(User $user, ?int $now = null): array
    {
        $zone = TimeZones::system();
        $result = ['at'=>null, 'state'=>null, 'timezone'=>$zone];
        $now = $now ?? time();
        if (!$user->plan_id || $user->transfer_enable <= 0 || !$user->expired_at || $user->expired_at <= $now) return $result;
        $plan = Plan::find($user->plan_id);
        if (!$plan) return $result;
        $method = (int)($plan->reset_traffic_method ?? config('v2board.reset_traffic_method', 0));
        $future = TrafficResetSchedule::next($method, (int)$user->expired_at, $now, $zone);
        $result['at'] = $future;
        $result['state'] = $future ? 'scheduled' : null;
        if (!TrafficResetSchedule::due($method, (int)$user->expired_at, $now, $zone)) return $result;
        $local = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone($zone));
        $date = $local->format('Y-m-d');
        if (DB::table('v2_daily_user_reset')->where('user_id', $user->id)->where('business_date', $date)->exists()) return $result;
        $run = DB::table('v2_daily_task_run')->where('task', 'reset:traffic')->where('business_date', $date)->first(['status']);
        if ($run && in_array($run->status, ['completed', 'skipped_upgrade'], true)) return $result;
        $result['at'] = $local->setTime(0, 0)->getTimestamp();
        $result['state'] = $run && $run->status === 'failed' ? 'failed' : 'pending';
        return $result;
    }

    public function getResetPeriod(User $user)
    {
        if ($user->plan_id === NULL) return null;
        $plan = Plan::find($user->plan_id);
        if ($user->expired_at <= time() || $user->expired_at === NULL) return null;
        // if reset method is not reset
        if ($plan->reset_traffic_method === 2) return null;
        switch (true) {
            case ($plan->reset_traffic_method === NULL) : {
                $resetTrafficMethod = config('v2board.reset_traffic_method', 0);
                switch ((int)$resetTrafficMethod) {
                    case 0:
                        return 1;
                    case 1:
                        return 30;
                    case 2:
                        return null;
                    case 3:
                        return 12;
                    case 4:
                        return 365;
                }
                break;
            }
            case ($plan->reset_traffic_method === 0): {
                return 1;
            }
            case ($plan->reset_traffic_method === 1): {
                return 30;
            }
            case ($plan->reset_traffic_method === 2): {
                return null;
            }
            case ($plan->reset_traffic_method === 3): {
                return 12;
            }
            case ($plan->reset_traffic_method === 4): {
                return 365;
            }
        }    
        return null;
    }

    public function isAvailable(User $user)
    {
        return !$user->banned && (TrafficCreditService::hasPeriod($user) || $user->credit_balance > 0);
    }

    public function getAvailableUsers()
    {
        return User::withUsableTraffic()->get();
    }

    public function getDeviceLimitedUsers()
    {
        return User::withUsableTraffic()->where('device_limit', '>', 0)->select('id')->get();
    }

    public function getUnAvailbaleUsers()
    {
        return User::where('credit_balance', '<=', 0)->where(function ($query) {
            $query->where('expired_at', '<', time())
                ->orWhere('expired_at', 0);
        })
            ->where(function ($query) {
            $query->where('plan_id', NULL)
                ->orWhere('transfer_enable', 0);
        })
            ->get();
    }

    public function addBalance(int $userId, int $balance):bool
    {
        $user = User::lockForUpdate()->find($userId);
        if (!$user) {
            return false;
        }
        $user->balance = $user->balance + $balance;
        if ($user->balance < 0) {
            return false;
        }
        if (!$user->save()) {
            return false;
        }
        return true;
    }

    public function isNotCompleteOrderByUserId(int $userId): bool
    {
        return Order::where('user_id', $userId)
            ->whereIn('status', [0, 1])
            ->exists();
    }

    public function trafficFetch(array $server, string $protocol, array $data)
    {
        TrafficFetchJob::dispatch($data, $server, $protocol);
        StatUserJob::dispatch($data, $server, $protocol, 'd');
        StatServerJob::dispatch($data, $server, $protocol, 'd');
    }

}
