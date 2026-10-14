<?php
// Must be loaded after the application bootstrap. Never use an existing business database.
if ($commerceDatabase = getenv('COMMERCE_TEST_DATABASE')) {
    if (!app()->environment(['local','testing']) || !preg_match('/^commerce_test_[a-f0-9]{8}$/D',$commerceDatabase)) throw new RuntimeException('Unsafe commerce test database');
    $connection=config('database.connections.mysql'); $connection['database']=$commerceDatabase;
    config(['database.connections.commerce_test'=>$connection,'database.default'=>'commerce_test',
        'cache.default'=>'array','queue.default'=>'sync','logging.default'=>'stderr','v2board.new_user_currency'=>'CNY',
        'v2board.telegram_bot_enable'=>0]);
    Illuminate\Support\Facades\DB::purge('commerce_test');
    Illuminate\Support\Facades\Http::preventStrayRequests();
    Illuminate\Support\Facades\Queue::fake();
    Illuminate\Support\Facades\Mail::fake();
}
