<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require __DIR__.'/commerce-bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment};
use App\Services\{OrderPaymentHistory, OrderService};
use App\Services\Actions\User\OrderActions;
use App\Services\Actions\Guest\PaymentActions;
use Illuminate\Support\Facades\{DB, Queue};
use Illuminate\Http\Request;
Queue::fake();
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
DB::beginTransaction();
try {
    $payment = Payment::create(['name'=>'Original Alipay','payment'=>'Paytaro','uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>['pid'=>'test', 'key'=>'test-secret'], 'handling_fee_fixed'=>10]);
    $order = Order::create(['user_id'=>1,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'status'=>0]);
    $checkout = function () use ($order, $payment) {
        $request = Request::create('/api/v10/orders/'.$order->trade_no.'/payments', 'POST', ['trade_no'=>$order->trade_no,'method'=>$payment->id]);
        $request->user = ['id'=>1];
        return json_decode((new OrderActions())->checkout($request)->getContent(), true);
    };
    $first = $checkout();
    parse_str(parse_url($first['data'], PHP_URL_QUERY), $params);
    $assert($params['out_trade_no'] === $order->trade_no, 'Original merchant reference retained');
    $payment->name='Renamed'; $payment->save();
    $checkout();
    $assert($order->fresh()->payment_snapshot['name']==='Original Alipay', 'Original channel snapshot retained');
    $other = Payment::create(['name'=>'Second channel','payment'=>'Paytaro','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['pid'=>'test','key'=>'test-secret'],'handling_fee_fixed'=>30]);
    $request=Request::create('/', 'POST',['trade_no'=>$order->trade_no,'method'=>$other->id]); $request->user=['id'=>1];
    (new OrderActions())->checkout($request);
    $notify = function ($channel, $callback) use ($order) {
        $params=['out_trade_no'=>$order->trade_no,'trade_no'=>$callback,'trade_status'=>'TRADE_SUCCESS','money'=>number_format((1000 + $channel->handling_fee_fixed)/100,2,'.','')];
        ksort($params); $pairs=[]; foreach($params as $k=>$v) $pairs[]=$k.'='.$v;
        $params['sign']=md5(implode('&',$pairs).'test-secret');
        return (new PaymentActions())->notify('Paytaro',$channel->uuid,Request::create('/','POST',$params));
    };
    $notify($payment,'first-paid'); $order->refresh();
    $assert($order->payment_snapshot['name']==='Original Alipay' && $order->payment_id===$payment->id && (int)$order->handling_amount===10,'Late original channel callback uses correct snapshot and fee');
    $assert(!isset($order->payment_snapshot['channels']), 'Only winning snapshot remains after settlement');
    $notify($other,'second-paid');
    $assert($order->fresh()->callback_no==='first-paid','Later callback cannot overwrite settlement');
    $assert(!isset($order->toArray()['payment_snapshot']), 'Internal data not exposed to user');
    $payment->delete();
    $assert(OrderPaymentHistory::display($order)==='Original Alipay','Deletion preserves historical name');
    $legacy=new Order(['total_amount'=>1000,'payment_id'=>$other->id]);
    $assert(strpos(OrderPaymentHistory::display($legacy,$other),'当前渠道信息')!==false,'Legacy label is explicit');
    $detail=json_decode((new App\Http\Controllers\V1\Admin\OrderController())->detail(Request::create('/','GET',['id'=>$order->id]))->getContent(),true)['data'];
    $assert($detail['payment_display']==='Original Alipay' && !isset($detail['payment_attempts']),'Simple admin detail');
    echo "Order payment history: $checks checks passed\n";
} finally { DB::rollBack(); }
