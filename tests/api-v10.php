<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
require __DIR__.'/fixtures/V10TestPayment.php';
Illuminate\Support\Facades\Queue::fake();
config(['v2board.telegram_bot_enable'=>0,'v2board.ticket_status'=>0]);
$cleanupUsers=[];
$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
$testIp='192.0.2.'.random_int(2,254);
$call=function($method,$path,$body=[],$token=null,$language='en-US',$extra=[]) use ($app,$testIp) {
    $server=['REMOTE_ADDR'=>$testIp,'HTTP_ACCEPT'=>'application/json','HTTP_ACCEPT_LANGUAGE'=>$language,'HTTP_USER_AGENT'=>'V10ContractTest','CONTENT_TYPE'=>'application/json'];
    if (str_contains($path, '/subscriptions/') || str_starts_with($path, '/custom-subscription')) $server['HTTP_USER_AGENT']='sing-box/1.12.0';
    $server=array_merge($server,$extra);
    if ($token) $server['HTTP_AUTHORIZATION']=$token;
    $r=Illuminate\Http\Request::create($path,$method,[] ,[],[],$server,$method === 'GET' ? null : json_encode($body));
    $app->instance('request',$r);
    $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($r);
    return [$response,json_decode($response->getContent(),true)];
};
DB::beginTransaction();
try {
    $plan=Plan::create(['name'=>'V10 test','group_id'=>1,'transfer_enable'=>50,'month_price'=>1000,'year_price'=>9000,'show'=>1,'renew'=>1]);
    $user=User::create(['email'=>Str::uuid().'@example.com','password'=>password_hash('V10testpassword',PASSWORD_DEFAULT),'token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>1500,'transfer_enable'=>0,'expired_at'=>0]);
    $cleanupUsers[]=$user;
    $credentials=(new App\Services\AuthService($user))->generateAuthData(Illuminate\Http\Request::create('/'));
    $bearer='Bearer '.$credentials['auth_data'];
    $oldInvite=App\Models\InviteCode::forceCreate(['user_id'=>$user->id,'code'=>'retired'.bin2hex(random_bytes(4)),'pv'=>7]);
    foreach ([null,$bearer] as $identity) {
        [$retired,$problem]=$call('POST','/api/v10/public/page-views',['inviteCode'=>$oldInvite->code],$identity);
        $assert($retired->getStatusCode()===404,'Retired invitation page counter is unavailable');
        $assert((int)$oldInvite->fresh()->pv===7,'Retired counter cannot update legacy invitation records');
    }

    [$quoteResponse,$quoteBody]=$call('POST','/api/v10/me/checkout-quotes',['planId'=>$plan->id,'billingPeriod'=>'annual'],$bearer);
    $assert($quoteResponse->getStatusCode()===200 && $quoteBody['data']['amountDue']===7500 && $quoteBody['data']['balanceAmount']===1500,'Native quote route calculates server amounts');
    $assert(!isset($quoteBody['data']['methods'][0]['config']) && str_contains($quoteResponse->headers->get('Cache-Control'),'no-store'),'Quote route is private and projects public payment fields');
    $assert(Order::where('user_id',$user->id)->count()===0 && $user->fresh()->balance===1500,'Native quote endpoint does not reserve assets');
    [$unauthorizedQuote]=$call('POST','/api/v10/me/checkout-quotes',['planId'=>$plan->id,'billingPeriod'=>'annual']);
    $assert($unauthorizedQuote->getStatusCode()===401,'Quote requires authenticated owner');
    [$invalidQuote]=$call('POST','/api/v10/me/checkout-quotes',['planId'=>0,'billingPeriod'=>'deposit'],$bearer);
    $assert($invalidQuote->getStatusCode()===422,'Quote rejects deposit and mismatched purchase type');
    [$forgedQuote]=$call('POST','/api/v10/me/checkout-quotes',['planId'=>$plan->id,'billingPeriod'=>'annual','totalAmount'=>1],$bearer);
    $assert($forgedQuote->getStatusCode()===422,'Quote rejects client monetary overrides and undocumented fields');

    $ordersBefore=Order::where('user_id',$user->id)->count();
    $balanceBefore=$user->fresh()->balance;
    [$r,$j]=$call('POST','/api/v10/me/orders',['planId'=>$plan->id,'billingPeriod'=>'semiannual','totalAmount'=>0],$bearer);
    $assert($r->getStatusCode()===409,'Unpriced semiannual period is rejected');
    $assert(Order::where('user_id',$user->id)->count()===$ordersBefore && $user->fresh()->balance===$balanceBefore,'Rejected period creates no order and takes no balance');
    [$r,$j]=$call('POST','/api/v10/me/orders',['planId'=>0,'depositAmount'=>500],$bearer,'zh-CN');
    $assert($r->getStatusCode()===422 && ($j['errors']['billingPeriod'][0] ?? '')==='请填写此项。','Required error is localized');
    [$r,$j]=$call('POST','/api/v10/me/orders',['planId'=>0,'billingPeriod'=>'deposit','depositAmount'=>500],$bearer);
    $assert($r->getStatusCode()===201 && isset($j['data']['orderNumber']),'Deposit creation succeeds');
    $assert(str_contains($r->headers->get('Cache-Control'),'no-store'),'Private API response must not be cached');
    $depositNumber=$j['data']['orderNumber'];
    foreach ([['planId'=>0,'billingPeriod'=>'monthly','depositAmount'=>500],['planId'=>$plan->id,'billingPeriod'=>'deposit','depositAmount'=>500],['planId'=>0,'billingPeriod'=>'deposit','depositAmount'=>0],['planId'=>0,'billingPeriod'=>'deposit','depositAmount'=>1.5],['planId'=>0,'billingPeriod'=>'deposit','depositAmount'=>9999999]] as $invalidOrder) {
        [$bad,$problem]=$call('POST','/api/v10/me/orders',$invalidOrder,$bearer,'zh-CN');
        $assert($bad->getStatusCode()===422 && !str_contains(json_encode($problem),'validation.'),'Invalid order has readable field errors');
    }

    [$r,$j]=$call('GET','/api/v10/me/orders/'.$depositNumber,[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['billingPeriod']==='deposit' && $j['data']['totalAmount']===500,'Deposit detail preserves amount and period');
    [$r,$j]=$call('POST','/api/v10/me/orders/'.$depositNumber.'/cancellation',[],$bearer);
    $assert($r->getStatusCode()===204,'Deposit can be cancelled');
       [$r,$j]=$call('POST','/api/v10/auth/sessions',['email'=>$user->email,'password'=>'V10testpassword','language'=>'en-US']);
    $assert($r->getStatusCode()===200 && $j['data']['tokenType']==='Bearer' && isset($j['data']['expiresAt']) && App\Services\AuthService::decryptAuthData($j['data']['accessToken']),'Login resource '.json_encode($j));
    [$r,$j]=$call('POST','/api/v10/auth/sessions',['email'=>$user->email,'password'=>'InvalidPassword']);
    $assert($r->getStatusCode()===401 && $r->headers->get('WWW-Authenticate')==='Bearer','Invalid login uses 401');
    [$r,$j]=$call('GET','/api/v10/me');
    $assert($r->getStatusCode()===401 && $j['code']==='UNAUTHENTICATED','Missing authentication');
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        [$localized,$problem]=$call('GET','/api/v10/me',[],null,$language);
        $catalog=json_decode(file_get_contents(resource_path('lang/'.$language.'.json')),true);
        $assert($localized->getStatusCode()===401 && $problem['code']==='UNAUTHENTICATED','Localized errors preserve status and stable code: '.$language);
        $assert($problem['title']===$catalog['Unauthenticated'] && $problem['detail']===$catalog['Unauthenticated.'],'Localized authentication error: '.$language);
        $assert($localized->headers->get('Content-Language')===$language,'Localized problem language header: '.$language);
    }
    $assert(str_contains($r->headers->get('Content-Type'),'application/problem+json') && isset($j['requestId']),'Problem contract');
    [$r,$j]=$call('GET','/api/v10/me?auth_data='.urlencode($credentials['auth_data']));
    $assert($r->getStatusCode()===401,'Query credential rejected');
    [$r,$j]=$call('GET','/api/v10/me',[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['email']===$user->email && !isset($j['data']['password']),'Account resource');
    $assert(!array_key_exists('avatarUrl',$j['data']) && !str_contains($r->getContent(),'cravatar.cn') && !str_contains($r->getContent(),md5($user->email)),'Account response omits third-party avatar email fingerprint');
    $assert($r->headers->get('Content-Language')==='en-US','Language negotiation');
    foreach (['es-MX'=>'es-ES', 'pt-PT'=>'pt-BR', 'fr-CA'=>'fr-FR', 'de-AT'=>'de-DE', 'id'=>'id-ID', 'th'=>'th-TH'] as $header=>$expectedLanguage) {
        [$r,$j]=$call('GET','/api/v10/me',[],$bearer,$header);
        $assert($r->getStatusCode()===200 && $r->headers->get('Content-Language')===$expectedLanguage,'Additional language negotiation: '.$header);
    }
    $originalLanguage=$user->fresh()->language;
    foreach (['fr-FR','de-DE','id-ID','th-TH'] as $newLanguage) {
        [$r,$j]=$call('PATCH','/api/v10/me',['language'=>$newLanguage],$bearer,$newLanguage);
        $assert($r->getStatusCode()===204 && $user->fresh()->language===$newLanguage,'New account language is persisted: '.$newLanguage);
    }
    $user->language=$originalLanguage; $user->save();
    [$r,$j]=$call('GET','/api/v1/user/info',[],$credentials['auth_data']);
    $assert($r->getStatusCode()===200 && $j['data']['email']===$user->email,'Legacy account interoperability');
    [$r,$j]=$call('GET','/api/v10/plans',[],$bearer);
    $row=collect($j['data'])->firstWhere('id',$plan->id);
    $assert($r->getStatusCode()===200 && $row['quotaBytes']===50*1073741824 && $row['monthlyPrice']===1000,'Plan schema and byte units');
    [$r,$j]=$call('GET','/api/v10/plans/'.$plan->id,[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['id']===$plan->id,'Plan detail resource');
    $originalResetSetting=config('v2board.reset_traffic_method',0);
    $originalResetMethod=$plan->fresh()->reset_traffic_method;
    try {
        $plan->reset_traffic_method=null; $plan->save();
        foreach ([0,1,2,3,4] as $resetMethod) {
            config(['v2board.reset_traffic_method'=>$resetMethod]);
            $source=['reset_traffic_method'=>null,'transfer_enable'=>50];
            $projection=App\Http\Resources\V10\Resource::encode('plan',$source);
            $assert($projection['resetMethod']===null && $projection['effectiveResetMethod']===$resetMethod,'Inherited plan reset resolves the actual site policy '.$resetMethod);
            $assert($source===['reset_traffic_method'=>null,'transfer_enable'=>50],'Read-only reset projection leaves its input unchanged');
        }
        config(['v2board.reset_traffic_method'=>3]);
        $beforePlanRead=$plan->fresh()->getAttributes();
        [$r,$j]=$call('GET','/api/v10/plans',[],$bearer);
        $resolvedPlan=collect($j['data'])->firstWhere('id',$plan->id);
        $assert($r->getStatusCode()===200 && $resolvedPlan['resetMethod']===null && $resolvedPlan['effectiveResetMethod']===3,'Plan catalog exposes resolved inherited reset policy');
        $assert($beforePlanRead===$plan->fresh()->getAttributes(),'Plan catalog read does not persist resolved inheritance');
        $plan->reset_traffic_method=0; $plan->save();
        $beforePlanRead=$plan->fresh()->getAttributes();
        [$r,$j]=$call('GET','/api/v10/plans/'.$plan->id,[],$bearer);
        $assert($r->getStatusCode()===200 && $j['data']['resetMethod']===0 && $j['data']['effectiveResetMethod']===0,'Explicit zero reset policy takes precedence over the site default');
        $assert($beforePlanRead===$plan->fresh()->getAttributes(),'Plan detail read does not mutate stored reset policy');
        $nested=App\Http\Resources\V10\Resource::encode('order',['plan'=>['reset_traffic_method'=>null]]);
        $assert($nested['plan']['resetMethod']===null && $nested['plan']['effectiveResetMethod']===3,'Nested order plan uses the same resolved reset projection');
        config(['v2board.reset_traffic_method'=>99]);
        $unknown=App\Http\Resources\V10\Resource::encode('plan',['reset_traffic_method'=>null]);
        $assert(array_key_exists('effectiveResetMethod',$unknown) && $unknown['effectiveResetMethod']===null,'Unsupported reset settings do not invent a known schedule');
    } finally {
        config(['v2board.reset_traffic_method'=>$originalResetSetting]);
        $plan->reset_traffic_method=$originalResetMethod; $plan->save();
    }

    [$r,$j]=$call('POST','/api/v10/me/orders',['planId'=>$plan->id,'billingPeriod'=>'monthly','user'=>['id'=>1]],$bearer);
    $assert($r->getStatusCode()===201 && isset($j['data']['orderNumber']),'Order created '.json_encode($j));
    $old=$j['data']['orderNumber'];
    $assert(Order::where('trade_no',$old)->value('user_id')===$user->id,'Body cannot override ownership');
    [$r,$j]=$call('POST','/api/v10/me/orders',['planId'=>$plan->id,'billingPeriod'=>'annual','replacementOrderNumber'=>$old],$bearer);
    $assert($r->getStatusCode()===201 && Order::where('trade_no',$old)->value('status')===2,'Atomic order replacement '.json_encode($j));
    $new=$j['data']['orderNumber'];
    $other=User::create(['email'=>Str::uuid().'@example.com','password'=>'x','token'=>Str::random(32),'uuid'=>(string)Str::uuid()]);
    $cleanupUsers[]=$other;
    $otherAuth=(new App\Services\AuthService($other))->generateAuthData(Illuminate\Http\Request::create('/'));
    foreach (app('router')->getRoutes() as $machineRoute) {
        if (!str_starts_with($machineRoute->uri(),'api/v10/server/')) continue;
        foreach (array_diff($machineRoute->methods(),['HEAD','OPTIONS']) as $machineMethod) {
            // Enrollment has its own one-time credential and requires an empty JSON object.
            $machineBody=match ($machineRoute->uri()) {
                'api/v10/server/enrollments/redeem'=>[],
                'api/v10/server/enrollments/progress'=>['action'=>'status'],
                default=>['user'=>['id'=>$user->id,'is_admin'=>1]],
            };
            [$machineDenied,$machineProblem]=$call($machineMethod,'/'.$machineRoute->uri(),$machineBody,'Bearer '.$otherAuth['auth_data']);
            $assert($machineDenied->getStatusCode()===401 && !isset($machineProblem['data']),'Account JWT cannot authenticate machine route: '.$machineRoute->uri());
        }
    }
    [$r,$j]=$call('GET','/api/v10/me/orders/'.$new,[],'Bearer '.$otherAuth['auth_data']);
    $assert($r->getStatusCode()===404,'Order ownership is enforced');
    [$r,$j]=$call('GET','/api/v10/me/orders?pageSize=1',[],$bearer);
    $assert($r->getStatusCode()===200 && count($j['data'])===1 && $j['meta']['pagination']['total']>=2 && $j['meta']['pagination']['pageSize']===1,'Pagination contract');
    $billingUser=User::create(['email'=>Str::uuid().'@example.com','password'=>'x','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>4321]);
    $cleanupUsers[]=$billingUser;
    $billingAuth=(new App\Services\AuthService($billingUser))->generateAuthData(Illuminate\Http\Request::create('/'));
    $billingBearer='Bearer '.$billingAuth['auth_data'];
    $billingStart=strtotime('2025-01-01T00:00:00Z');
    $billingPrefix='bill-'.Str::random(8).'-';
    $billingFixtures=[];
    foreach ([['before',-1,3],['lower',0,3],['tie-old',60,3],['tie-new',60,3],['cancelled',120,2],['upper',86400,3],['after',86401,3]] as [$label,$offset,$status]) {
        $billingFixtures[$label]=Order::create(['user_id'=>$billingUser->id,'plan_id'=>$plan->id,'period'=>'month_price','type'=>1,'trade_no'=>$billingPrefix.$label,'total_amount'=>1000,'status'=>$status,'created_at'=>$billingStart+$offset,'updated_at'=>$billingStart+$offset]);
    }
    $foreignBilling=Order::create(['user_id'=>$other->id,'plan_id'=>$plan->id,'period'=>'month_price','type'=>1,'trade_no'=>$billingPrefix.'foreign','total_amount'=>1000,'status'=>3,'created_at'=>$billingStart+60,'updated_at'=>$billingStart+60]);
    $billingBefore=Order::whereIn('id',array_map(fn($order)=>$order->id,array_merge(array_values($billingFixtures),[$foreignBilling])))->orderBy('id')->get()->map(fn($order)=>$order->getAttributes())->all();
    $billingRead=function(array $query) use ($call,$billingBearer) { return $call('GET','/api/v10/me/orders?'.http_build_query($query),[],$billingBearer); };
    $billingWindow=['createdFrom'=>'2025-01-01T00:00:00Z','createdBefore'=>'2025-01-02T00:00:00Z'];
    $billingNumbers=fn(array $payload)=>array_column($payload['data'],'orderNumber');
    [$r,$j]=$billingRead($billingWindow);
    $assert($r->getStatusCode()===200 && $billingNumbers($j)===array_map(fn($label)=>$billingFixtures[$label]->trade_no,['cancelled','tie-new','tie-old','lower']),'Billing range is owner-only, includes its lower boundary, excludes its upper boundary and sorts newest id first on ties');
    $assert($j['meta']['pagination']['total']===4 && $j['meta']['pagination']['totalPages']===1,'Billing totals count only filtered owner results');
    [$r,$j]=$billingRead(['createdFrom'=>$billingWindow['createdFrom']]);
    $assert($r->getStatusCode()===200 && count($j['data'])===6 && !in_array($billingFixtures['before']->trade_no,$billingNumbers($j),true),'Billing lower bound works independently');
    [$r,$j]=$billingRead(['createdBefore'=>$billingWindow['createdBefore']]);
    $assert($r->getStatusCode()===200 && count($j['data'])===5 && $billingNumbers($j)[4]===$billingFixtures['before']->trade_no,'Billing upper bound works independently');
    foreach (['completed'=>['tie-new','tie-old','lower'],'cancelled'=>['cancelled'],'unpaid'=>[]] as $status=>$expectedLabels) {
        [$r,$j]=$billingRead($billingWindow+['status'=>$status]);
        $assert($r->getStatusCode()===200 && $billingNumbers($j)===array_map(fn($label)=>$billingFixtures[$label]->trade_no,$expectedLabels) && $j['meta']['pagination']['total']===count($expectedLabels),'Billing status combines with owner and date filters: '.$status);
    }
    [$r,$j]=$billingRead(['orderNumber'=>$billingFixtures['lower']->trade_no]);
    $assert($r->getStatusCode()===200 && $billingNumbers($j)===[$billingFixtures['lower']->trade_no] && $j['meta']['pagination']['total']===1,'Billing order search is exact');
    foreach ([$billingPrefix, $billingPrefix.'missing', $foreignBilling->trade_no] as $number) {
        [$r,$j]=$billingRead(['orderNumber'=>$number]);
        $assert($r->getStatusCode()===200 && $j['data']===[] && $j['meta']['pagination']===['page'=>1,'pageSize'=>20,'total'=>0,'totalPages'=>0],'Partial, unknown and other-owner billing numbers have the same empty collection contract');
    }
    [$r,$j]=$billingRead($billingWindow+['status'=>'cancelled','orderNumber'=>$billingFixtures['lower']->trade_no]);
    $assert($r->getStatusCode()===200 && $j['data']===[] && $j['meta']['pagination']['total']===0,'Exact order does not bypass other active billing filters');
    [$r,$j]=$billingRead(['orderNumber'=>$billingFixtures['upper']->trade_no]+$billingWindow);
    $assert($r->getStatusCode()===200 && $j['data']===[],'Exact order does not bypass the exclusive creation boundary');
    foreach ([1=>['tie-new','tie-old'],2=>['lower'],3=>[]] as $page=>$expectedLabels) {
        [$r,$j]=$billingRead($billingWindow+['status'=>'completed','page'=>$page,'pageSize'=>2]);
        $assert($r->getStatusCode()===200 && $billingNumbers($j)===array_map(fn($label)=>$billingFixtures[$label]->trade_no,$expectedLabels) && $j['meta']['pagination']===['page'=>$page,'pageSize'=>2,'total'=>3,'totalPages'=>2],'Billing pagination keeps stable filtered totals and ordering on page '.$page);
    }
    [$r,$j]=$billingRead(['createdFrom'=>'2025-01-01T00:00:00.500Z','createdBefore'=>$billingWindow['createdBefore'],'status'=>'completed']);
    $assert($r->getStatusCode()===200 && $billingNumbers($j)===[$billingFixtures['tie-new']->trade_no,$billingFixtures['tie-old']->trade_no],'Fractional lower bound excludes an order created earlier in the same second');
    [$r,$j]=$billingRead(['createdFrom'=>$billingWindow['createdFrom'],'createdBefore'=>'2025-01-01T00:01:00.500Z']);
    $assert($r->getStatusCode()===200 && $billingNumbers($j)===[$billingFixtures['tie-new']->trade_no,$billingFixtures['tie-old']->trade_no,$billingFixtures['lower']->trade_no],'Fractional upper bound includes orders created earlier in the same second');
    [$r,$j]=$billingRead(['createdFrom'=>'2025-01-01T00:00:00.100Z','createdBefore'=>'2025-01-01T00:00:00.900Z']);
    $assert($r->getStatusCode()===200 && $j['data']===[] && $j['meta']['pagination']['total']===0,'A positive subsecond interval is valid even when it contains no second-precision orders');
    foreach ([
        ['createdFrom'=>'not-a-date'],['createdBefore'=>'2025-02-30T00:00:00Z'],
        ['createdFrom'=>'2025-01-01'],['createdBefore'=>'2025-01-02T00:00:00'],
        ['createdFrom'=>'2025-01-01T00:00:00+00:00'],['createdBefore'=>'2025-01-02T08:00:00+08:00'],
        ['createdFrom'=>'2025-01-02T00:00:00Z','createdBefore'=>'2025-01-01T00:00:00Z'],
        ['createdFrom'=>'2025-01-01T00:00:00Z','createdBefore'=>'2025-01-01T00:00:00Z'],
        ['createdFrom'=>'2025-01-01T00:00:00.900Z','createdBefore'=>'2025-01-01T00:00:00.100Z'],
        ['createdFrom'=>'2025-01-01T00:00:00.1234Z'],['createdBefore'=>'2025-01-01T25:00:00Z'],
        ['orderNumber'=>'bad number'],['orderNumber'=>'%'],['orderNumber'=>'bad/number'],['orderNumber'=>str_repeat('a',65)],
    ] as $invalidFilter) {
        [$r,$j]=$billingRead($invalidFilter);
        $assert($r->getStatusCode()===422 && str_contains($r->headers->get('Content-Type'),'application/problem+json') && count(array_intersect(array_keys($invalidFilter),array_keys($j['errors'] ?? [])))>0 && !str_contains(json_encode($j),'validation.'),'Malformed billing filter returns a readable field problem: '.json_encode($invalidFilter));
    }
    $billingAfter=Order::whereIn('id',array_map(fn($order)=>$order->id,array_merge(array_values($billingFixtures),[$foreignBilling])))->orderBy('id')->get()->map(fn($order)=>$order->getAttributes())->all();
    $assert($billingBefore===$billingAfter && $billingUser->fresh()->balance===4321,'Successful and invalid billing reads do not mutate orders or account balance');
    [$r,$j]=$call('GET','/api/v10/me/orders/'.$new,[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['status']==='unpaid' && $j['data']['billingPeriod']==='annual','Order enum contract');
    [$r,$j]=$call('POST','/api/v10/me/orders/'.$new.'/cancellation',[],$bearer);
    $assert($r->getStatusCode()===204 && Order::where('trade_no',$new)->value('status')===2,'Order cancellation');
    [$r,$j]=$call('GET','/api/v10/me/orders?pageSize=101',[],$bearer);
    $assert($r->getStatusCode()===422,'Page limit');
    [$r,$j]=$call('POST','/api/v10/auth/session-exchanges?verificationToken=query-secret');
    $assert($r->getStatusCode()===422,'Session exchange credentials are body-only');
    [$r,$j]=$call('POST','/api/v10/auth/sessions',['email'=>'invalid']);
    $assert($r->getStatusCode()===422 && isset($j['errors']['email']),'Form validation');
    [$r,$j]=$call('GET','/api/v10/subscriptions/not-a-token?format=invalid');
    $assert($r->getStatusCode()===422,'Subscription format allowlist');
    [$r,$j]=$call('GET','/api/v10/me/subscription',[],$bearer);
    $assert($r->getStatusCode()===200 && str_contains($j['data']['subscriptionUrl'],'/api/v10/subscriptions/'),'New subscription link '.json_encode($j));
    config(['v2board.subscribe_path'=>'/custom-subscription']);
    [$r,$j]=$call('GET','/api/v10/me/subscription',[],$bearer);
    $assert(str_contains($j['data']['subscriptionUrl'],'/custom-subscription?token='),'Custom subscription path is preserved');
    config(['v2board.subscribe_path'=>'/api/v1/client/subscribe']);
    [$r,$j]=$call('GET','/api/v10/subscriptions/'.$user->token.'?format=sing-box');
    $assert($r->getStatusCode()===200 && !isset($j['data']) && isset($j['outbounds']),'Native subscription configuration '.json_encode($j));
    [$r,$j]=$call('GET','/api/v1/client/subscribe?token='.$user->token.'&format=sing-box');
    $assert($r->getStatusCode()===404,'Old default subscription is retired');
    app('router')->get('/custom-subscription', [App\Http\Controllers\CustomSubscriptionController::class, 'subscribe'])->middleware('client');
    [$r,$j]=$call('GET','/custom-subscription?token='.$user->token.'&format=sing-box');
    $assert($r->getStatusCode()===200 && isset($j['outbounds']),'Existing custom subscription remains usable');
    $assert(str_contains($r->headers->get('Cache-Control'),'no-store'),'Custom subscription must not be cached');
    [$r,$j]=$call('GET','/custom-subscription?token='.$user->token.'&flag=sing');
    $assert($r->getStatusCode()===422,'Custom subscription rejects retired flag');
    [$r,$j]=$call('GET','/api/v10/subscriptions/'.$user->token.'?flag=sing');
    $assert($r->getStatusCode()===422,'V10 rejects retired flag even without format');
    $user->language='zh-TW'; $user->save();
    foreach ([''=>'zh-TW','en-US'=>'en-US','unsupported'=>'zh-TW'] as $header=>$expected) {
        [$r,$j]=$call('GET','/api/v10/subscriptions/'.$user->token.'?format=sing-box',[],null,$header);
        $assert($r->getStatusCode()===200 && $r->headers->get('Content-Language')===$expected,'Subscription language fallback: '.$header);
    }
    [$r,$j]=$call('GET','/api/v10/subscriptions/'.$user->token.'?format=sing-box&language=ja-JP',[],null,'en-US');
    $assert($r->headers->get('Content-Language')==='ja-JP','Explicit import language takes precedence');
    foreach (['mihomo'=>'mihomo/1.19.0','clash-verge'=>'clash-verge/v2.3.1','flclash'=>'FlClash/0.8.0','shadowrocket'=>'Shadowrocket/2.2.0','surge'=>'Surge/5.0.0','quantumult-x'=>'Quantumult X/1.5.0','stash'=>'Stash/2.0.0'] as $format=>$ua) {
        [$r,$j]=$call('GET','/api/v10/subscriptions/'.$user->token.'?format='.$format,[],null,'en-US',['HTTP_USER_AGENT'=>$ua]);
        $assert($r->getStatusCode()===200 && strlen($r->getContent())>0 && !isset($j['data']),'Native format '.$format.' status '.$r->getStatusCode().' '.substr($r->getContent(),0,300));
    }
    foreach ([1,2] as $mode) {
        config(['v2board.show_subscribe_method'=>$mode]);
        [$r,$j]=$call('GET','/api/v10/me/subscription',[],$bearer);
        $link=$j['data']['subscriptionUrl'];
        $subscriptionToken=basename(parse_url($link,PHP_URL_PATH));
        [$r,$j]=$call('GET',$link.'?format=sing-box');
        $assert($r->getStatusCode()===200 && isset($j['outbounds']),'Generated subscription credential mode '.$mode);
        Illuminate\Support\Facades\Cache::forget('totp_'.$subscriptionToken);
    }
    config(['v2board.show_subscribe_method'=>0]);
    [$r,$j]=$call('GET','/api/v10/no-such-resource');
    $assert($r->getStatusCode()===404 && !isset($j['trace']) && !isset($j['file']),'No debug internals in errors');
    [$r,$j]=$call('OPTIONS','/api/v10/me');
    $assert($r->getStatusCode()===204 && str_contains($r->headers->get('Access-Control-Allow-Methods'),'PATCH'),'CORS preflight');
    foreach (['me/summary','me/session','me/sessions','me/referrals','me/commissions','me/invitations','me/tickets','me/nodes','me/traffic-records','me/notifications','announcements','knowledge-articles','knowledge-categories','me/usage-resets','me/preferences/options','credit-packages','public/banners?placement=dashboard','public/settings','payment-methods'] as $path) {
        [$r,$j]=$call('GET','/api/v10/'.$path,[],$bearer);
        $assert($r->getStatusCode()===200 && array_key_exists('data',$j), 'Read resource '.$path.' '.json_encode($j));
    }
    [$r,$j]=$call('POST','/api/v10/me/tickets',['subject'=>'V10 support','priority'=>'high','message'=>'Local test message'],$bearer);
    $assert($r->getStatusCode()===201 && $j['data']['priority']==='high' && $j['data']['id']>0,'Ticket creation '.json_encode($j));
    $ticketId=$j['data']['id'];
    [$r,$j]=$call('GET','/api/v10/me/tickets/'.$ticketId,[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['messages'][0]['mine']===true,'Ticket message resource');
    [$r,$j]=$call('GET','/api/v10/me/tickets/'.$ticketId,[],'Bearer '.$otherAuth['auth_data']);
    $assert($r->getStatusCode()===404,'Ticket owner cannot be bypassed');
    $foreignBearer='Bearer '.$otherAuth['auth_data'];
    $ticketBefore=App\Models\Ticket::findOrFail($ticketId)->getAttributes();
    $messagesBefore=App\Models\TicketMessage::where('ticket_id',$ticketId)->count();
    $orderBefore=Order::where('trade_no',$new)->firstOrFail()->getAttributes();
    foreach ([['GET','/me/orders/'.$new,[]],['GET','/me/orders/'.$new.'/status',[]],['POST','/me/orders/'.$new.'/payments',['paymentMethodId'=>1]],['POST','/me/orders/'.$new.'/cancellation',[]],['GET','/me/tickets/'.$ticketId,[]],['POST','/me/tickets/'.$ticketId.'/messages',['message'=>'Unauthorized reply']],['POST','/me/tickets/'.$ticketId.'/closure',[]],['POST','/me/notifications/ticket-read-receipts',['ticketId'=>$ticketId,'version'=>1]]] as [$method,$path,$body]) {
        [$denied,$problem]=$call($method,'/api/v10'.$path.'?'.http_build_query(['user'=>['id'=>$user->id],'userId'=>$user->id]),$body+['user'=>['id'=>$user->id,'is_admin'=>1],'userId'=>$user->id],$foreignBearer);
        $assert($denied->getStatusCode()===404 && !isset($problem['data']),'Foreign resource rejects spoofed ownership: '.$method.' '.$path);
    }
    $assert($ticketBefore===App\Models\Ticket::findOrFail($ticketId)->getAttributes() && $messagesBefore===App\Models\TicketMessage::where('ticket_id',$ticketId)->count() && $orderBefore===Order::where('trade_no',$new)->firstOrFail()->getAttributes(),'Denied cross-user actions do not mutate orders or tickets');
    $ownerClaims=(array)Firebase\JWT\JWT::decode($credentials['auth_data'],new Firebase\JWT\Key(config('app.key'),'HS256'));
    [$deleted,$payload]=$call('DELETE','/api/v10/me/sessions/'.urlencode($ownerClaims['session']),[],$foreignBearer);
    $assert($deleted->getStatusCode()===204 && App\Services\AuthService::decryptAuthData($credentials['auth_data'])!==false,'Deleting a foreign session ID cannot revoke its owner session');
    $protectedFields=['id','email','password','token','uuid','is_admin','currency'];
    $beforeOwn=$other->fresh()->only($protectedFields);
    [$changed,$payload]=$call('PATCH','/api/v10/me',['user'=>['id'=>$user->id],'id'=>$user->id,'is_admin'=>1,'is_staff'=>1,'token'=>$user->token,'password'=>'Injected-password-123'],$foreignBearer);
    $assert($changed->getStatusCode()===204 && $beforeOwn===$other->fresh()->only($protectedFields),'Profile input cannot change identity, roles, password or subscription credentials');
    [$me,$payload]=$call('GET','/api/v10/me?user[id]='.$user->id.'&id='.$user->id,[],$foreignBearer);
    $assert($me->getStatusCode()===200 && ($payload['data']['id']??null)===$other->id && !array_intersect(['password','password_algo','password_salt','token','uuid','auth_data'],array_keys($payload['data'])),'Account resource binds identity and excludes raw credentials');
    foreach (['me','plans','payment-methods','knowledge-articles','knowledge-categories'] as $resource) {
        [$private,$payload]=$call('GET','/api/v10/'.$resource,[],$foreignBearer);
        $assert($private->getStatusCode()===200 && str_contains($private->headers->get('Cache-Control'),'no-store'),'Every authenticated resource prohibits storage: '.$resource);
    }
    [$subscription,$payload]=$call('GET','/api/v10/me/subscription?user[id]='.$user->id,[],$foreignBearer);
    $assert($subscription->getStatusCode()===200 && !str_contains($subscription->getContent(),$user->token) && !str_contains($subscription->getContent(),$user->uuid),'Subscription ownership cannot be overridden to disclose another user credentials');
    [$r,$j]=$call('POST','/api/v10/me/tickets',['subject'=>'Duplicate','priority'=>'normal','message'=>'Local test'],$bearer);
    $assert($r->getStatusCode()===409,'Unresolved ticket conflict '.json_encode($j));
    App\Models\TicketMessage::create(['user_id'=>$other->id,'ticket_id'=>$ticketId,'message'=>'Staff fixture reply']);
    [$r,$j]=$call('POST','/api/v10/me/tickets/'.$ticketId.'/messages',['message'=>'Thank you'],$bearer);
    $assert($r->getStatusCode()===204,'Ticket reply');
    [$r,$j]=$call('POST','/api/v10/me/tickets/'.$ticketId.'/closure',[],$bearer);
    $assert($r->getStatusCode()===204,'Ticket closure');
    [$r,$j]=$call('POST','/api/v10/me/usage-resets/consumptions',['requestKey'=>(string)Str::uuid()],$bearer);
    $assert($r->getStatusCode()===422 && isset($j['code']) && $j['status']===422,'Shared service response exceptions preserve 422 '.json_encode($j));
    $payment=App\Models\Payment::create(['uuid'=>Str::random(16),'payment'=>'V10TestPayment','name'=>'Local test provider','config'=>[],'enable'=>1]);
    [$r,$j]=$call('GET','/api/v10/payment-methods',[],$bearer);
    $method=collect($j['data'])->firstWhere('id',$payment->id);
    $assert($method['category']==='regular' && $method['network']===null,'Legacy payment defaults to regular');
    $payment->config=['key'=>'must-not-leak','_console_checkout'=>['category'=>'crypto','asset'=>'USDT','network'=>'tron','networkName'=>'TRON (TRC20)']]; $payment->save();
    [$r,$j]=$call('GET','/api/v10/payment-methods',[],$bearer);
    $method=collect($j['data'])->firstWhere('id',$payment->id);
    $assert($method['asset']==='USDT' && $method['network']==='tron' && $method['networkIconUrl']==='/payment-icons/crypto-trx.svg','Crypto presentation contract');
    $assert(!str_contains(json_encode($j),'must-not-leak') && !isset($method['config']),'Payment provider secrets stay private');
    $payment->enable=0; $payment->save();
    [$r,$j]=$call('GET','/api/v10/payment-methods',[],$bearer);
    $assert(!collect($j['data'])->firstWhere('id',$payment->id),'Disabled crypto channels are absent');
    $payment->enable=1; $payment->save();
    $order=Order::create(['user_id'=>$user->id,'plan_id'=>$plan->id,'period'=>'month_price','trade_no'=>'v10-'.Str::random(16),'total_amount'=>1000,'status'=>0,'type'=>1]);
    $payment->handling_fee_percent=2; $payment->handling_fee_fixed=30; $payment->save();
    [$r,$j]=$call('POST','/api/v10/me/orders/'.$order->trade_no.'/payments',['paymentMethodId'=>$payment->id,'paymentToken'=>'test-card-token'],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['kind']==='redirect','Checkout redirect contract '.json_encode($j));
    $assert((int)App\Payments\V10TestPayment::$lastOrder['total_amount']===1050 && App\Payments\V10TestPayment::$lastOrder['stripe_token']==='test-card-token','Checkout fee and payment token reach provider');
    $assert(parse_url(App\Payments\V10TestPayment::$lastOrder['return_url'],PHP_URL_FRAGMENT)==='/plan/'.$plan->id.'?order='.rawurlencode($order->trade_no),'Checkout passes owned subscription context for an in-place gateway return');
    $assert($order->fresh()->payment_id===$payment->id && $order->fresh()->handling_amount===50 && $order->fresh()->status===0,'Checkout persists fee without prematurely activating');
    $notifyBody=['signature'=>'local-test-signature','orderNumber'=>$order->trade_no,'amount'=>1050,'currency'=>'CNY'];
    [$bad,$problem]=$call('POST','/api/v10/webhooks/payments/MGate/'.$payment->uuid,$notifyBody);
    $assert($bad->getStatusCode()>=400 && $order->fresh()->status===0,'Callback cannot choose a different provider for channel');
    [$r,$j]=$call('POST','/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid,$notifyBody);
    $assert($r->getStatusCode()===200 && $r->getContent()==='success' && $order->fresh()->status===1,'Native payment callback');
    [$r,$j]=$call('POST','/api/v1/guest/payment/notify/V10TestPayment/'.$payment->uuid,$notifyBody);
    $assert($r->getStatusCode()===200 && $r->getContent()==='success','Historical payment callback remains supported');
    $assert(Illuminate\Support\Facades\Queue::pushed(App\Jobs\OrderHandleJob::class)->count()===1,'Duplicate callbacks do not enqueue repeated activation');
    Illuminate\Support\Facades\Queue::pushed(App\Jobs\OrderHandleJob::class)->first()->handle();
    $expiry=$user->fresh()->expired_at;
    $assert($order->fresh()->status===3 && $user->fresh()->plan_id===$plan->id && $expiry>time(),'Payment provisions shared entitlement');
    [$r,$j]=$call('POST','/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid,$notifyBody);
    $assert($user->fresh()->expired_at===$expiry && Illuminate\Support\Facades\Queue::pushed(App\Jobs\OrderHandleJob::class)->count()===1,'Completed callback does not extend subscription twice');
    (new App\Jobs\OrderHandleJob($order->trade_no))->handle();
    $assert($user->fresh()->expired_at===$expiry,'Duplicate activation jobs are idempotent');
    [$r,$j]=$call('GET','/api/v10/me/orders/'.$order->trade_no.'/status',[],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['status']==='completed','Payment polling returns completed state '.json_encode($j));
    [$r,$j]=$call('POST','/api/v10/me/orders/'.$order->trade_no.'/payments',['paymentMethodId'=>$payment->id],$bearer);
    $assert($r->getStatusCode()===409,'Completed orders cannot be paid again');
    $free=Order::create(['user_id'=>$user->id,'plan_id'=>$plan->id,'period'=>'month_price','trade_no'=>'v10-'.Str::random(16),'total_amount'=>0,'status'=>0,'type'=>2]);
    [$r,$j]=$call('POST','/api/v10/me/orders/'.$free->trade_no.'/payments',['paymentMethodId'=>0],$bearer);
    $assert($r->getStatusCode()===200 && $j['data']['kind']==='confirmed' && $free->fresh()->status===1,'Zero-amount checkout '.json_encode($j));
    [$r,$j]=$call('GET','/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid.'?'.http_build_query(['signature'=>'local-test-signature','orderNumber'=>$old,'amount'=>1050,'currency'=>'CNY']));
    $assert($r->getStatusCode()===200 && $r->getContent()==='success' && Order::where('trade_no',$old)->value('status')===2,'Late GET callback cannot activate replaced order');
    [$r,$j]=$call('POST','/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid,['signature'=>'invalid','orderNumber'=>$order->trade_no]);
    $assert($r->getStatusCode()>=400 && $r->getContent()==='fail','Invalid provider signature uses native failure');
    $gateway=(new App\Services\PaymentService('V10TestPayment',$payment->id))->pay(['trade_no'=>$order->trade_no,'total_amount'=>1000,'user_id'=>$user->id,'stripe_token'=>null]);
    $assert(parse_url($gateway['data'],PHP_URL_PATH)==='/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid,'New orders use V10 provider callback');
    $payment->notify_domain='https://callback.example'; $payment->save();
    $gateway=(new App\Services\PaymentService('V10TestPayment',$payment->id))->pay(['trade_no'=>$order->trade_no,'total_amount'=>1000,'user_id'=>$user->id,'stripe_token'=>null]);
    $assert($gateway['data']==='https://callback.example/api/v10/webhooks/payments/V10TestPayment/'.$payment->uuid,'Custom callback domain uses V10 path');
    config(['v2board.app_url'=>'https://example.com','v2board.stop_register'=>0,'v2board.email_whitelist_enable'=>0,'v2board.email_gmail_limit_enable'=>0,'v2board.invite_force'=>1,'v2board.email_verify'=>1,'v2board.try_out_plan_id'=>0]);
    $email=Str::uuid().'@example.com';
    [$r,$j]=$call('POST','/api/v10/me/invitations',['email'=>$email],$bearer);
    $assert($r->getStatusCode()===202 && $j['data']['status']==='queued' && isset($j['meta']['taskId']),'Invitation queue resource '.json_encode($j));
    $invitationJob=Illuminate\Support\Facades\Queue::pushed(App\Jobs\SendInvitationEmailJob::class)->last();
    Illuminate\Support\Facades\RateLimiter::clear($testIp);
    [$r,$j]=$call('POST','/api/v10/auth/email-verifications',['email'=>$email,'invitation'=>$invitationJob->token,'resetPassword'=>false]);
    $assert($r->getStatusCode()===202 && $j['data']['status']==='queued','OTP queued asynchronously '.json_encode($j));
    $assert(Illuminate\Support\Facades\Queue::pushed(App\Jobs\SendEmailJob::class)->last()->queue==='send_email_priority','OTP remains on dedicated priority queue');
    $code=Illuminate\Support\Facades\Cache::get(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$email));
    [$r,$j]=$call('POST','/api/v10/auth/registrations',['email'=>$email,'password'=>'V10newpassword','emailCode'=>$code,'invitation'=>$invitationJob->token,'language'=>'zh-TW']);
    $assert($r->getStatusCode()===201 && $j['data']['tokenType']==='Bearer','Invited registration '.json_encode($j));
    $registered=User::where('email',$email)->first(); $cleanupUsers[]=$registered;
    $assert($registered->invite_user_id===$user->id && $registered->language==='zh-TW','Registration preserves invitation and language');
    $registrationToken=$j['data']['accessToken'];
    Illuminate\Support\Facades\Cache::put(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$email),'123456',300);
    [$r,$j]=$call('POST','/api/v10/auth/password-resets',['email'=>$email,'password'=>'V10changedpassword','emailCode'=>'123456']);
    $assert($r->getStatusCode()===204 && !App\Services\AuthService::decryptAuthData($registrationToken),'Password reset revokes shared sessions');
    [$r,$j]=$call('GET','/api/v10/public/settings',[],null,'en-US;q=0.3, zh-TW;q=0.9');
    $assert($r->headers->get('Content-Language')==='zh-TW','Language quality negotiation');
    Illuminate\Support\Facades\Cache::forget(App\Utils\CacheKey::get('LAST_SEND_EMAIL_VERIFY_TIMESTAMP',$email));
    Illuminate\Support\Facades\RateLimiter::clear('email-invitation:'.$user->id);
    [$r,$j]=$call('PATCH','/api/v10/me',['expiryReminders'=>false,'trafficReminders'=>true,'serviceNotifications'=>false],$bearer);
    $assert($r->getStatusCode()===204 && $user->fresh()->remind_expire===0 && $user->fresh()->remind_traffic===1 && $user->fresh()->remind_service===false,'Boolean preferences adapt to shared validation');
    [$r,$j]=$call('GET','/api/v10/me',[],$bearer);
    $assert($j['data']['serviceNotifications']===false,'Service notification preference returned as a boolean');
    [$r,$j]=$call('PATCH','/api/v10/me',['serviceNotifications'=>'invalid'],$bearer);
    $assert($r->getStatusCode()===422 && $user->fresh()->remind_service===false,'Invalid service preference rejected without mutation');
    $before=$user->fresh()->getAttributes();
    [$r,$j]=$call('GET','/api/v10/me/subscription',[],$bearer);
    $assert($r->getStatusCode()===200 && $before===$user->fresh()->getAttributes(),'Subscription GET does not write business records');
    $imageName=sha1((string)Str::uuid()).'.png';
    Illuminate\Support\Facades\Storage::disk('local')->put('banners/'.$imageName,base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5y0AAAAASUVORK5CYII='));
    [$r,$j]=$call('GET','/api/v10/public/banner-images/'.$imageName);
    $assert($r instanceof Symfony\Component\HttpFoundation\BinaryFileResponse && $r->getStatusCode()===200 && str_contains($r->headers->get('Content-Type'),'image/'),'Native image and CORS response');
    Illuminate\Support\Facades\Storage::disk('local')->delete('banners/'.$imageName);
    $app->instance(App\Services\UsageResetService::class,new class extends App\Services\UsageResetService { public function summary(int $userId): array { throw new RuntimeException('/private/path must not leak'); } });
    [$r,$j]=$call('GET','/api/v10/me/usage-resets',[],$bearer);
    $assert($r->getStatusCode()===500 && !str_contains($j['detail'],'private') && !isset($j['trace']),'Internal exceptions are redacted');
    $app->forgetInstance(App\Services\UsageResetService::class);
    [$r,$j]=$call('GET','/api/v10');
    $assert($r->getStatusCode()===404 && $j['code']==='NOT_FOUND','API root also uses problem details');
    [$r,$j]=$call('GET','/api/v10/me/nodes',[],$bearer);
    $etag=$r->headers->get('ETag');
    [$r,$j]=$call('GET','/api/v10/me/nodes',[],$bearer,'en-US',['HTTP_IF_NONE_MATCH'=>$etag]);
    $assert($r->getStatusCode()===304 && $r->getContent()==='' && $r->headers->get('ETag')===$etag,'Conditional resource reads keep native 304');
    $user->banned=1;$user->save();
    [$r,$j]=$call('GET','/api/v10/me',[],$bearer);
    $assert($r->getStatusCode()===403,'Banned authorization');
    $user->banned=0;$user->save();
    [$r,$j]=$call('DELETE','/api/v10/me/session',[],$bearer);
    $assert($r->getStatusCode()===204 && !App\Services\AuthService::decryptAuthData($credentials['auth_data']),'Cross-version revocation');
    echo "V10 contracts: $checks checks passed\n";
} finally { foreach ($cleanupUsers as $fixture) if ($fixture) (new App\Services\AuthService($fixture))->removeAllSession(); DB::rollBack(); }
