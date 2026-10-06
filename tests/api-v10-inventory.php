<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
$openapi=json_decode(file_get_contents(base_path('docs/api-v10/openapi.json')),true);
$mapped=array_column($entries,'action');
$routes=app('router')->getRoutes();
foreach ($routes as $route) {
    $uri=$route->uri(); $action=$route->getActionName();
    if (str_starts_with($uri,'api/v1/') && preg_match('/\\\\V1\\\\(User|Passport|Guest|Client)\\\\/',$action)) {
        $assert(in_array($action,$mapped,true),'Unmapped legacy action: '.$action);
    }
    if (str_starts_with($uri,'api/v10/')) {
        $path='/'.substr($uri,8);
        foreach ($route->methods() as $method) if ($method!=='HEAD') {
            $assert(isset($openapi['paths'][$path][strtolower($method)]),'Undocumented route '.$method.' '.$path);
        }
        $assert(!str_contains($uri,'admin/') && !str_contains($uri,'operations/') && !str_contains($uri,'staff/'),'Admin scope was migrated');
        $assert(str_contains($action,'\\V10\\'),'V10 must use a dedicated controller');
    }
}
foreach ($entries as $entry) {
    $found=false;
    foreach ($routes as $route) if ($route->uri()==='api/v10/'.$entry['path'] && in_array($entry['method'],$route->methods(),true)) $found=true;
    $assert($found,'Unregistered resource '.$entry['path']);
}
$assert(is_file(base_path('frontend/src/shared/v10-types.ts')) && is_file(base_path('AGENTS.md')),'Types and agent rules exist');
echo "V10 inventory: $checks checks passed\n";
