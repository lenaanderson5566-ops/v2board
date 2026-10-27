<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0; $routeCount=0; $protectedCount=0; $retained=[]; $findings=[];
$testIpPrefix='198.18.'.random_int(0,255).'.';
$authorizationProbe=0; $legacyProbe=0; $legacyProtectedCount=0; $v10Probe=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
$entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
$contracts=App\Http\Resources\V10\Resource::contracts()['endpoints'];
$mapping=[];
$allowlist=json_decode(file_get_contents(base_path('docs/api-v10/retained-legacy.json')),true);
$httpKernel=app(Illuminate\Contracts\Http\Kernel::class);
$verifiedMiddleware=[];
$verifyMiddleware=function(array $stack) use (&$verifiedMiddleware,$assert) {
    foreach ($stack as $middleware) {
        $class=explode(':',$middleware,2)[0];
        if (isset($verifiedMiddleware[$class])) continue;
        $assert(class_exists($class) && method_exists($class,'handle'),'Unresolvable active middleware: '.$class);
        $verifiedMiddleware[$class]=true;
    }
};
$verifyMiddleware(array_merge($httpKernel->getGlobalMiddleware(),$httpKernel->getMiddlewarePriority(),array_values(app('router')->getMiddleware())));
$assert(!array_key_exists('staff',app('router')->getMiddleware()),'Retired staff middleware alias must be absent');
$assert(!glob(app_path('Http/Controllers/V1/Staff/*.php')),'Retired staff controllers must be removed');
foreach (['Http/Routes/V1/StaffRoute.php','Http/Middleware/Staff.php','Http/Requests/Staff/UserUpdate.php'] as $retiredFile) {
    $assert(!is_file(app_path($retiredFile)),'Retired staff implementation must be absent: '.$retiredFile);
}
$seen=[];
foreach ($entries as $entry) {
    // Native V10 resources have no legacy action to map.
    if (!isset($entry['action'])) continue;
    $mapping[$entry['action']][]=(str_starts_with($entry['path'],'webhooks/payments/') ? 'GET/POST' : $entry['method']).' /api/v10/'.$entry['path'];
}
foreach (app('router')->getRoutes() as $route) {
    $routeCount++; $uri=$route->uri(); $action=$route->getActionName(); $middleware=preg_match('#^api/v[12]/server/#',$uri) ? $route->middleware() : $route->gatherMiddleware();
    $assert(!preg_match('#^api/v[0-9]+/staff(?:/|$)#',$uri),'Retired staff API must not be registered: '.$uri);
    $assert(!in_array('staff',$middleware,true),'Routes must not reference retired staff middleware: '.$uri);
    $verifyMiddleware(app('router')->resolveMiddleware($middleware,$route->excludedMiddleware()));
    if ($action!=='Closure' && str_contains($action,'@')) {
        [$class,$method]=explode('@',$action,2);
        if (!class_exists($class) || !method_exists($class,$method)) {
            $findings[]='Missing route handler: '.$action;
            continue;
        }
        $assert((new ReflectionMethod($class,$method))->isPublic(),'Non-public handler '.$uri);
        if (preg_match('/\\\\V1\\\\(Admin|Risk)\\\\/',$class)) {
            $adminMfaLogin = $class === App\Http\Controllers\V1\Admin\MfaController::class
                && in_array($uri, ['api/v1/passport/mfa/emails', 'api/v1/passport/mfa/verifications'], true);
            if ($adminMfaLogin) {
                $assert($route->methods() === ['POST'], 'MFA login verification must be POST');
                $assert(count(array_filter($middleware, fn($value) => str_starts_with($value, 'throttle:'))) > 0, 'MFA login verification must be throttled');
                $probe = Illuminate\Http\Request::create('/'.$uri, 'POST', ['challengeId'=>str_repeat('0', 64), 'method'=>'totp', 'code'=>'000000'], [], [], ['HTTP_ACCEPT'=>'application/json']);
                $app->instance('request', $probe);
                $response = $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($probe);
                $assert(in_array($response->getStatusCode(), [401,403,409,419,422], true), 'MFA login cannot succeed without a valid bound challenge');
                $payload = json_decode($response->getContent(), true);
                $assert(!isset($payload['data']['auth_data']) && !isset($payload['data']['accessToken']), 'Invalid MFA login cannot issue credentials');
            } else {
                $assert(in_array('admin', $middleware, true),'Unprotected management route '.$uri);
            }
        }
        if (str_contains($class,'\\V1\\User\\')) $assert(in_array('user',$middleware,true),'Unprotected legacy user route '.$uri);
    }
    // Probe every retained protected legacy route, including configured admin/ops/custom paths.
    // Rejection must happen before a controller can execute any business mutation.
    if (count(array_intersect(['admin','user','client'], $middleware))>0 && !str_starts_with($uri,'api/v10/')) {
        $legacyProtectedCount++;
        foreach (array_diff($route->methods(), ['HEAD','OPTIONS']) as $httpMethod) {
            foreach (['missing','array-query','array-body','forged-header'] as $variant) {
                if ($variant==='array-body' && $httpMethod==='GET') continue;
                $path='/'.preg_replace('/\{[^}]+\}/','1',$uri);
                $forged=['auth_data'=>['is_admin'=>'1','is_staff'=>'1','id'=>1], 'token'=>['is_admin'=>'1'], 'user'=>['id'=>1,'is_admin'=>1,'is_staff'=>1]];
                if ($variant==='array-query') $path.='?'.http_build_query($forged);
                $server=['REMOTE_ADDR'=>'198.19.'.(intdiv(++$legacyProbe,250)%250).'.'.($legacyProbe%250+1), 'HTTP_ACCEPT'=>'application/json'];
                if ($variant==='forged-header') $server['HTTP_AUTHORIZATION']='forged-legacy-jwt';
                if ($variant==='array-body') $server['CONTENT_TYPE']='application/json';
                $probe=Illuminate\Http\Request::create($path,$httpMethod,[],[],[],$server,$variant==='array-body'?json_encode($forged):null);
                $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($probe);
                $assert(in_array($response->getStatusCode(),[400,401,403],true),'Legacy route must reject '.$variant.': '.$httpMethod.' '.$uri.' HTTP '.$response->getStatusCode());
            }
        }
    }
    if (preg_match('#^api/v[12]/server/#',$uri)) {
        foreach (array_diff($route->methods(), ['HEAD','OPTIONS']) as $httpMethod) {
            foreach ([null, ['is_admin'=>'1'], 'invalid-node-token'] as $credential) {
                $probe=Illuminate\Http\Request::create('/'.$uri,$httpMethod,['token'=>$credential,'node_type'=>'v2box','node_id'=>1],[],[],['HTTP_ACCEPT'=>'application/json']);
                $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($probe);
                $payload=json_decode($response->getContent(),true)??[];
                $assert(!isset($payload['users']) && ($response->getStatusCode()>=400 || ($payload['status']??null)==='fail'),'Legacy node route rejects malformed credentials before returning configuration or user data: '.$uri);
            }
        }
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
    $candidates = collect($contracts)->filter(fn($value) => $value['path'] === $entry['path'] && $value['method'] === $entry['method']);
    $assert($candidates->count() === 1, 'V10 resource needs exactly one method/path contract');
    $contract = $candidates->first();
    $assert($contract!==null,'Missing contract '.$key);
    $assert($contract['path'] === $entry['path'] && $contract['method'] === $entry['method'], 'Contract method/path mismatch '.$key);
    if (isset($entry['key'])) $assert($contract['key'] === $entry['key'], 'Explicit contract key mismatch '.$key);
    if ($contract['role']!=='user') continue;
    $path='/api/v10/'.preg_replace('/\{[^}]+\}/','1',$entry['path']);
    $request=Illuminate\Http\Request::create($path,$entry['method'],[],[],[],['REMOTE_ADDR'=>$testIpPrefix.(++$authorizationProbe),'HTTP_ACCEPT'=>'application/json','HTTP_USER_AGENT'=>'API-Audit','CONTENT_TYPE'=>'application/json'],'{}');
    $app->instance('request',$request);
    $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    $assert($response->getStatusCode()===401,'Account route must reject missing credentials: '.$entry['method'].' '.$path.' '.$response->getStatusCode());
    foreach (['array-query','array-body','forged-bearer'] as $variant) {
        $server=['REMOTE_ADDR'=>'198.20.'.(intdiv(++$v10Probe,250)%250).'.'.($v10Probe%250+1),'HTTP_ACCEPT'=>'application/json','CONTENT_TYPE'=>'application/json'];
        if ($variant==='forged-bearer') $server['HTTP_AUTHORIZATION']='Bearer forged-v10-jwt';
        $forged=['auth_data'=>['is_admin'=>1,'is_staff'=>1], 'accessToken'=>['id'=>1], 'user'=>['id'=>1,'is_admin'=>1]];
        $probe=Illuminate\Http\Request::create($path.($variant==='array-query'?'?'.http_build_query($forged):''),$entry['method'],[],[],[],$server,$variant==='array-body'?json_encode($forged):null);
        $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($probe);
        // Account deletion rejects unsupported input fields before authentication; a valid
        // empty JSON request above and the forged Bearer below still must return 401.
        $expected=($path==='/api/v10/me' && $entry['method']==='DELETE' && $variant!=='forged-bearer') ? 422 : 401;
        $assert($response->getStatusCode()===$expected,'V10 account route rejects '.$variant.': '.$entry['method'].' '.$path.' '.$response->getStatusCode());
    }
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
    $doc.="## 节点通信\n\n仅支持 `node_type=v2box`。节点通信保留原 API 版本，使用显式路由。\n\n| 方法 | 路径 |\n|---|---|\n";
    foreach (app('router')->getRoutes() as $route) {
        if (!preg_match('#^api/v[12]/server/#', $route->uri())) continue;
        $doc.='| '.implode('/', array_diff($route->methods(), ['HEAD'])).' | `/'.$route->uri()."` |\n";
    }
    $doc.="\nV2 配置接口未填写 node_type 时默认 v2box。旧 Deepbwork、Tidalab、UniProxy/config 与动态控制器分发已移除。\n\n## 其他保留入口\n\n| 方法 | 路径 | 用途与条件 |\n|---|---|---|\n| GET/HEAD | 管理员配置的 `subscribe_path` | 自定义订阅路径，使用原 token 规则；与 V10 同时可用；旧默认路径已移除 |\n| GET/HEAD | `/api/v10/public/client-installers/{installerId}/content` | 镜像下载新版入口；原 `/client-mirrors/{id}` 已移除 |\n\n`/` 与 `/app` 是网页入口而非 API，也继续保留。后台安全路径和运营路径不在本清单范围内；未完成的 `/api/v1/staff/*` 接口已全部退役，返回 404。\n\n## 兼容说明\n\n- 上表旧用户/登录/公共/客户端路由共 {$count} 条；前端用户业务已通过集中传输层使用 V10，仅保留后台依赖、历史回调及订阅入口。\n- 旧用户业务 API（包括 `invite/save`）已移除；使用 V10。\n- 支付新订单与后台展示统一使用 V10 回调，旧支付回调兼容此前订单；两者保持原验签和应答。Telegram 保持已有兼容规则。\n- 不再注册旧用户业务中的 GET 写操作。\n- 节点管理、订阅、排序及当前节点排行仅使用 V2Box；旧节点配置表通过定向迁移删除；共享账务记录保留。\n";
    file_put_contents(base_path('docs/api-v10/retained-endpoints.md'),$doc);
}
echo "Route audit: {$routeCount} registered routes, {$protectedCount} V10 authentication checks, {$legacyProtectedCount} legacy protected routes / {$legacyProbe} rejection probes, {$checks} checks passed\n";
foreach ($findings as $finding) echo "FINDING: {$finding}\n";
if ($findings) exit(1);
