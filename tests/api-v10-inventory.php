<?php
$app = require __DIR__.'/support/bootstrap.php';
$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
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
// Analytics has a closed, public event contract and a separate administrator boundary.
$analytics=$openapi['components']['schemas']['postPublicAnalyticsEventsInput'];
$assert($analytics['additionalProperties']===false,'Analytics rejects unexpected fields');
$assert($analytics['required']===['sessionId','page','device','language','consent'],'Analytics consent and anonymous event fields are explicit');
$assert($analytics['properties']['page']['enum']===App\Services\ProductAnalytics::PAGES,'Analytics page allowlist matches the published contract');
$assert($openapi['paths']['/public/analytics/events']['post']['security']===[],'Public analytics never requires account credentials');
foreach ($routes as $route) {
    if (str_contains($route->getActionName(),'V1\\Admin\\ProductAnalyticsController')) {
        $assert(in_array('admin',$route->gatherMiddleware(),true),'Analytics reports/settings require server-side administrator authorization');
    }
}
echo "V10 inventory: $checks checks passed\n";
