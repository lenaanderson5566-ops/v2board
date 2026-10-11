<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) exit(1);
set_exception_handler(function($e){fwrite(STDERR,'Worker failed: '.get_class($e)."\n");exit(1);});
$node=(object)['id'=>(int)$argv[1],'rate'=>2];
$id=App\Services\Actions\NodeTrafficBatch::receive($node,$argv[2],[(int)$argv[3]=>[100,50]]);
App\Services\Actions\NodeTrafficBatch::process($id);
