<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local') || !preg_match('/^target-statistics-test-[a-f0-9]{24}:$/D', $argv[1] ?? '')) exit(1);
set_exception_handler(function($e){fwrite(STDERR,'Target worker failed: '.get_class($e)."\n");exit(1);});
config(['cache.stores.target_statistics.prefix'=>$argv[1]]);
Illuminate\Support\Facades\Cache::purge('target_statistics');
$input=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);
$store=app(App\Services\TargetStatisticsStore::class);
foreach ($input as $batch) $store->ingest(999997,$batch['version'],$batch['batchId'],$batch['hash'],$batch['rows'],0,100);
