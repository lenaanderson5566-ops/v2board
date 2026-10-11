<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function ($e) { fwrite(STDERR, $e->getMessage()."\n"); exit(1); });
$checks=0;
$assert=function ($ok, $why) use (&$checks) { if (!$ok) throw new RuntimeException($why); $checks++; };
$store=Illuminate\Support\Facades\Cache::store('redis');
$prefix=config('cache.prefix');
$legacyPrefix=!empty($prefix) ? $prefix.':' : '';
$assert($store->getStore()->getPrefix()===$legacyPrefix, 'Redis namespace changed');
$probe=storage_path('app/framework-upgrade-cache.json');
if (is_file($probe)) {
    $old=json_decode(file_get_contents($probe),true,512,JSON_THROW_ON_ERROR);
    try {
        $assert($store->getStore()->getPrefix()===$old['prefix'], 'Pre-upgrade prefix changed');
        $assert($store->get($old['key'])==='before-upgrade', 'Pre-upgrade cache unreadable');
        $assert(!$store->lock($old['key'].':lock',30)->get(), 'Pre-upgrade lock bypassed');
    } finally {
        $store->forget($old['key']);
        $store->restoreLock($old['key'].':lock',$old['owner'])->release();
        unlink($probe);
    }
}
$redis=Illuminate\Support\Facades\Redis::connection('cache');
$key='cache-prefix-test:'.bin2hex(random_bytes(12));
try {
    $redis->setex($legacyPrefix.$key,60,serialize('legacy-value'));
    $redis->setex($legacyPrefix.$key.':lock',60,'legacy-owner');
    $assert($store->get($key)==='legacy-value','Legacy serialized cache unreadable');
    $assert(!$store->lock($key.':lock',30)->get(),'Legacy lock bypassed');
    $store->put($key,'new-value',60);
    $assert($redis->get($legacyPrefix.$key)===serialize('new-value'),'New writes changed namespace');
} finally {
    $redis->del($legacyPrefix.$key,$legacyPrefix.$key.':lock');
}
echo "Cache prefix upgrade: $checks checks passed\n";
