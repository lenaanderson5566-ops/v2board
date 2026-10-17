<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use App\Models\{User,Coupon};
use App\Services\{CouponPresentation,CouponWallet,CouponCampaign};
use App\Http\Controllers\V1\Admin\CouponPresentationController;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
$migration=require __DIR__.'/../database/migrations/2026_10_14_000010_add_coupon_presentations.php';$migration->up();$migration->up();
DB::beginTransaction();
try {
 $user=User::create(['email'=>'copy@example.test','password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid(),'balance'=>9876,'transfer_enable'=>0]);
 $coupon=Coupon::create(['name'=>'默认券','code'=>uniqid(),'type'=>2,'value'=>15,'show'=>1,'public_claim'=>1,'limit_use'=>10,'started_at'=>time()-60,'ended_at'=>time()+3600]);
 $save=function($extra)use($coupon){return (new CouponPresentationController)->save(Request::create('/','POST',['id'=>$coupon->id]+$extra));};
 $save(['activity_title'=>'默认活动','activity_description'=>'默认说明','translations'=>['en-US'=>['name'=>'Welcome','activityTitle'=>'Welcome offer','activityDescription'=>'Plain <script>text</script>'],'zh-TW'=>['name'=>'繁體券']],'value'=>99,'limit_use'=>999]);
 $terms=$coupon->fresh()->toArray();$copy=CouponPresentation::localized($terms,'en');
 $assert($copy['name']==='Welcome' && $copy['activityTitle']==='Welcome offer','English alias copy');
 $assert($copy['activityDescription']==='Plain <script>text</script>','Text unexpectedly transformed');
 $assert(CouponPresentation::localized($terms,'zh-Hant')['name']==='繁體券','Traditional alias');
 $assert(CouponPresentation::localized($terms,'ja-JP')['activityTitle']==='Welcome offer','Missing language English fallback');
 $assert(CouponPresentation::localized($terms,'de-DE')['name']==='Welcome','German English fallback');
 $assert(CouponPresentation::localized($terms,'zh-TW')['activityDescription']==='默认说明','Missing field fallback');
 $assert($coupon->fresh()->value===15 && $coupon->fresh()->limit_use===10,'Presentation changed financial terms');
 foreach([['xx'=>['name'=>'bad']],['en-US'=>['discountPercent'=>99]],['en-US'=>['name'=>str_repeat('x',101)]]] as $invalid){
  try{$save(['translations'=>$invalid]);throw new RuntimeException('Invalid translation accepted');}catch(Illuminate\Validation\ValidationException $e){$assert(true,'Rejected invalid translation');}
 }
 $old=['name'=>'Old snapshot'];$assert(CouponPresentation::localized($old,'en-US')['name']==='Old snapshot','Old snapshot compatibility');
 $assert(CouponPresentation::localized($old,'en-US')['activityDescription']==='','Old description fallback');
 $wallet=CouponWallet::issue($user->id,$coupon->id);$assert((int)$coupon->fresh()->limit_use===9,'Claim consumes one stock');
 $save(['translations'=>['en-US'=>['name'=>'Changed']]]);app()->setLocale('en-US');
 $assert(CouponWallet::rows($user->id)[0]['name']==='Welcome','Issued translation mutated');
 app()->setLocale('zh-CN');$assert(CouponWallet::rows($user->id)[0]['name']==='默认券','Locale switch uses same snapshot');
 $assert(CouponWallet::issue($user->id,$coupon->id)===$wallet && (int)$coupon->fresh()->limit_use===9,'Repeated claim double consumes stock');
 $second=User::create(['email'=>'campaign-copy@example.test','password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid(),'transfer_enable'=>0]);
 $r=Request::create('/','POST',['coupon_id'=>$coupon->id,'scope'=>'ids','user_ids'=>[$second->id]]);$r->user=['id'=>1];
 $preview=CouponCampaign::preview($r);CouponCampaign::confirm($preview['previewKey'],1);$save(['translations'=>['en-US'=>['name'=>'Changed again']]]);CouponCampaign::process();app()->setLocale('en-US');
 $assert(CouponWallet::rows($second->id)[0]['name']==='Changed','Confirmed campaign translation not frozen');
 $assert($user->fresh()->balance===9876 && $user->fresh()->currency==='CNY','Existing balance changed');

 $assert($user->fresh()->balance===9876,'Repeated migration changed funds');

 $credentials=(new App\Services\AuthService($user))->generateAuthData(Request::create('/'));
 $call=function($path,$language='en-US',$authenticated=true)use($app,$credentials){
  $server=['REMOTE_ADDR'=>'192.0.2.211','HTTP_ACCEPT'=>'application/json','HTTP_ACCEPT_LANGUAGE'=>$language];
  if($authenticated)$server['HTTP_AUTHORIZATION']='Bearer '.$credentials['auth_data'];
  $request=Request::create($path,'GET',[],[],[],$server);$app->instance('request',$request);
  $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
  return [$response,json_decode($response->getContent(),true)];
 };
 [$response,$body]=$call('/api/v10/me/coupons');
 $assert($response->getStatusCode()===200 && $body['data'][0]['name']==='Welcome','Wallet API frozen localized name');
 $assert($response->headers->get('Content-Language')==='en-US' && str_contains($response->headers->get('Cache-Control'),'no-store'),'Private localized response headers');
 [$response,$body]=$call('/api/v10/me/coupon-offers');$assert($response->getStatusCode()===200 && count($body['data'])===0,'Owned coupon still offered');
 $public=Coupon::create(['name'=>'Public base','code'=>uniqid(),'type'=>2,'value'=>20,'show'=>1,'public_claim'=>1,'limit_use'=>4,'started_at'=>time()-60,'ended_at'=>time()+3600,'activity_title'=>'Base title','translations'=>['en-US'=>['name'=>'Public translated','activityTitle'=>'Campaign translated']]]);
 [$response,$body]=$call('/api/v10/me/coupon-offers');
 $assert($response->getStatusCode()===200 && $body['data'][0]['name']==='Public translated' && $body['data'][0]['activityTitle']==='Campaign translated','Offer API locale copy');
 $assert(!isset($body['data'][0]['code']) && !isset($body['data'][0]['translations']) && array_key_exists('activityDescription',$body['data'][0]),'Explicit API fields');
 $assert($public->fresh()->limit_use===4,'GET consumed inventory');
 App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>0,'period'=>'deposit','trade_no'=>uniqid(),'total_amount'=>100,'type'=>9,'status'=>3,'coupon_id'=>$public->id]);
 [$response,$body]=$call('/api/v10/me/coupon-offers');$assert(count($body['data'])===0,'Legacy used coupon still offered');
 [$response,$body]=$call('/api/v10/me/coupon-offers','en-US',false);$assert($response->getStatusCode()===401,'Public offer exposed without auth');
 echo "Coupon presentations: $checks checks passed; transaction rolled back.\n";
}finally {DB::rollBack();}
