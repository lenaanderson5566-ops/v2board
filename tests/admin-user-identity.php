<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local only');
use App\Models\User;
use App\Models\Order;
use App\Models\CommissionLog;
use App\Services\AdminUserIdentity;
use Illuminate\Support\Facades\DB;
$user = User::select('id', 'email')->firstOrFail();
$rows = collect([
    new Order(['user_id' => $user->id, 'invite_user_id' => $user->id]),
    new CommissionLog(['invite_user_id' => $user->id]),
    new Order(['user_id' => 2147483647]),
]);
DB::enableQueryLog();
DB::flushQueryLog();
AdminUserIdentity::append($rows);
$assert = function ($ok) { if (!$ok) throw new RuntimeException('Identity projection failed'); };
$assert(count(DB::getQueryLog()) === 1);
$assert($rows[0]->email === $user->email && $rows[0]->invite_email === $user->email);
$assert($rows[1]->invite_email === $user->email);
$assert($rows[2]->user_id === 2147483647 && $rows[2]->email === null);
$assert(!isset($rows[0]->password) && !isset($rows[0]->token));
DB::flushQueryLog();
AdminUserIdentity::append(collect());
$assert(count(DB::getQueryLog()) === 0);
echo "Administrator user identity: 6 checks passed\n";
