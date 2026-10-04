<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($condition, $message) use (&$checks) { if (!$condition) throw new RuntimeException($message); $checks++; };
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
    echo "Usage window: $checks checks passed\n";
} finally {
    Illuminate\Support\Facades\DB::rollBack();
}
