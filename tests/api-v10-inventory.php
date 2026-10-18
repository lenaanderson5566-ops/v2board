<?php
$app = require __DIR__.'/support/bootstrap.php';
$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
$entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
$openapi=json_decode(file_get_contents(base_path('docs/api-v10/openapi.json')),true);
$source=json_decode(file_get_contents(base_path('api/v10/openapi.json')),true);
$source['paths']=[]; $source['components']=[];
foreach ($source['x-modules'] as $modulePath) {
    $module=json_decode(file_get_contents(base_path('api/v10/'.$modulePath)),true);
    foreach ($module['paths'] as $path=>$definition) {
        $assert(!isset($source['paths'][$path]), 'Duplicate source path: '.$path);
        $source['paths'][$path]=$definition;
    }
    foreach ($module['components'] as $category=>$definitions) foreach ($definitions as $name=>$definition) {
        $assert(!isset($source['components'][$category][$name]), 'Duplicate source component: '.$category.'/'.$name);
        $source['components'][$category][$name]=$definition;
    }
}
$resolve=function(array $value) use ($openapi): array {
    $seen=[];
    while (isset($value['$ref'])) {
        $ref=$value['$ref'];
        if (!str_starts_with($ref, '#/') || isset($seen[$ref])) throw new RuntimeException('Invalid local reference: '.$ref);
        $seen[$ref]=true; $value=$openapi;
        foreach (explode('/', substr($ref,2)) as $part) $value=$value[str_replace(['~1','~0'], ['/','~'], $part)];
    }
    return $value;
};
$runtime=App\Http\Resources\V10\Resource::contracts();
$browser=json_decode(file_get_contents(base_path('frontend/src/shared/v10-contracts.json')),true);
$assert($runtime['schemas']===$browser['schemas'], 'Browser and server projections must share one generated source');
$assert($runtime['endpoints']===$browser['endpoints'], 'Browser and server endpoint inventories must agree');
foreach ($runtime['endpoints'] as $id=>$contract) {
    $operation=$source['paths']['/'.$contract['path']][strtolower($contract['method'])];
    $expected=$operation['x-runtime'];
    $expected['path']=$contract['path']; $expected['method']=$contract['method'];
    $assert($operation['operationId']===$id && $expected==$contract, 'Canonical operation differs: '.$id);
}
foreach ($runtime['schemas'] as $name=>$fields) foreach ($fields as $field=>$spec) {
    $assert(($source['components']['schemas'][$name]['properties'][$field]['x-runtime-field']??null)===$spec, 'Canonical projection differs: '.$name.'.'.$field);
}
$assert(!str_contains(json_encode($openapi), '"x-runtime'), 'Published OpenAPI excludes internal projections');
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
$assert($analytics['properties']['language']['enum']===App\Services\LanguagePreferenceService::SUPPORTED,'Analytics language allowlist matches all supported interface languages');
$assert($openapi['paths']['/public/analytics/events']['post']['security']===[],'Public analytics never requires account credentials');
foreach ($routes as $route) {
    if (str_contains($route->getActionName(),'V1\\Admin\\ProductAnalyticsController')) {
        $assert(in_array('admin',$route->gatherMiddleware(),true),'Analytics reports/settings require server-side administrator authorization');
    }
}
$assert(!isset($openapi['paths']['/me/coupon-validations']), 'Retired code validation must not be advertised');
$assert(str_contains($openapi['paths']['/auth/registrations']['post']['description']??'', 'HttpOnly'), 'Registration documents its browser session boundary');
foreach (App\Http\Resources\V10\Resource::contracts()['endpoints'] as $contract) {
    if ($contract['role']!=='user') continue;
    $operation=$openapi['paths']['/'.$contract['path']][strtolower($contract['method'])];
    foreach ($operation['responses'] as $status=>$response) {
        if (!str_starts_with((string)$status,'2')) continue;
        $response=$resolve($response);
        $header=$resolve($response['headers']['Cache-Control']??[]);
        $assert(($header['schema']['example']??'')==='private, no-store','Authenticated response forbids storage: '.$contract['path']);
    }
}
$assert(!isset($openapi['components']['schemas']['postMeOrdersInput']['properties']['couponCode']), 'Retired code input must not be advertised');
foreach ($routes as $route) $assert($route->uri() !== 'api/v10/me/coupon-validations','Retired coupon validation route remains active');
echo "V10 inventory: $checks checks passed\n";
