<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
Illuminate\Support\Facades\DB::beginTransaction();
try {
    $id = random_int(1000000000, 2000000000);
    $today = strtotime(date('Y-m-d'));
    foreach ([-30, -29, -6, 0, 1] as $offset) {
        App\Models\StatUser::create(['user_id'=>$id, 'server_rate'=>1, 'u'=>10, 'd'=>20, 'record_type'=>'d', 'record_at'=>strtotime("$offset days", $today)]);
    }
    App\Models\StatUser::create(['user_id'=>$id+1, 'server_rate'=>1, 'u'=>999, 'd'=>999, 'record_type'=>'d', 'record_at'=>$today]);
    $read = function ($days = null) use ($id) {
        $request = Illuminate\Http\Request::create('/', 'GET', ['user'=>['id'=>$id]] + ($days === null ? [] : ['days'=>$days]));
        $response = (new App\Services\Actions\User\StatActions())->getTrafficLog($request);
        return json_decode($response->getContent(), true)['data'];
    };
    $records = $read(30);
    $assert(count($records) === 3, '30-day boundary or future exclusion incorrect');
    $assert(min(array_column($records, 'record_at')) === strtotime('-29 days', $today), 'Rolling window must include previous month');
    $assert(array_sum(array_column($records, 'u')) === 30, 'Other user data leaked');
    $assert(count($read(7)) === 2, 'Seven-day boundary incorrect');
    $default = $read();
    $assert(min(array_column($default, 'record_at')) >= strtotime(date('Y-m-1')), 'Legacy month behavior changed');
    foreach ([0, 31, 'invalid'] as $invalid) {
        try { $read($invalid); throw new RuntimeException('Invalid window accepted'); }
        catch (Illuminate\Validation\ValidationException $error) { $checks++; }
    }
    $usage=App\Services\DashboardUsage::summary();
    $assert(!array_key_exists('mixed_timezone',$usage), 'Retired timezone warning queried or exposed');
    $assert(count($usage['periods'])===3 && $usage['has_records'], 'Usage summary remains available');
    $assert(array_sum(array_column($usage['daily'],'bytes'))===$usage['periods'][2]['bytes'], 'Daily and rolling totals diverge');

    $previousZone = config('fastai.system_timezone');
    $previousCache = config('cache.default');
    config(['fastai.system_timezone'=>'UTC', 'cache.default'=>'array']);
    try {
        $day = (new DateTimeImmutable('today', new DateTimeZone('UTC')))->modify('-3 days');
        $label = $day->format('Y-m-d');
        $priorLabel = $day->modify('-1 day')->format('Y-m-d');
        $shanghaiAt = $day->getTimestamp() - 8 * 3600;
        $kathmanduAt = $day->getTimestamp() - (5 * 60 + 45) * 60;
        $pacificAt = $day->getTimestamp() - 14 * 3600;
        $before = App\Services\DashboardUsage::summary();
        // A missing zone is a legacy Shanghai bucket. The same timestamp can
        // also be a bucket for the prior business date in a different zone.
        $buckets = [
            [$shanghaiAt, null, 50],
            [$kathmanduAt, 'Asia/Kathmandu', 80],
            [$pacificAt, 'Pacific/Kiritimati', 30],
            [$pacificAt, 'Pacific/Honolulu', 70],
        ];
        foreach ($buckets as $n => [$at, $zone, $bytes]) {
            App\Models\StatUser::create([
                'user_id'=>$id+100+$n, 'server_rate'=>1, 'u'=>$bytes, 'd'=>0,
                'record_type'=>'d', 'record_at'=>$at, 'record_timezone'=>$zone,
            ]);
        }
        Illuminate\Support\Facades\Cache::store('array')->flush();
        $mixed = App\Services\DashboardUsage::summary();
        $beforeDaily = array_column($before['daily'],'bytes','date');
        $mixedDaily = array_column($mixed['daily'],'bytes','date');
        $assert(($mixedDaily[$label] ?? 0) - ($beforeDaily[$label] ?? 0) === 160,
            'Legacy Shanghai, Kathmandu and Kiritimati buckets retain and combine their original business date');
        $assert(($mixedDaily[$priorLabel] ?? 0) - ($beforeDaily[$priorLabel] ?? 0) === 70,
            'Two original business dates sharing an epoch remain distinguishable');
        $assert($mixed['periods'][2]['bytes'] - $before['periods'][2]['bytes'] === 230
            && $mixed['periods'][2]['users'] - $before['periods'][2]['users'] === 4
            && array_sum($mixedDaily) === $mixed['periods'][2]['bytes'],
            'Restored dates do not change aggregate totals or deduplication');
        $days = array_keys($mixedDaily);
        $ordered = $days;
        sort($ordered);
        $assert($days === $ordered, 'Original business dates remain chronologically sorted');
    } finally {
        config(['fastai.system_timezone'=>$previousZone, 'cache.default'=>$previousCache]);
    }
    echo "Usage window: $checks checks passed\n";
} finally {
    Illuminate\Support\Facades\DB::rollBack();
}
