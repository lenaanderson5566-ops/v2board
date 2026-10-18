<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use Illuminate\Support\Facades\DB;
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
Illuminate\Support\Facades\Queue::fake();
$checks=0;$failures=[];
$assert=function($ok,$label) use (&$checks,&$failures){$checks++;if(!$ok)$failures[]=$label;};
$status=function($callback){try{$callback();return 200;}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){return $e->getStatusCode();}};
// Constructing the webhook action checks authentication without sending network traffic.
foreach (['/api/v10/webhooks/telegram','/api/v1/guest/telegram/webhook'] as $path) {
    foreach ([[null,1,md5(''),401],['',1,md5(''),401],['test-token',0,md5('test-token'),401],['test-token',1,'wrong',401],['test-token',1,md5('test-token'),200]] as [$token,$enabled,$secret,$expected]) {
        config(['v2board.telegram_bot_token'=>$token,'v2board.telegram_bot_enable'=>$enabled]);
        $r=Illuminate\Http\Request::create($path,'POST',['access_token'=>$secret],[],[],['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'=>$secret]);
        $assert($status(fn()=>new App\Services\Actions\Guest\TelegramActions($r))===$expected,'Telegram rejects missing/disabled/incorrect credentials: '.$path.' '.$expected);
    }
}
config(['v2board.telegram_bot_enable'=>0]);
$rules=(new App\Http\Requests\Admin\PlanSave())->rules();
foreach (['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price','onetime_price','reset_price'] as $field) {
    foreach ([-1,null,0,100] as $price) {
        $valid=validator([$field=>$price],[$field=>$rules[$field]])->passes();
        $assert($valid===($price!==-1),'Admin price validation: '.$field.' '.var_export($price,true));
    }
}
// Legacy failures must remain safe regardless of Accept or APP_DEBUG.
config(['app.debug'=>true]);
foreach (['application/json','text/html'] as $accept) {
    $request=Illuminate\Http\Request::create('/api/v1/missing','GET',[],[],[],['HTTP_ACCEPT'=>$accept]);
    $app->instance('request',$request);
    foreach ([new RuntimeException('SECRET_INTERNAL_PATH'), new Symfony\Component\HttpKernel\Exception\HttpException(500,'SECRET_INTERNAL_PATH')] as $error) {
        $response=app(App\Exceptions\Handler::class)->render($request,$error);
        $data=json_decode($response->getContent(),true);
        $assert($response->getStatusCode()===500 && is_array($data) && array_keys($data)===['message']
            && !str_contains($response->getContent(),'SECRET_INTERNAL_PATH'),'Legacy API masks debug errors: '.$accept);
        $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'API errors cannot be cached');
    }
}
config(['app.debug'=>false]);
DB::beginTransaction();
try {
    $u=User::create(['email'=>uniqid('audit-').'@example.com','password'=>'test','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'balance'=>0,'commission_balance'=>0]);
    foreach (['admin'] as $role) {
        $u->{'is_'.$role}=1; $u->save();
        $auth=new App\Services\AuthService($u);
        $token=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
        $middleware=new App\Http\Middleware\Admin();
        try {
            foreach (['GET','POST'] as $method) {
                $request=Illuminate\Http\Request::create('/api/v1/'.$role.'?auth_data='.urlencode($token),$method);
                $assert($status(fn()=>$middleware->handle($request,fn()=>response('ok')))===403,'Reject privileged query credential: '.$role.' '.$method);
            }
            foreach (['header','body'] as $source) {
                $request=Illuminate\Http\Request::create('/api/v1/'.$role,'POST',$source==='body'?['auth_data'=>$token]:[],[],[],
                    $source==='header'?['HTTP_AUTHORIZATION'=>$token]:[]);
                $response=$middleware->handle($request,fn()=>response('ok'));
                $assert($response->getStatusCode()===200 && str_contains($response->headers->get('Cache-Control'),'no-store'),'Retain privileged '.$source.' authentication without caching');
            }
        } finally {$auth->removeAllSession();}
        $u->{'is_'.$role}=0; $u->save();
    }
    $legacyAuth=new App\Services\AuthService($u);
    $legacyToken=$legacyAuth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    try {
        foreach (['GET','POST'] as $method) {
            $request=Illuminate\Http\Request::create('/api/v1/user/info?auth_data='.urlencode($legacyToken),$method);
            $assert($status(fn()=>(new App\Http\Middleware\User())->handle($request,fn()=>response('ok')))===403,'Legacy user authentication rejects URL credentials: '.$method);
        }
        foreach ([false,true] as $json) {
            $request=$json
                ? Illuminate\Http\Request::create('/api/v1/user/logout','POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode(['auth_data'=>['id'=>$u->id,'is_admin'=>1]]))
                : Illuminate\Http\Request::create('/api/v1/user/logout','POST',['auth_data'=>['id'=>$u->id,'is_admin'=>1]]);
            $assert($status(fn()=>(new App\Http\Middleware\User())->handle($request,fn()=>response('ok')))===403,'Legacy user authentication rejects body arrays');
        }
        $request=Illuminate\Http\Request::create('/api/v1/user/info?auth_data[is_admin]=1','GET',[],[],[],['HTTP_AUTHORIZATION'=>$legacyToken]);
        $assert((new App\Http\Middleware\User())->handle($request,fn()=>response('ok'))->getStatusCode()===200,'Header credential takes priority over malicious query input');
        $subscriptionMethod=config('v2board.show_subscribe_method');
        foreach ([0,1,2] as $mode) {
            config(['v2board.show_subscribe_method'=>$mode]);
            foreach ([['token'=>$u->token],['is_admin'=>1],1,true] as $credential) {
                $request=Illuminate\Http\Request::create('/api/v1/client/app/getVersion','GET',['token'=>$credential],[],[],['REMOTE_ADDR'=>'198.18.0.'.random_int(1,254)]);
                $assert($status(fn()=>(new App\Http\Middleware\Client())->handle($request,fn()=>response('ok')))===403,'Subscription credentials must be strings in every legacy token mode');
            }
        }
        config(['v2board.show_subscribe_method'=>$subscriptionMethod]);
        $request=Illuminate\Http\Request::create('/api/v1/user/info','GET',[],[],[],['HTTP_AUTHORIZATION'=>$legacyToken]);
        $middleware=new App\Http\Middleware\User();
        $assert(str_contains($middleware->handle($request,fn()=>response('ok'))->headers->get('Cache-Control'),'no-store'),'Legacy user data is not cached');
        $u->banned=1;$u->save();
        $assert($status(fn()=>$middleware->handle($request,fn()=>response('ok')))===403,'Legacy route rejects a newly banned user');
        $u->banned=0;$u->save();
    } finally {$legacyAuth->removeAllSession();}
    require __DIR__.'/fixtures/V10TestPayment.php';
    config(['v2board.app_url'=>'https://panel.example','cors.allowed_origins'=>['https://frontend.example']]);
    $channel=App\Models\Payment::create(['name'=>'URL fixture','payment'=>'V10TestPayment','uuid'=>'url-fixture','enable'=>1,'config'=>[]]);
    foreach (['https://evil.example','https://frontend.example',null] as $origin) {
        $request=Illuminate\Http\Request::create('https://panel.example/api/v10/me/orders','POST',[],[],[],
            ['HTTP_ORIGIN'=>$origin,'HTTP_X_FORWARDED_HOST'=>'evil.example','HTTP_X_ORIGINAL_HOST'=>'evil.example','HTTP_X_FORWARDED_PROTO'=>'http']);
        $app->instance('request',$request);
        (new App\Services\PaymentService('V10TestPayment',$channel->id))->pay(['trade_no'=>'test-order','total_amount'=>100,'user_id'=>$u->id,'stripe_token'=>null]);
        $sent=App\Payments\V10TestPayment::$lastOrder;
        $assert($sent['notify_url']==='https://panel.example/api/v10/webhooks/payments/V10TestPayment/url-fixture','Callback URL ignores forwarding headers');
        $assert($sent['return_url']===($origin==='https://frontend.example'?$origin:'https://panel.example').'/#/order/test-order','Payment return requires allowed origin');
    }
    $analytics=app(App\Services\ProductAnalytics::class);
    $analytics->save(['enabled'=>false,'retentionDays'=>7]);
    $event=['sessionId'=>(string)Illuminate\Support\Str::uuid(),'page'=>'plan','device'=>'desktop','language'=>'zh-CN','consent'=>true];
    $before=DB::table('v2_analytics_session')->count();
    $analytics->record($event);
    $assert(DB::table('v2_analytics_session')->count()===$before,'Disabled analytics persists nothing');
    $analytics->save(['enabled'=>true,'retentionDays'=>7]);
    foreach (['payment','plan','confirmation','payment'] as $page) {$event['page']=$page;$analytics->record($event);}
    $hash=hash_hmac('sha256',$event['sessionId'],(string)config('app.key'));
    $session=DB::table('v2_analytics_session')->where('session_hash',$hash)->first();
    $assert($session && $session->stage===3 && $session->session_hash!==$event['sessionId'],'Analytics hashes identity and advances ordered funnel');
    $assert(!array_intersect(['ip','email','user_id','ua','url'],array_keys((array)$session)),'Analytics persists no account/network identity');
    $controller=app(App\Http\Controllers\V10\ProductAnalyticsController::class);
    foreach ([['https://evil.example',[],403],['https://panel.example',['email'=>'private@example.com'],422]] as [$origin,$extra,$expected]) {
        $request=Illuminate\Http\Request::create('/api/v10/public/analytics/events','POST',[],[],[],['HTTP_ORIGIN'=>$origin,'CONTENT_TYPE'=>'application/json'],json_encode($event+$extra));
        $app->instance('request',$request);
        $assert($status(fn()=>$controller->store($request,$analytics))===$expected,'Analytics rejects foreign origin or unexpected personal fields');
    }
    $event['sessionId']=(string)Illuminate\Support\Str::uuid();
    $request=Illuminate\Http\Request::create('/api/v10/public/analytics/events','POST',[],[],[],['HTTP_ORIGIN'=>'https://panel.example','CONTENT_TYPE'=>'application/json','HTTP_SEC_GPC'=>'1'],json_encode($event));
    $app->instance('request',$request);
    $assert($controller->store($request,$analytics)->getStatusCode()===204 && DB::table('v2_analytics_session')->count()===$before+1,'GPC suppresses analytics recording');
    DB::table('v2_analytics_session')->where('id',$session->id)->update(['created_at'=>time()-8*86400]);
    $assert($analytics->prune()>=1 && !DB::table('v2_analytics_page')->where('session_id',$session->id)->exists(),'Retention prunes sessions and page records');
    $analytics->save(['enabled'=>false,'retentionDays'=>30]);
    $p=Plan::create(['name'=>'Audit fixture','group_id'=>1,'transfer_enable'=>10,'month_price'=>-100,'show'=>1,'renew'=>1]);
    $r=App\Http\Requests\User\OrderSave::create('/api/v10/me/orders','POST',['plan_id'=>$p->id,'period'=>'month_price']);$r->user=['id'=>$u->id];$app->instance('request',$r);
    $assert($status(fn()=>(new App\Services\Actions\User\OrderActions())->save($r))===409,'Negative configured price cannot create an order');
    $assert(Order::where('user_id',$u->id)->count()===0,'Rejected price creates no order');
    Order::where('user_id',$u->id)->delete();
    foreach ([-100,0] as $amount) {
        $o=Order::create(['user_id'=>$u->id,'plan_id'=>$p->id,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>$amount,'status'=>0,'type'=>1]);
        $r=Illuminate\Http\Request::create('/api/v10/me/orders/checkout','POST',['trade_no'=>$o->trade_no]);$r->user=['id'=>$u->id];$app->instance('request',$r);
        $assert($status(fn()=>(new App\Services\Actions\User\OrderActions())->checkout($r))===($amount<0?409:200),'Checkout amount '.$amount);
        $assert((int)$o->fresh()->status===($amount<0?0:1),'Checkout must preserve negative orders and accept legitimate free orders');
    }
} finally {DB::rollBack();}
foreach($failures as $failure) fwrite(STDERR,"FAIL: $failure\n");
echo "Backend security: $checks checks, ".count($failures)." failures; rollback.\n";
exit($failures?1:0);
