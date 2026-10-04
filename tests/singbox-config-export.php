<?php
// Export the real generated subscription for `sing-box check`; contains dummy credentials only.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$user = ['uuid'=>'00000000-0000-4000-8000-000000000001','u'=>0,'d'=>0,'transfer_enable'=>1000,'expired_at'=>time()+86400];
$servers = [['type'=>'shadowsocks','name'=>'Validation node','cipher'=>'aes-128-gcm','host'=>'node.example','port'=>443]];
$response = (new App\Protocols\Singbox($user, $servers))->handle();
file_put_contents('/tmp/sing-review/generated.json', $response->getContent());
echo "Exported generated subscription\n";
