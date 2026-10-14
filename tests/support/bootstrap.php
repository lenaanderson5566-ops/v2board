<?php
require_once __DIR__.'/autoload.php';
require_once __DIR__.'/Assertions.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
return $app;
