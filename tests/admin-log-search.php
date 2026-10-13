<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\SubscribeLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$n = 0;
$assert = function ($ok, $label) use (&$n) { if (!$ok) throw new RuntimeException($label); $n++; };
DB::beginTransaction();
try {
    $marker = 'log-search-' . Illuminate\Support\Str::uuid();
    foreach ([1, 2, 3] as $i) SubscribeLog::create([
        'user_id' => 987654, 'email' => $marker . '@example.test', 'ip' => '192.0.2.123',
        'client_type' => 'fastai', 'user_agent' => $marker . '/1.0.' . $i,
        'status' => $i === 3 ? 'success' : 'failed', 'reason' => $i === 3 ? null : 'client_disabled',
    ]);
    $controller = new App\Http\Controllers\V1\Risk\LogController();
    $fetch = function ($params) use ($controller) {
        return $controller->getSubscribeLogs(Request::create('/', 'GET', $params))->getOriginalContent();
    };
    $page = $fetch(['keyword' => $marker, 'page_size' => 1, 'current' => 2]);
    $assert($page['total'] === 3 && count($page['data']) === 1, 'Keyword search paginates with full total');
    $assert($page['data'][0]->user_agent === $marker . '/1.0.2', 'Stable descending pagination');
    $failed = $fetch(['keyword' => $marker, 'status' => 'failed']);
    $assert($failed['total'] === 2, 'Status combines with keyword');
    $assert($fetch(['keyword' => $marker, 'ip' => '192.0.2.124'])['total'] === 0, 'Exact IP narrows search');
    $assert($fetch(['keyword' => $marker, 'to' => 1])['total'] === 0, 'Time bounds apply before pagination');
    try {
        $fetch(['from' => 20, 'to' => 10]);
        $assert(false, 'Reversed time must fail');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
        $assert($error->getStatusCode() === 422, 'Reversed time returns 422');
    }
    echo "PASS {$n} admin log search checks\n";
} finally { DB::rollBack(); }
