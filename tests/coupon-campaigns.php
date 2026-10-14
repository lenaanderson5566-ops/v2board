<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require __DIR__.'/commerce-bootstrap.php';
if (!getenv('COMMERCE_TEST_DATABASE')) throw new RuntimeException('Requires isolated database');
use App\Models\{User,Coupon};
use App\Services\{CouponCampaign,CouponWallet,AdminUserFilters};
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$checks=0;
$assert=function($value,$label)use(&$checks){if(!$value)throw new RuntimeException($label);$checks++;};
$fails=function($action,$label)use($assert){try{$action();}catch(Illuminate\Validation\ValidationException|Symfony\Component\HttpKernel\Exception\HttpException $e){$assert(true,$label);return;}$assert(false,$label);};
$user=function($email,$banned=0){return User::create(['email'=>$email,'password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid(),'banned'=>$banned,'transfer_enable'=>0]);};
$coupon=function($stock=10){return Coupon::create(['name'=>'Batch fixture','code'=>uniqid(),'type'=>2,'value'=>10,'show'=>1,'public_claim'=>1,'limit_use'=>$stock,'started_at'=>time()-60,'ended_at'=>time()+3600]);};
$preview=function($coupon,$scope='all',$filter=[],$ids=null,$admin=1){$r=Request::create('/','POST',array_filter(['coupon_id'=>$coupon->id,'scope'=>$scope,'filter'=>$filter,'user_ids'=>$ids],fn($v)=>$v!==null));$r->user=['id'=>$admin];return CouponCampaign::preview($r);};
DB::beginTransaction();
try {
    config(['v2board.new_user_currency'=>'CNY']);
    $a=$user('a@example.test');$b=$user('b@example.test');$disabled=$user('disabled@example.test',1);
    $c=$coupon(3);CouponWallet::issue($a->id,$c->id,1);
    $batch=$preview($c);
    $assert($batch['matched']===3 && $batch['pending']===1 && $batch['skipped']===2,'Preview eligibility');
    $assert((int)$c->fresh()->limit_use===2,'Preview reserved stock early');
    $later=$user('later@example.test');
    $fails(fn()=>CouponCampaign::confirm($batch['previewKey'],2),'Other admin confirmed preview');
    $confirmed=CouponCampaign::confirm($batch['previewKey'],1);
    $assert($confirmed['status']==='queued' && (int)$c->fresh()->limit_use===1,'Confirmation did not reserve stock');
    CouponCampaign::confirm($batch['previewKey'],1);$assert((int)$c->fresh()->limit_use===1,'Repeat confirmation double reserved');
    $c->value=40;$c->save();
    CouponCampaign::process();CouponCampaign::process();
    $wallet=DB::table('v2_coupon_wallet')->where('user_id',$b->id)->where('coupon_id',$c->id)->first();
    $assert(json_decode($wallet->snapshot,true)['value']==10,'Campaign terms changed after confirmation');
    $assert(!DB::table('v2_coupon_wallet')->where('user_id',$later->id)->where('coupon_id',$c->id)->exists(),'New registration joined frozen audience');
    $assert((int)$c->fresh()->limit_use===1 && CouponCampaign::present($batch['id'])['issued']===1,'Delivery double consumed stock');
    $assert(DB::table('v2_coupon_wallet')->where('coupon_id',$c->id)->count()===2,'Replay delivered twice');

    $f=$coupon();$filtered=$preview($f,'filtered',[['key'=>'email','condition'=>'=','value'=>'b@example.test']]);
    $assert($filtered['matched']===1 && $filtered['pending']===1,'Shared filters differ from user list');
    CouponCampaign::cancel($filtered['id'],1);$fails(fn()=>CouponCampaign::confirm($filtered['previewKey'],1),'Cancelled preview confirmed');
    $fails(fn()=>$preview($f,'filtered',[]),'Empty filters accepted as all');
    $fails(fn()=>$preview($f,'all',[['key'=>'email','condition'=>'=','value'=>'a@example.test']]),'Mixed scope accepted');
    $fails(fn()=>$preview($f,'filtered',[['key'=>'password','condition'=>'=','value'=>'fixture']]),'Unsafe filter field accepted');
    $fails(fn()=>$preview($f,'filtered',[['key'=>'email','condition'=>'=','value'=>['x']]]),'Non-scalar filter accepted');
    $r=Request::create('/','POST',['filter'=>[['key'=>'email','condition'=>'模糊','value'=>'@example.test']]]);$q=User::query();AdminUserFilters::apply($r,$q);
    $assert($q->count()===4,'Shared user search regression');

    $low=$coupon(1);$lowBatch=$preview($low,'ids',[],[$a->id,$b->id]);
    $fails(fn()=>CouponCampaign::confirm($lowBatch['previewKey'],1),'Insufficient stock started partial campaign');
    $assert((int)$low->fresh()->limit_use===1 && CouponCampaign::present($lowBatch['id'])['status']==='draft','Failed confirm mutated state');
    CouponCampaign::cancel($lowBatch['id'],1);

    $cancel=$coupon(4);$cancelBatch=$preview($cancel,'ids',[],[$a->id,$b->id]);CouponCampaign::confirm($cancelBatch['previewKey'],1);
    CouponCampaign::process(1);
    $fails(fn()=>CouponCampaign::cancel($cancelBatch['id'],2),'Other admin cancelled campaign');
    CouponCampaign::cancel($cancelBatch['id'],1);CouponCampaign::cancel($cancelBatch['id'],1);CouponCampaign::process();
    $summary=CouponCampaign::present($cancelBatch['id']);
    $assert($summary['issued']===1 && $summary['cancelled']===1 && (int)$cancel->fresh()->limit_use===3,'Cancellation did not refund only remaining stock once');

    $race=$coupon(3);$raceBatch=$preview($race,'ids',[],[$a->id]);CouponWallet::issue($a->id,$race->id,1);CouponCampaign::confirm($raceBatch['previewKey'],1);CouponCampaign::process();
    $assert((int)$race->fresh()->limit_use===2 && CouponCampaign::present($raceBatch['id'])['skipped']===1,'Claim between preview and confirm lost reserved stock');

    $changed=$coupon();$changedBatch=$preview($changed,'ids',[],[$a->id]);$changed->value=20;$changed->save();
    $fails(fn()=>CouponCampaign::confirm($changedBatch['previewKey'],1),'Changed template confirmed without new preview');
    CouponCampaign::cancel($changedBatch['id'],1);
    $expired=$coupon();$expiredBatch=$preview($expired,'ids',[],[$b->id]);DB::table('v2_coupon_campaign')->where('id',$expiredBatch['id'])->update(['expires_at'=>time()-1]);
    $fails(fn()=>CouponCampaign::confirm($expiredBatch['previewKey'],1),'Expired preview confirmed');CouponCampaign::cancel($expiredBatch['id'],1);

    $gone=$coupon(1);$goneBatch=$preview($gone,'ids',[],[$later->id]);CouponCampaign::confirm($goneBatch['previewKey'],1);$later->delete();CouponCampaign::process();
    $assert((int)$gone->fresh()->limit_use===1 && CouponCampaign::present($goneBatch['id'])['skipped']===1,'Deleted user reservation not refunded');
    $unlimited=$coupon(null);$unlimitedBatch=$preview($unlimited,'ids',[],[$b->id]);CouponCampaign::confirm($unlimitedBatch['previewKey'],1);CouponCampaign::process();
    $assert($unlimited->fresh()->limit_use===null && CouponCampaign::present($unlimitedBatch['id'])['issued']===1,'Unlimited stock broken');
    $retry=$coupon(1);$retryBatch=$preview($retry,'ids',[],[$a->id]);CouponCampaign::confirm($retryBatch['previewKey'],1);
    $failWallet=true;
    DB::listen(function($query)use(&$failWallet){if($failWallet && str_starts_with($query->sql,'insert into `v2_coupon_wallet`'))throw new RuntimeException('fixture failure after insert');});
    for($attempt=1;$attempt<=3;$attempt++) {
        DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$retryBatch['id'])->update(['available_at'=>time()]);
        CouponCampaign::process();
        $assert(!DB::table('v2_coupon_wallet')->where('coupon_id',$retry->id)->exists(),'Failed delivery left a wallet record');
    }
    $failWallet=false;
    $assert(CouponCampaign::present($retryBatch['id'])['failed']===1 && (int)$retry->fresh()->limit_use===1,'Terminal failure did not refund stock');
    (require __DIR__.'/../database/migrations/2026_10_14_000009_add_coupon_campaigns.php')->up();
    $assert(DB::table('v2_coupon_campaign')->count()>0,'Repeat migration lost history');
    echo "Coupon campaigns: $checks checks passed; rollback.\n";
} finally {DB::rollBack();}
