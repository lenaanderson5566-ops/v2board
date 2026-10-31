<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if (!getenv('COMMERCE_TEST_DATABASE')) throw new RuntimeException('Requires isolated database');
use App\Models\{User,Coupon};
use App\Services\{CouponCampaign,CouponWallet,AdminUserFilters};
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
$fails=function($action,$label)use($assert){try{$action();}catch(Illuminate\Validation\ValidationException|Symfony\Component\HttpKernel\Exception\HttpException $e){$assert(true,$label);return;}$assert(false,$label);};
$user=function($email,$banned=0){return User::create(['email'=>$email,'password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid(),'banned'=>$banned,'transfer_enable'=>0]);};
$coupon=function($stock=10){return Coupon::create(['name'=>'Batch fixture','code'=>uniqid(),'type'=>2,'value'=>10,'show'=>1,'public_claim'=>1,'limit_use'=>$stock,'started_at'=>time()-60,'ended_at'=>time()+3600]);};
$preview=function($coupon,$scope='all',$filter=[],$ids=null,$admin=1){$r=Request::create('/','POST',array_filter(['coupon_id'=>$coupon->id,'scope'=>$scope,'filter'=>$filter,'user_ids'=>$ids],fn($v)=>$v!==null));$r->user=['id'=>$admin];return CouponCampaign::preview($r);};
DB::beginTransaction();
try {
    config(['v2board.new_user_currency'=>'CNY']);
    $saveTemplate = function(array $values) {
        $request = App\Http\Requests\Admin\CouponGenerate::create('/', 'POST', $values, [], [], ['HTTP_ACCEPT'=>'application/json']);
        $validator = Illuminate\Support\Facades\Validator::make($request->all(), $request->rules());
        $validator->validate();
        $request->setValidator($validator);
        return (new App\Http\Controllers\V1\Admin\CouponController())->generate($request);
    };
    // Exported timestamps are explicit-offset instants, retaining seconds across a DST fold.
    $originalBusinessZone = config('v2board.system_timezone');
    $originalPhpZone = date_default_timezone_get();
    $csvRows = function($response) {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $response->getContent()));
        rewind($stream); $rows = [];
        while (($row = fgetcsv($stream, 0, ',', '"', '')) !== false) $rows[] = $row;
        fclose($stream); return $rows;
    };
    $csvRequest = function(string $requestClass, array $values) {
        $request = $requestClass::create('/', 'POST', $values, [], [], ['HTTP_ACCEPT'=>'text/csv']);
        $validator = Illuminate\Support\Facades\Validator::make($request->all(), $request->rules());
        $validator->validate(); $request->setValidator($validator); return $request;
    };
    try {
        config(['v2board.system_timezone'=>'America/New_York']);
        date_default_timezone_set('UTC');
        $start = strtotime('2026-11-01T05:30:37Z'); $end = strtotime('2026-11-01T06:30:37Z');
        $couponExport = (new App\Http\Controllers\V1\Admin\CouponController)->generate($csvRequest(
            App\Http\Requests\Admin\CouponGenerate::class,
            ['name'=>'Synthetic CSV coupon','type'=>2,'value'=>10,'started_at'=>$start,'ended_at'=>$end,'generate_count'=>2]
        ));
        $couponRows = $csvRows($couponExport);
        $assert(count($couponRows) === 3 && count($couponRows[0]) === 8, 'Coupon export shape changed');
        $assert($couponRows[0] === ['名称','类型','金额或比例','开始时间','结束时间','可用次数','可用于订阅','生成时间'], 'Coupon export columns changed');
        $giftExport = (new App\Http\Controllers\V1\Admin\GiftcardController)->generate($csvRequest(
            App\Http\Requests\Admin\GiftcardGenerate::class,
            ['name'=>'Synthetic CSV gift card','type'=>1,'value'=>100,'started_at'=>$start,'ended_at'=>$end,'generate_count'=>2]
        ));
        $giftRows = $csvRows($giftExport);
        $assert(count($giftRows) === 3 && count($giftRows[0]) === 8, 'Gift card export shape changed');
        $assert($giftRows[0] === ['名称','类型','数值','开始时间','结束时间','可用次数','礼品卡卡密','生成时间'], 'Gift card export columns changed');
        foreach ([$couponRows, $giftRows] as $rows) foreach (array_slice($rows, 1) as $row) {
            $assert($row[3] === '2026-11-01T01:30:37-04:00' && $row[4] === '2026-11-01T01:30:37-05:00', 'DST export offset or seconds missing');
            $assert(strtotime($row[3]) === $start && strtotime($row[4]) === $end, 'CSV instant changed');
            $assert(preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/D', $row[7]) === 1, 'Creation timestamp omitted its offset');
        }
        $unlimited = (new App\Http\Controllers\V1\Admin\GiftcardController)->generate($csvRequest(
            App\Http\Requests\Admin\GiftcardGenerate::class,
            ['name'=>'Synthetic unlimited CSV','type'=>1,'value'=>100,'started_at'=>0,'ended_at'=>0,'generate_count'=>2]
        ));
        foreach (array_slice($csvRows($unlimited), 1) as $row) $assert($row[3] === '' && $row[4] === '', 'Unlimited export created an epoch date');
    } finally {
        config(['v2board.system_timezone'=>$originalBusinessZone]);
        date_default_timezone_set($originalPhpZone);
    }
    $terms = ['name'=>'Wallet-only fixture','type'=>2,'value'=>10,'started_at'=>time()-60,'ended_at'=>time()+3600];
    $saveTemplate($terms);
    $noCode = Coupon::where('name','Wallet-only fixture')->firstOrFail();
    $assert($noCode->code === '', 'Coupon template unexpectedly generated a code');
    foreach (['code'=>'old-code','generate_codes'=>true,'limit_use_with_user'=>2] as $key=>$value) {
        $fails(fn()=>$saveTemplate($terms + [$key=>$value]), 'Retired coupon parameter accepted: '.$key);
    }
    $saveTemplate(array_replace($terms,['name'=>'Batch-wallet fixture','generate_count'=>2]));
    $assert(Coupon::where('name','Batch-wallet fixture')->where('code','')->count() === 2, 'Batch templates must not generate codes');
    $fails(fn()=>$saveTemplate($terms + ['generate_count'=>2,'generate_codes'=>true]), 'Retired batch code generation accepted');
    $legacy = Coupon::create(array_replace($terms,['name'=>'Historical fixture','code'=>'historical-record','limit_use_with_user'=>2]));
    $saveTemplate(array_replace($terms,['id'=>$legacy->id,'name'=>'Edited historical fixture']));
    $assert($legacy->fresh()->code === 'historical-record', 'Historical storage was overwritten');
    $adminResponse=json_decode((new App\Http\Controllers\V1\Admin\CouponController())->fetch(Request::create('/', 'GET'))->getContent(),true);
    foreach ($adminResponse['data'] as $row) $assert(!array_key_exists('code',$row) && !array_key_exists('limit_use_with_user',$row), 'Admin response exposed retired code data');
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
    $editData = ['id'=>$c->id, 'name'=>'Edited template', 'type'=>2, 'value'=>40, 'started_at'=>time()-60, 'ended_at'=>time()+7200, 'limit_use'=>1];
    $edit = App\Http\Requests\Admin\CouponGenerate::create('/', 'POST', $editData);
    $validator = Illuminate\Support\Facades\Validator::make($editData, $edit->rules());
    $assert($validator->passes(), 'Existing issued template should be editable');
    $edit->setValidator($validator);
    (new App\Http\Controllers\V1\Admin\CouponController())->generate($edit);
    $assert((int)$c->fresh()->value === 40, 'Template update did not persist');
    $invalidEdit = App\Http\Requests\Admin\CouponGenerate::create('/', 'POST', $editData + ['generate_count'=>2]);
    $assert(Illuminate\Support\Facades\Validator::make($invalidEdit->all(), $invalidEdit->rules())->fails(), 'Editing must not generate new templates');
    $issued = DB::table('v2_coupon_wallet')->where('user_id',$a->id)->where('coupon_id',$c->id)->first();
    $assert(json_decode($issued->snapshot,true)['value'] === 10, 'Editing changed an existing wallet');
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
