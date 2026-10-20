<?php
require_once __DIR__.'/autoload.php';
require_once __DIR__.'/Assertions.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
// SQLite-only compatibility for MySQL scalar functions used by isolated node tests.
if (config('database.default')==='sqlite') {
    $pdo=\Illuminate\Support\Facades\DB::connection()->getPdo();
    $pdo->sqliteCreateFunction('FIELD',function($value,...$items) {
        $position=array_search($value,$items);
        return $position===false ? 0 : $position+1;
    });
    $pdo->sqliteCreateFunction('GREATEST',fn(...$items)=>in_array(null,$items,true) ? null : max($items));
}
return $app;
