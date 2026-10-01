<?php
// Local-only fixtures for browser review. Does not create accounts or enable providers.
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Browser fixtures are restricted to the local environment');
$prefix = 'console-ui-review-';
$action = $argv[1] ?? '';
if (!in_array($action, ['setup', 'cleanup'])) throw new RuntimeException('Use setup or cleanup');
Illuminate\Support\Facades\DB::transaction(function () use ($prefix, $action) {
    foreach (['App\\Models\\Plan' => 'name', 'App\\Models\\Knowledge' => 'title', 'App\\Models\\Payment' => 'name', 'App\\Models\\ServerV2node' => 'name'] as $model => $field) {
        $items = $model::where($field, 'like', $prefix . '%')->get();
        foreach ($items as $item) {
            if ($model === 'App\\Models\\Plan' && (App\Models\User::where('plan_id', $item->id)->exists() || App\Models\Order::where('plan_id', $item->id)->exists())) throw new RuntimeException('A browser fixture plan is in use; cleanup refused');
            $item->delete();
        }
    }
    if ($action === 'cleanup') return;
    for ($i = 1; $i <= 2; $i++) {
        App\Models\Plan::create(['name' => $prefix . 'plan-' . $i, 'group_id' => 0, 'transfer_enable' => 1, 'month_price' => 0, 'show' => 0, 'renew' => 0, 'sort' => $i]);
        App\Models\Knowledge::create(['title' => $prefix . 'article-' . $i, 'category' => '本地按钮核对', 'language' => 'ja-JP', 'body' => '<p>临时知识库正文 ' . $i . '</p>', 'show' => 0, 'sort' => $i]);
        App\Models\Payment::create(['name' => $prefix . 'payment-' . $i, 'payment' => 'Paytaro', 'uuid' => App\Utils\Helper::guid(), 'config' => [], 'enable' => 0, 'sort' => $i]);
        App\Models\ServerV2node::create(['name' => $prefix . 'node-' . $i, 'protocol' => 'vless', 'group_id' => [], 'route_id' => [], 'host' => 'example.invalid', 'port' => '443', 'server_port' => 443, 'rate' => 1, 'up_mbps' => 0, 'down_mbps' => 0, 'tls' => 0, 'network' => 'tcp', 'show' => 0, 'sort' => $i]);
    }
});
echo "Local browser fixtures: " . $action . " complete\n";
