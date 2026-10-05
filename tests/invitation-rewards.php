<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function (Throwable $e) { fwrite(STDERR,$e->getMessage().PHP_EOL); exit(1); });
use App\Models\User;
use App\Services\InvitationRewardService;
use App\Services\TicketPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
$checks=0;
$assert=function($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$config=config('v2board'); $auth=null;
DB::beginTransaction();
try {
    $group=new App\Models\ServerGroup(); $group->name='Invitation reward test'; $group->save();
    $make=function() { return User::create(['email'=>bin2hex(random_bytes(8)).'@example.com','password'=>'test-only','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'u'=>0,'d'=>0,'transfer_enable'=>0]); };
    $service=new InvitationRewardService();
    config(['v2board.invite_registration_gb'=>0,'v2board.invite_first_use_gb'=>0,'v2board.credit_base_group_id'=>$group->id]);
    $disabled=$make(); $service->register($disabled,1000000001);
    $assert(!DB::table('v2_invitation_reward')->where('user_id',$disabled->id)->exists(),'Disabled rewards enrolled account');
    config(['v2board.invite_registration_gb'=>1,'v2board.invite_first_use_gb'=>2]);
    $user=$make(); $service->register($user,1000000002);
    $assert($user->credit_balance===1073741824,'Registration reward incorrect');
    $assert(App\Services\TrafficCreditService::effectiveGroupId($user)===$group->id && (new App\Services\UserService())->isAvailable($user),'Reward account cannot connect');
    $assert($user->plan_id===null,'Reward changed subscription');
    $assert(DB::table('v2_traffic_credit_log')->where('reference','invite_register:'.$user->id)->count()===1,'Missing reward audit');
    config(['v2board.invite_registration_gb'=>0,'v2board.invite_first_use_gb'=>0,'v2board.invite_credit_months'=>6]);
    $report=function($upload,$download) use ($user) {
        $redis=Redis::getFacadeRoot();
        try {
            Redis::swap(new class($user->id,$upload,$download) {
                private $id,$u,$d;
                function __construct($id,$u,$d) {$this->id=$id;$this->u=$u;$this->d=$d;}
                function exists($key) {return false;}
                function hgetall($key) {return [$this->id=>strpos($key,'upload')!==false?$this->u:$this->d];}
                function del($key) {return 1;}
            });
            (new App\Console\Commands\TrafficUpdate())->handle();
        } finally {Redis::swap($redis);}
    };
    $report(0,0);
    $assert($user->fresh()->credit_balance===1073741824,'Zero usage triggered reward');
    $report(10,0);
    $assert($user->fresh()->credit_balance===3*1073741824-10,'First usage reward or debit incorrect');
    $expiry=DB::table('v2_credit_batch')->where('reference','invite_first_use:'.$user->id)->value('expires_at');
    $assert(abs($expiry-Carbon\Carbon::now('UTC')->addMonthsNoOverflow(1)->timestamp)<5,'First-use validity not snapshotted');
    $report(0,10);
    $assert($user->fresh()->credit_balance===3*1073741824-20,'Repeated usage duplicated reward');
    $assert(DB::table('v2_traffic_credit_log')->where('reference','invite_first_use:'.$user->id)->count()===1,'First-use audit not unique');
    $user->update(['u'=>0,'d'=>0]); $report(1,0);
    $assert($user->fresh()->credit_balance===3*1073741824-21,'Usage reset allowed repeat reward');
    $service->firstUse($disabled->id);
    $assert((int)$disabled->fresh()->credit_balance===0,'Old/disabled account rewarded retroactively');
    config(['v2board.invite_first_use_gb'=>1]);
    $banned=$make(); $service->register($banned,1000000003); $banned->update(['banned'=>1]);
    $service->firstUse($banned->id);
    $assert((int)$banned->fresh()->credit_balance===0,'Banned account rewarded');
    config(['v2board.credit_base_group_id'=>null]);
    $assert(InvitationRewardService::settings()['firstUseBytes']===0,'Rewards advertised without usable group');
    $request=App\Http\Requests\Admin\ConfigSave::create('/', 'POST', ['invite_registration_gb'=>1]);
    $validator=Illuminate\Support\Facades\Validator::make($request->all(),$request->rules());
    $request->withValidator($validator);
    $assert($validator->fails(),'Admin enabled rewards without base group');
    config(['v2board.credit_base_group_id'=>$group->id]);
    $request=App\Http\Requests\Admin\ConfigSave::create('/', 'POST', ['invite_registration_gb'=>0.5]);
    $validator=Illuminate\Support\Facades\Validator::make($request->all(),$request->rules());
    $request->withValidator($validator);
    $assert(!$validator->fails(),'Valid fractional reward rejected');

    config(['v2board.ticket_status'=>2]);
    $assert(TicketPolicy::creation($user->id)==='closed','Closed ticket policy');
    config(['v2board.ticket_status'=>1]);
    $assert(TicketPolicy::creation($user->id)==='purchase_required','Gift credits bypassed paid-order requirement');
    config(['v2board.ticket_status'=>0]);
    $assert(TicketPolicy::creation($user->id)==='allowed','Open ticket policy');
    $auth=new App\Services\AuthService($user);$token=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
    foreach (['me'=>'ticketCreation','me/referrals'=>'rewards'] as $path=>$field) {
        $request=Illuminate\Http\Request::create('/api/v10/'.$path); $request->headers->set('Authorization','Bearer '.$token);$request->headers->set('Accept','application/json');
        $response=$kernel->handle($request);$data=json_decode($response->getContent(),true);
        $assert($response->getStatusCode()===200 && array_key_exists($field,$data['data']),'V10 missing '.$field);
    }
    echo "Invitation rewards: $checks checks passed; database rolled back.\n";
} finally { if ($auth) $auth->removeAllSession(); DB::rollBack();config(['v2board'=>$config]); }
