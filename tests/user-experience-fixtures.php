<?php
// Restricted to the existing local test account. Never changes credentials.
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local browser review only');
$action = $argv[1] ?? '';
$file = storage_path('framework/user-experience-review.json');
$prefix = 'user-experience-review-';
if ($action === 'setup') {
    if (is_file($file)) throw new RuntimeException('Restore the previous review before setup');
    $user = App\Models\User::where('email', 'test@example.com')->where('is_admin', 0)->firstOrFail();
    $backup = ['id' => $user->id, 'fields' => $user->only(['plan_id', 'group_id', 'expired_at', 'transfer_enable'])];
    file_put_contents($file, json_encode($backup, JSON_THROW_ON_ERROR));
    Illuminate\Support\Facades\DB::transaction(function () use ($user, $prefix) {
        $plan = App\Models\Plan::create(['name' => $prefix . 'Pro 100 GB', 'group_id' => 0, 'transfer_enable' => 100, 'month_price' => 0, 'show' => 0, 'renew' => 0]);
        $user->update(['plan_id' => $plan->id, 'group_id' => 0, 'expired_at' => time() + 86400, 'transfer_enable' => 100 * 1073741824]);
    });
} elseif ($action === 'cleanup') {
    if (!is_file($file)) throw new RuntimeException('No review backup found');
    $backup = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    Illuminate\Support\Facades\DB::transaction(function () use ($backup, $prefix) {
        $user = App\Models\User::where('id', $backup['id'])->where('email', 'test@example.com')->where('is_admin', 0)->firstOrFail();
        $user->update($backup['fields']);
        foreach (App\Models\Plan::where('name', 'like', $prefix . '%')->get() as $plan) {
            if (App\Models\User::where('plan_id', $plan->id)->exists() || App\Models\Order::where('plan_id', $plan->id)->exists()) throw new RuntimeException('Review plan is in use; cleanup refused');
            $plan->delete();
        }
    });
    unlink($file);
} else throw new RuntimeException('Use setup or cleanup');
echo "Local user experience review: {$action} complete\n";
