<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use App\Models\User;
use App\Models\Order;
use Illuminate\Support\Facades\DB;
if (($argv[1]??'')==='worker') {
    $r=App\Http\Requests\User\UserTransfer::create('/api/v10/me/commission-transfers','POST',['transfer_amount'=>1000]);
    $r->user=['id'=>(int)$argv[2]];$app->instance('request',$r);
    echo "ready\n";fflush(STDOUT);fgets(STDIN);
    try {(new App\Services\Actions\User\UserActions())->transfer($r);echo '200';}
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {echo $e->getStatusCode();}
    exit;
}
$u=User::create(['email'=>uniqid('transfer-race-').'@example.com','password'=>'test','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'balance'=>0,'commission_balance'=>1000]);
$processes=[];$rewardUsers=[];$previousConfig=config('fastai');
try {
    DB::beginTransaction();User::whereKey($u->id)->lockForUpdate()->first();
    // Simulate a wallet credit that commits while transfers are waiting.
    User::whereKey($u->id)->update(['balance'=>500]);
    for($i=0;$i<2;$i++) {
        $process=proc_open([PHP_BINARY,__FILE__,'worker',(string)$u->id],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Worker unavailable');
        stream_set_timeout($pipes[1],10);
        $processes[]=[$process,$pipes];
        if(trim(fgets($pipes[1]))!=='ready')throw new RuntimeException('Worker not ready');
    }
    foreach($processes as [$process,$pipes]) {fwrite($pipes[0],"go\n");fflush($pipes[0]);fclose($pipes[0]);}
    // Hold the row while both workers enter their competing transactions.
    usleep(500000);DB::commit();
    $results=[];
    foreach($processes as [$process,$pipes]) {
        $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0)throw new RuntimeException('Worker failed: '.$err.' '.$out);
        $results[]=(int)$out;
    }
    $processes=[];sort($results);
    $count=Order::where('user_id',$u->id)->count();$u->refresh();
    if($results!==[200,409] || $count!==1 || (int)$u->balance!==1500 || (int)$u->commission_balance!==0)
        throw new RuntimeException('Concurrent transfer results='.json_encode($results).', orders='.$count.', balance='.$u->balance.', commission='.$u->commission_balance);
    // An ordinary referrer can earn commission without buying a plan. Moving
    // that commission into a wallet is not another sale for their own inviter.
    config(['fastai.new_user_currency'=>'CNY','fastai.invite_commission'=>10,'fastai.commission_distribution_enable'=>0,
        'fastai.commission_auto_check_enable'=>1,'fastai.withdraw_close_enable'=>0]);
    $inviter=User::create(['email'=>uniqid('transfer-inviter-').'@example.test','password'=>'fixture','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'currency'=>'CNY','commission_type'=>1,'commission_balance'=>0,'balance'=>0]);
    $rewardUsers[]=$inviter->id;
    $referrer=User::create(['email'=>uniqid('transfer-referrer-').'@example.test','password'=>'fixture','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'currency'=>'CNY','invite_user_id'=>$inviter->id,'commission_balance'=>1000,'balance'=>0]);
    $rewardUsers[]=$referrer->id;
    $r=App\Http\Requests\User\UserTransfer::create('/api/v10/me/commission-transfers','POST',['transfer_amount'=>1000]);
    $r->user=['id'=>$referrer->id];$app->instance('request',$r);
    (new App\Services\Actions\User\UserActions())->transfer($r);
    $ledger=Order::where('user_id',$referrer->id)->sole();$referrer->refresh();
    if($referrer->is_admin || $inviter->is_admin || (int)$referrer->commission_balance!==0 || (int)$referrer->balance!==1000
        || (int)$ledger->type!==9 || $ledger->period!=='deposit' || (int)$ledger->status!==3 || (int)$ledger->total_amount!==0
        || (int)$ledger->surplus_amount!==1000 || $ledger->paid_at!==null || $ledger->callback_no!=='佣金划转 Commission transfer')
        throw new RuntimeException('Internal commission transfer changed the wallet or ledger business contract');
    DB::table('v2_order')->where('id',$ledger->id)->update(['updated_at'=>time()-4*86400]);
    (new App\Console\Commands\CheckCommission())->handle();
    $inviter->refresh();$referrer->refresh();
    $rewardLogs=App\Models\CommissionLog::where('trade_no',$ledger->trade_no)->count();
    if((int)$inviter->commission_balance!==0 || (int)$inviter->balance!==0 || $rewardLogs!==0)
        throw new RuntimeException('Internal transfer created unbacked referral credit: inviter commission='.$inviter->commission_balance.', wallet='.$inviter->balance.', logs='.$rewardLogs);
    if((int)$referrer->balance!==1000 || (int)$referrer->commission_balance!==0 || (int)$ledger->fresh()->commission_balance!==0)
        throw new RuntimeException('Commission transfer did not conserve the original 1000 minor units');
    $historical=function(int $commissionStatus,array $overrides=[])use($referrer,$inviter) {
        return Order::create(array_replace(['user_id'=>$referrer->id,'invite_user_id'=>$inviter->id,'currency'=>'CNY','plan_id'=>0,'type'=>9,'period'=>'deposit',
            'trade_no'=>App\Utils\Helper::generateOrderNo(),'status'=>3,'total_amount'=>0,'surplus_amount'=>1000,'commission_balance'=>100,'commission_status'=>$commissionStatus,
            'callback_no'=>'佣金划转 Commission transfer','paid_at'=>null,'created_at'=>time()-5*86400,'updated_at'=>time()-4*86400],$overrides));
    };
    $oldPending=$historical(0);$oldApproved=$historical(1);
    $alreadyIssued=$historical(2,['actual_commission_balance'=>100]);$issuedState=$alreadyIssued->fresh()->getAttributes();
    (new App\Console\Commands\CheckCommission())->handle();
    foreach([$oldPending,$oldApproved] as $old) {
        $old->refresh();
        if((int)$old->commission_status!==3 || (int)$old->commission_balance!==100 || (int)$old->invite_user_id!==(int)$inviter->id
            || App\Models\CommissionLog::where('trade_no',$old->trade_no)->exists())
            throw new RuntimeException('Historical internal transfer was not rejected with its amount and attribution preserved');
    }
    if((int)$inviter->fresh()->commission_balance!==0 || $issuedState!==$alreadyIssued->fresh()->getAttributes())
        throw new RuntimeException('Legacy transfer quarantine credited or rewrote already-issued commission');
    $staleIssued=$alreadyIssued->fresh();$staleIssued->commission_status=1;
    (new App\Console\Commands\CheckCommission())->payHandle($inviter->id,$staleIssued);
    if($issuedState!==$alreadyIssued->fresh()->getAttributes() || (int)$inviter->fresh()->commission_balance!==0)
        throw new RuntimeException('A stale commission projection rewrote or repaid an already-issued internal transfer');
    $direct=$historical(1);
    (new App\Console\Commands\CheckCommission())->payHandle($inviter->id,$direct);
    $direct->refresh();
    if((int)$inviter->fresh()->commission_balance!==0 || (int)$direct->commission_status!==3
        || (int)$direct->commission_balance!==100 || (int)$direct->invite_user_id!==(int)$inviter->id
        || App\Models\CommissionLog::where('trade_no',$direct->trade_no)->exists())
        throw new RuntimeException('Direct settlement did not reject internal commission while preserving its audit evidence');
    // Historical fully wallet-funded/offset subscriptions can legitimately carry
    // commission. Zero external due alone must not invalidate such orders.
    $walletPaid=$historical(1,['plan_id'=>1,'type'=>1,'period'=>'month_price','balance_amount'=>1000,'surplus_amount'=>0,'paid_at'=>time()-4*86400,'callback_no'=>'legacy-wallet-paid']);
    $offsetPaid=$historical(1,['plan_id'=>1,'type'=>3,'period'=>'month_price','status'=>4,'paid_at'=>time()-4*86400,'callback_no'=>'legacy-offset-paid']);
    (new App\Console\Commands\CheckCommission())->autoPayCommission();
    if((int)$inviter->fresh()->commission_balance!==200 || (int)$walletPaid->fresh()->commission_status!==2 || (int)$offsetPaid->fresh()->commission_status!==2
        || App\Models\CommissionLog::whereIn('trade_no',[$walletPaid->trade_no,$offsetPaid->trade_no])->count()!==2)
        throw new RuntimeException('Internal-transfer protection rejected a legitimate zero-external-due historical subscription');

    $upstream = User::create([
        'email'=>uniqid('commission-upstream-').'@example.test', 'password'=>'fixture',
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(),
        'currency'=>'CNY', 'commission_balance'=>0,
    ]);
    $rewardUsers[] = $upstream->id;
    $inviter->update(['invite_user_id'=>$upstream->id]);
    $deletedInviter = User::create([
        'email'=>uniqid('commission-deleted-inviter-').'@example.test', 'password'=>'fixture',
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(),
        'invite_user_id'=>$upstream->id, 'account_deleted_at'=>time(), 'banned'=>1,
    ]);
    $rewardUsers[] = $deletedInviter->id;

    // A site upgraded from multi-level settings still settles the full stored commission to the direct inviter.
    config([
        'fastai.commission_distribution_enable'=>1,
        'fastai.commission_distribution_l1'=>0,
        'fastai.commission_distribution_l2'=>50,
        'fastai.commission_distribution_l3'=>50,
    ]);
    $paidOrder = fn (int $status, array $overrides = []) => $historical($status, $overrides + [
        'plan_id'=>1, 'type'=>1, 'period'=>'month_price', 'total_amount'=>1000,
        'surplus_amount'=>0, 'paid_at'=>time()-4*86400, 'callback_no'=>'fixture-paid',
    ]);
    $logsFor = fn (Order $order) => App\Models\CommissionLog::where('trade_no', $order->trade_no)->orderBy('id')->get();
    $recipients = [$inviter, $upstream, $referrer, $deletedInviter];
    $wallets = fn () => array_map(fn (User $user) => (int)$user->fresh()->commission_balance, $recipients);
    $settled = $paidOrder(2, ['actual_commission_balance'=>100]);
    foreach ([$inviter, $upstream] as $historicRecipient) {
        $historicRecipient->increment('commission_balance', 50);
        App\Models\CommissionLog::create([
            'invite_user_id'=>$historicRecipient->id, 'user_id'=>$referrer->id, 'trade_no'=>$settled->trade_no,
            'order_amount'=>1000, 'get_amount'=>50, 'currency'=>'CNY', 'order_currency'=>'CNY',
        ]);
    }
    $stateOf = fn (Order $order) => [$order->fresh()->getAttributes(), $logsFor($order)->toArray()];
    $settledState = $stateOf($settled);

    $settle = function (int $expectedWalletAmount, array $overrides = [], int $commissionStatus = 1) use ($paidOrder, $logsFor, $recipients, $wallets, $inviter) {
        $order = $paidOrder($commissionStatus, $overrides);
        $before = $wallets();
        (new App\Console\Commands\CheckCommission())->handle();
        $order->refresh();
        $logs = $logsFor($order)->map(fn ($log) => [(int)$log->invite_user_id, (int)$log->get_amount, $log->currency, $log->order_currency])->all();
        $expected = $expectedWalletAmount ? [[(int)$inviter->id, $expectedWalletAmount, 'CNY', $order->currency]] : [];
        $expectedActual = $expectedWalletAmount ? (int)$order->commission_balance : 0;
        if ($logs !== $expected || (int)$order->commission_status !== 2 || (int)$order->actual_commission_balance !== $expectedActual) {
            throw new RuntimeException('Commission settlement did not match the fixed direct-inviter policy');
        }
        $after = $wallets();
        foreach ($recipients as $index => $recipient) {
            if ($after[$index] - $before[$index] !== ($recipient->is($inviter) ? $expectedWalletAmount : 0)) {
                throw new RuntimeException('Commission credited the wrong wallet or amount');
            }
        }
        return $order;
    };
    $pending = $settle(100, [], 0);
    $crossCurrency = $settle(800, ['currency'=>'USD', 'fx_snapshot'=>['usdCnyMicros'=>8000000]]);
    $upstream->update(['invite_user_id'=>$inviter->id]);
    $cycle = $settle(100);
    $inviter->update(['invite_user_id'=>$referrer->id]);
    $settle(100);
    $settle(0, ['invite_user_id'=>$referrer->id]);
    $settle(0, ['invite_user_id'=>$deletedInviter->id]);
    $settle(0, ['invite_user_id'=>2147483647]);
    $walletsBeforeReplay = $wallets();
    $ordersToReplay = [$pending, $crossCurrency, $cycle];
    $beforeReplay = array_map($stateOf, $ordersToReplay);
    (new App\Console\Commands\CheckCommission())->handle();
    if ($wallets() !== $walletsBeforeReplay || array_map($stateOf, $ordersToReplay) !== $beforeReplay
        || $stateOf($settled) !== $settledState) {
        throw new RuntimeException('Replayed settlement changed paid orders, wallets or historical commission records');
    }
    echo "Commission settlement: direct inviter only, immutable historical payouts, and no duplicate credits.\n";
    echo "Commission transfer concurrency: one success, one conflict, one ledger record, conserved balance.\n";
} finally {
    while(DB::transactionLevel())DB::rollBack();
    foreach($processes as [$process,$pipes])if(is_resource($process)){proc_terminate($process);proc_close($process);}
    Order::where('user_id',$u->id)->delete();$u->delete();
    App\Models\CommissionLog::whereIn('user_id',$rewardUsers)->delete();
    Order::whereIn('user_id',$rewardUsers)->delete();User::whereIn('id',$rewardUsers)->delete();
    config(['fastai'=>$previousConfig]);
}
