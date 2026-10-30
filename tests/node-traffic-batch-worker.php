<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) exit(1);
set_exception_handler(function($e){fwrite(STDERR,'Worker failed: '.get_class($e)."\n");exit(1);});
if (($argv[4] ?? '') === 'online') {
    $start = (float) ($argv[6] ?? 0);
    while (microtime(true) < $start) usleep(1000);
    $presence = new App\Services\OnlineDeviceService();
    for ($attempt = 0; $attempt < 12; $attempt++) {
        $presence->replace('v2box', (int) $argv[1], [(int) $argv[3] => [$argv[5]]], 3600);
        usleep(1000);
    }
    exit(0);
}
$node=(object)['id'=>(int)$argv[1],'rate'=>2];
$id=App\Services\Actions\NodeTrafficBatch::receive($node,$argv[2],[(int)$argv[3]=>[100,50]]);
App\Services\Actions\NodeTrafficBatch::process($id);
