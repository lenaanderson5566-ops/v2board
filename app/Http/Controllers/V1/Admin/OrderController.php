<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\OrderAssign;
use App\Http\Requests\Admin\OrderFetch;
use App\Http\Requests\Admin\OrderUpdate;
use App\Models\CommissionLog;
use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use App\Services\AdminOrderPurchaseStage;
use App\Services\BillingCurrency;
use App\Services\OrderPaymentHistory;
use App\Services\OrderService;
use App\Services\TrafficCreditService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    private function filter(Request $request, &$builder)
    {
        if ($request->input('filter')) {
            foreach ($request->input('filter') as $filter) {
                if (in_array($filter['key'], ['email','invite_email'], true)) {
                    $condition = $filter['condition'] === '模糊' ? 'like' : $filter['condition'];
                    $value = $filter['condition'] === '模糊' ? "%{$filter['value']}%" : $filter['value'];
                    $builder->whereIn($filter['key'] === 'invite_email' ? 'invite_user_id' : 'user_id', User::where('email', $condition, $value)->select('id'));
                    continue;
                }
                if ($filter['condition'] === '模糊') {
                    $filter['condition'] = 'like';
                    $filter['value'] = "%{$filter['value']}%";
                }
                $builder->where($filter['key'], $filter['condition'], $filter['value']);
            }
        }
    }

    public function detail(Request $request)
    {
        $order = Order::find($request->input('id'));
        if (!$order) abort(500, '订单不存在');
        \App\Services\AdminUserIdentity::append(collect([$order]));
        AdminOrderPurchaseStage::append(collect([$order]));
        $receipt = OrderPaymentHistory::manualReceipt($order);
        $order['manual_payment_verified'] = $receipt !== null;
        $order['manual_payment_receipt'] = $receipt;
        $order['payment_display'] = OrderPaymentHistory::display($order, \App\Models\Payment::find($order->payment_id));
        $order['payment_provider'] = $order->payment_snapshot['provider'] ?? null;
        $order['callback_history'] = \App\Services\PaymentCallbackHistory::forOrder($order);
        $order['payment_attempt_history'] = \App\Services\PaymentAttemptHistory::forOrder($order);
        $review = $order->invite_user_id ? DB::table('v2_invitation_review')->where('user_id',$order->user_id)->where('inviter_id',$order->invite_user_id)->first(['id','state','signals','updated_at']) : null;
        $order['invitation_review'] = $review ? ['id'=>$review->id,'state'=>$review->state,'signals'=>json_decode($review->signals,true) ?: [],'updated_at'=>$review->updated_at] : null;
        $order['plan_name'] = Plan::where('id',$order->plan_id)->value('name');
        $order['commission_log'] = CommissionLog::where('trade_no', $order->trade_no)->get();
        \App\Services\AdminUserIdentity::append($order['commission_log']);
        if ($order->surplus_order_ids) {
            $order['surplus_orders'] = Order::whereIn('id', $order->surplus_order_ids)->get();
        }
        return response([
            'data' => $order
        ])->header('Cache-Control','no-store');
    }

    public function fetch(OrderFetch $request)
    {
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $orderModel = Order::orderByDesc('created_at')->orderByDesc('id');
        if ($request->input('is_commission')) {
            $orderModel->where('invite_user_id', '!=', NULL);
            $orderModel->whereNotIn('status', [0, 2]);
            $orderModel->where('commission_balance', '>', 0);
        }
        $this->filter($request, $orderModel);
        $total = $orderModel->count();
        $res = $orderModel->forPage($current, $pageSize)
            ->get();
        \App\Services\AdminUserIdentity::append($res);
        AdminOrderPurchaseStage::append($res);
        $plans = Plan::whereIn('id', $res->pluck('plan_id')->filter())->pluck('name', 'id');
        $payments = \App\Models\Payment::whereIn('id', $res->pluck('payment_id')->filter())->get()->keyBy('id');
        for ($i = 0; $i < count($res); $i++) {
            $res[$i]['manual_payment_verified'] = OrderPaymentHistory::manualReceipt($res[$i]) !== null;
            $res[$i]['payment_display'] = OrderPaymentHistory::display($res[$i], $payments->get($res[$i]->payment_id));
            if ($plans->has($res[$i]['plan_id'])) $res[$i]['plan_name'] = $plans->get($res[$i]['plan_id']);
        }
        return response([
            'data' => $res,
            'total' => $total
        ]);
    }

    public function paid(Request $request)
    {
        $input = $request->validate([
            'trade_no' => ['required', 'string', 'max:36'],
            'manual_payment' => ['sometimes', 'required', 'array:reference,amount,currency', 'required_array_keys:reference,amount,currency'],
            'manual_payment.reference' => ['required_with:manual_payment', 'string', 'max:120', 'regex:/(*UCP)\S/u', 'not_regex:/[\x00-\x1F\x7F]/'],
            'manual_payment.amount' => ['required_with:manual_payment', 'integer', 'min:1', 'max:2147483647'],
            'manual_payment.currency' => ['required_with:manual_payment', 'string', 'in:CNY,USD'],
        ]);
        $order = Order::where('trade_no', $input['trade_no'])->firstOrFail();
        $receipt = $input['manual_payment'] ?? null;
        $paymentContext = [];
        if ($receipt !== null) {
            $administratorId = (int)$request->input('user.id');
            abort_unless($administratorId > 0, 403, '无法确认当前管理员身份');
            $receipt = [
                'reference' => trim($receipt['reference']),
                'amount' => (int)$receipt['amount'],
                'currency' => $receipt['currency'],
                'confirmed_at' => time(),
                'administrator_id' => $administratorId,
            ];
            $paymentContext['manual_payment_evidence'] = json_encode($receipt, JSON_THROW_ON_ERROR);
        }

        // Check the amount and pending status on the same locked row used to record payment.
        $checkPendingOrder = static function () use ($order, $receipt): void {
            $current = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            abort_unless((int)$current->status === 0, 409, '订单状态已变化，请刷新后查看');
            if ($receipt !== null) {
                abort_unless($receipt['amount'] === (int)$current->total_amount
                    && $receipt['currency'] === ($current->currency ?: 'CNY'), 422, '线下实收金额和币种必须与订单应付本金一致');
            }
        };
        if (!(new OrderService($order))->paid('manual_operation', $paymentContext, $checkPendingOrder)) {
            abort(500, '更新失败');
        }
        return response([
            'data' => true
        ]);
    }

    public function cancel(Request $request)
    {
        $order = Order::where('trade_no', $request->input('trade_no'))
            ->first();
        if (!$order) {
            abort(500, '订单不存在');
        }
        if ($order->status !== 0) abort(500, '只能对待支付的订单进行操作');

        $orderService = new OrderService($order);
        if (!$orderService->cancel()) {
            abort(500, '更新失败');
        }
        return response([
            'data' => true
        ]);
    }

    public function update(OrderUpdate $request)
    {
        $params = $request->only([
            'commission_status'
        ]);

        DB::transaction(function () use ($request, $params) {
            // The settlement job locks the same order before crediting the wallet.
            $order = Order::where('trade_no', $request->input('trade_no'))->lockForUpdate()->first();
            if (!$order) abort(500, '订单不存在');
            if ($request->has('commission_status') && (in_array((int)$order->status, [0, 2], true) || !$order->commission_balance || (int)$order->commission_status === 2)) {
                abort(422, '该订单佣金不可审核');
            }
            try {
                $updated = $order->update($params);
            } catch (\Exception $e) {
                abort(500, '更新失败');
            }
            if (!$updated) abort(500, '更新失败');
        });

        return response([
            'data' => true
        ]);
    }

    public function assign(OrderAssign $request)
    {
        $tradeNo = DB::transaction(function () use ($request) {
            // Match the plan → user lock order used by customer checkout.
            $plan = Plan::query()->lockForUpdate()->findOrFail($request->input('plan_id'));
            $user = User::where('email', $request->input('email'))->lockForUpdate()->firstOrFail();
            $pending = Order::where('user_id', $user->id)->whereIn('status', [0, 1])->lockForUpdate()->first(['id']);
            abort_if($pending, 409, '该用户还有待支付或处理中的订单，无法分配');

            $order = new Order();
            $order->currency = $user->currency ?: 'CNY';
            $order->user_id = $user->id;
            $order->plan_id = $plan->id;
            $order->period = $request->input('period');
            $order->trade_no = Helper::guid();
            $order->total_amount = $request->input('total_amount');

            if ($order->period === 'onetime_price') {
                TrafficCreditService::snapshotPurchase($order, $plan);
                $order->type = 5;
            } elseif ($order->period === 'reset_price') {
                abort_unless(OrderService::canPurchaseTrafficReset($user, $plan), 422, '流量重置仅适用于用户当前有效的套餐');
                $price = BillingCurrency::price($plan, $order->period, $order->currency);
                abort_if($price === null || $price < 0, 422, '该套餐未设置此币种的流量重置价格');
                $order->type = 4;
            } else {
                $order->type = OrderService::recurringOrderType($user, (int)$plan->id, time());
            }

            (new OrderService($order))->setInvite($user);
            OrderService::recordPreviousSubscriptionExpiry($order, $user);
            abort_unless($order->save(), 500, '订单创建失败');
            return $order->trade_no;
        }, 3);

        return response(['data' => $tradeNo]);
    }
}
