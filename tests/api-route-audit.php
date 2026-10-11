<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0; $routeCount=0; $protectedCount=0; $retained=[]; $findings=[];
$testIp='198.18.'.random_int(0,255).'.'.random_int(1,254);
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
$contracts=App\Http\Resources\V10\Resource::contracts()['endpoints'];
$mapping=[];
$allowlist=json_decode(file_get_contents(base_path('docs/api-v10/retained-legacy.json')),true);
$seen=[];
foreach ($entries as $entry) {
    // Native V10 resources have no legacy action to map.
    if (!isset($entry['action'])) continue;
    $mapping[$entry['action']][]=(str_starts_with($entry['path'],'webhooks/payments/') ? 'GET/POST' : $entry['method']).' /api/v10/'.$entry['path'];
}
foreach (app('router')->getRoutes() as $route) {
    $routeCount++; $uri=$route->uri(); $action=$route->getActionName(); $middleware=preg_match('#^api/v[12]/server/#',$uri) ? $route->middleware() : $route->gatherMiddleware();
    if ($action!=='Closure' && str_contains($action,'@')) {
        [$class,$method]=explode('@',$action,2);
        if (!class_exists($class) || !method_exists($class,$method)) {
            $findings[]='Missing route handler: '.$action;
            continue;
        }
        $assert((new ReflectionMethod($class,$method))->isPublic(),'Non-public handler '.$uri);
        if (preg_match('/\\\\V1\\\\(Admin|Risk|Staff)\\\\/',$class)) {
            $assert(count(array_intersect(['admin','staff'], $middleware))>0,'Unprotected management route '.$uri);
        }
        if (str_contains($class,'\\V1\\User\\')) $assert(in_array('user',$middleware,true),'Unprotected legacy user route '.$uri);
    }
    if (preg_match('#^api/v1/(user|passport|guest|client)/#',$uri,$match)) {
        $assert(in_array($uri,$allowlist,true),'Retired route was reintroduced: '.$uri);
        $seen[]=$uri;
        $retained[$match[1]][]=['method'=>implode('/',array_diff($route->methods(),['HEAD'])),'path'=>'/'.$uri,'new'=>implode('<br>',array_unique($mapping[$action] ?? []))];
    }
}
$assert(!array_diff($allowlist,$seen),'A required compatibility route is missing');
// Exercise every V10 account route through the HTTP kernel without credentials.
// This cannot invoke business mutations: authorization must reject first.
foreach ($entries as $entry) {
    $key=$entry['key'] ?? str_replace('\\','/',str_replace('App\\Http\\Controllers\\V1\\','',$entry['action']));
    $contract=collect($contracts)->firstWhere('key',$key);
    $assert($contract!==null,'Missing contract '.$key);
    if ($contract['role']!=='user') continue;
    $path='/api/v10/'.preg_replace('/\{[^}]+\}/','1',$entry['path']);
    $request=Illuminate\Http\Request::create($path,$entry['method'],[],[],[],['REMOTE_ADDR'=>$testIp,'HTTP_ACCEPT'=>'application/json','HTTP_USER_AGENT'=>'API-Audit']);
    $app->instance('request',$request);
    $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    $assert($response->getStatusCode()===401,'Account route must reject missing credentials: '.$entry['method'].' '.$path.' '.$response->getStatusCode());
    $protectedCount++;
}
// Rebuild legacy client routes under each configured subscription path.
$original=config('v2board.subscribe_path');
foreach (['','/api/v1/client/subscribe','/custom-subscription'] as $custom) {
    config(['v2board.subscribe_path'=>$custom]);
    $router=new Illuminate\Routing\Router(app('events'),app());
    $router->group(['prefix'=>'api/v1','namespace'=>'App\\Http\\Controllers'],function($router) { (new App\Http\Routes\V1\ClientRoute())->map($router); });
    $assert(in_array('client',$router->getRoutes()->match(Illuminate\Http\Request::create('/api/v1/client/app/getConfig','GET'))->gatherMiddleware(),true),'Client config remains protected');
    try {
        $router->getRoutes()->match(Illuminate\Http\Request::create('/api/v1/client/subscribe','GET'));
        $assert(false,'Old default subscription was reintroduced');
    } catch (Symfony\Component\HttpKernel\Exception\NotFoundHttpException $e) { $assert(true,'Old subscription is retired'); }
}
config(['v2board.subscribe_path'=>$original]);
if (in_array('--write-inventory',$argv,true)) {
    $doc="# 后台之外的保留接口\n\n此清单由实际注册路由生成：`php tests/api-route-audit.php --write-inventory`。不包含 V10 新接口、管理/风控/客服后台接口。GET 路由同时支持 HEAD，表中省略 HEAD。仅表中入口继续保留；其余旧用户业务与公共内容 API 已移除。认证入口供现有后台使用。\n\n";
    $titles=['passport'=>'后台依赖的认证接口','user'=>'后台依赖的账户接口','guest'=>'旧公共接口与回调','client'=>'旧订阅与客户端接口'];
    $count=0;
    foreach ($titles as $group=>$title) {
        $rows=$retained[$group] ?? []; $count+=count($rows);
        $doc.="## {$title}（".count($rows)." 条路由）\n\n| 方法 | 保留路径 | V10 对应入口 |\n|---|---|---|\n";
        foreach ($rows as $row) $doc.='| '.$row['method'].' | `'.$row['path'].'` | '.$row['new']." |\n";
        $doc.="\n";
    }
    $doc.="## 节点通信\n\n仅支持 `node_type=v2node` 和 `node_type=v2box`。节点通信保留原 API 版本，使用显式路由。\n\n| 方法 | 路径 |\n|---|---|\n";
    foreach (app('router')->getRoutes() as $route) {
        if (!preg_match('#^api/v[12]/server/#', $route->uri())) continue;
        $doc.='| '.implode('/', array_diff($route->methods(), ['HEAD'])).' | `/'.$route->uri()."` |\n";
    }
    $doc.="\nV2 配置接口未填写 node_type 时默认 v2node。旧 Deepbwork、Tidalab、UniProxy/config 与动态控制器分发已移除。\n\n## 其他保留入口\n\n| 方法 | 路径 | 用途与条件 |\n|---|---|---|\n| GET/HEAD | 管理员配置的 `subscribe_path` | 自定义订阅路径，使用原 token 规则；与 V10 同时可用；旧默认路径已移除 |\n| GET/HEAD | `/api/v10/public/client-installers/{installerId}/content` | 镜像下载新版入口；原 `/client-mirrors/{id}` 已移除 |\n\n`/` 与 `/app` 是网页入口而非 API，也继续保留。后台安全路径、运营路径和客服 `/api/v1/staff/*` 不在本清单范围内。\n\n## 兼容说明\n\n- 上表旧用户/登录/公共/客户端路由共 {$count} 条；前端用户业务已通过集中传输层使用 V10，仅保留后台依赖、历史回调及订阅入口。\n- 旧用户业务 API（包括 `invite/save`）已移除；使用 V10。\n- 支付新订单与后台展示统一使用 V10 回调，旧支付回调兼容此前订单；两者保持原验签和应答。Telegram 保持已有兼容规则。\n- 不再注册旧用户业务中的 GET 写操作。\n- 节点管理、订阅、排序及当前节点排行仅使用 V2Node/V2Box；旧节点配置表通过定向迁移删除；共享账务记录保留。\n";
    file_put_contents(base_path('docs/api-v10/retained-endpoints.md'),$doc);
}
echo "Route audit: {$routeCount} registered routes, {$protectedCount} V10 authentication checks, {$checks} checks passed\n";
foreach ($findings as $finding) echo "FINDING: {$finding}\n";
if ($findings) exit(1);
