<?php

namespace App\Services\Actions\User;


use App\Http\Requests\User\OrderSave;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
use App\Services\CouponService;
use App\Services\OrderService;
use App\Services\PaymentService;
use App\Services\PlanService;
use App\Services\UserService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderActions
{
    public function fetch(Request $request)
    {
        $model = Order::where('user_id', $request->user['id'])
            ->orderBy('created_at', 'DESC');
        if ($request->input('status') !== null) {
            $model->where('status', $request->input('status'));
        }
        $total = null;
        if ($request->is('api/v10/*')) {
            $total=(clone $model)->count();
            $model->forPage((int)$request->input('current',1),(int)$request->input('page_size',20));
        }
        $order = $model->get();
        $plan = Plan::get();
        for ($i = 0; $i < count($order); $i++) {
            for ($x = 0; $x < count($plan); $x++) {
                if ($order[$i]['plan_id'] === $plan[$x]['id']) {
                    $order[$i]['plan'] = $plan[$x];
                }
            }
        }
        return response([
            'data' => $order->makeHidden(['id', 'user_id']),
            ...($total !== null ? ['total'=>$total] : [])
        ]);
    }

    public function detail(Request $request)
    {
        $order = Order::where('user_id', $request->user['id'])
            ->where('trade_no', $request->input('trade_no'))
            ->first();
        if (!$order) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Order does not exist or has been paid'));
        }
        if ($order->plan_id == 0) {
            $order['plan'] = [
                'id' => 0,
                'name' => 'deposit'
            ];
            $order->bounus = $this->getbounus($order->total_amount);
            $order->get_amount = $order->total_amount + $order->bounus;

            return response([
                'data' => $order
            ]);
        }
        $order['plan'] = Plan::find($order->plan_id);
        $order['try_out_plan_id'] = (int)config('v2board.try_out_plan_id');
        if (!$order['plan']) $order['plan'] = ['id' => $order->plan_id, 'name' => $order->credit_snapshot['name'] ?? '#'.$order->plan_id];
        if ($order->surplus_order_ids) {
            $order['surplus_orders'] = Order::whereIn('id', $order->surplus_order_ids)->get();
        }
        return response([
            'data' => $order
        ]);
    }

    public function save(OrderSave $request)
    {
        // Serialize order creation and keep cancellation/refund/new order atomic.
        return DB::transaction(function () use ($request) {
            User::where('id', $request->user['id'])->lockForUpdate()->firstOrFail();
            if ($request->filled('replace_trade_no')) {
                $previous = Order::where('user_id', $request->user['id'])
                    ->where('trade_no', $request->input('replace_trade_no'))->lockForUpdate()->first();
                $periods = ['month_price', 'quarter_price', 'half_year_price', 'year_price', 'two_year_price', 'three_year_price'];
                if (!$previous || (int)$previous->status !== 0 || $previous->payment_id ||
                    !in_array($previous->period, $periods, true) ||
                    !in_array($request->input('period'), $periods, true) ||
                    (int)$request->input('plan_id') <= 0) {
                    abort(409, __('You have an unpaid or pending order, please try again later or cancel it'));
                }
                if (!(new OrderService($previous))->cancel()) abort(409, __('Cancel failed'));
            }
            return $this->saveOrder($request);
        }, 3);
    }

    private function saveOrder(OrderSave $request)
    {
        $userService = new UserService();
        if ($userService->isNotCompleteOrderByUserId($request->user['id'])) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('You have an unpaid or pending order, please try again later or cancel it'));
        }
        if ($request->input('plan_id') == 0) {
            $amount = $request->input('deposit_amount');
            if ($amount <= 0) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Failed to create order, deposit amount must be greater than 0'));
            }
            if ($amount >= 9999999 ) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Deposit amount too large, please contact the administrator'));
            }
            $user = User::find($request->user['id']);
            $order = new Order();
            $orderService = new OrderService($order);
            $order->user_id = $request->user['id'];
            $order->plan_id = $request->input('plan_id');
            $order->period = 'deposit';
            $order->trade_no = Helper::generateOrderNo();
            $order->total_amount = $amount;

            $orderService->setOrderType($user);
            $orderService->setInvite($user);

            if (!$order->save()) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Failed to create order'));
            }

            return response([
                'data' => $order->trade_no
            ]);
        }
        $planService = new PlanService($request->input('plan_id'));

        $plan = $planService->plan;
        $user = User::find($request->user['id']);

        if (!$plan) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
        }

        $isCredit = $request->input('period') === 'onetime_price';
        if ($isCredit && (!$plan->show || $plan->transfer_enable <= 0 || $plan->group_id === null)) abort(422, __('Current product is sold out'));
        if ($user->plan_id !== $plan->id && !$planService->haveCapacity() && $request->input('period') !== 'reset_price') {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Current product is sold out'));
        }

        if ($plan[$request->input('period')] === NULL || $plan[$request->input('period')] < 0) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('This payment period cannot be purchased, please choose another period'));
        }

        if ($request->input('period') === 'reset_price') {
            if (!\App\Services\TrafficCreditService::hasPeriod($user) || $user->banned || $plan->id !== $user->plan_id) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription has expired or no active subscription, unable to purchase Data Reset Package'));
            }
        }

        if ((!$plan->show && !$plan->renew) || (!$plan->show && $user->plan_id !== $plan->id)) {
            if ($request->input('period') !== 'reset_price') {
                abort(request()->is('api/v10/*') ? 409 : 500, __('This subscription has been sold out, please choose another subscription'));
            }
        }

        if (!$isCredit && !$plan->renew && $user->plan_id == $plan->id && $request->input('period') !== 'reset_price') {
            abort(request()->is('api/v10/*') ? 409 : 500, __('This subscription cannot be renewed, please change to another subscription'));
        }


        if (!$plan->show && $plan->renew && !$userService->isAvailable($user)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('This subscription has expired, please change to another subscription'));
        }
        $order = new Order();
        $orderService = new OrderService($order);
        $order->user_id = $request->user['id'];
        $order->plan_id = $plan->id;
        $order->period = $request->input('period');
        $order->trade_no = Helper::generateOrderNo();
        $order->total_amount = $plan[$request->input('period')];
        if ($isCredit) {
            $order->credit_bytes = (int)round($plan->transfer_enable * 1073741824);
            $order->credit_snapshot = $plan->only(['name','group_id','speed_limit','device_limit']);
        }

        if ($request->input('coupon_code')) {
            $couponService = new CouponService($request->input('coupon_code'));
            if (!$couponService->use($order)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Coupon failed'));
            }
            $order->coupon_id = $couponService->getId();
        }

        $orderService->setVipDiscount($user);
        $orderService->setOrderType($user);

        if ($user->balance > 0 && $order->total_amount > 0) {
            $remainingBalance = $user->balance - $order->total_amount;
            $userService = new UserService();
            if ($remainingBalance > 0) {
                if (!$userService->addBalance($order->user_id, - $order->total_amount)) {
                    abort(request()->is('api/v10/*') ? 409 : 500, __('Insufficient balance'));
                }
                $order->balance_amount = $order->total_amount;
                $order->total_amount = 0;
            } else {
                if (!$userService->addBalance($order->user_id, - $user->balance)) {
                    abort(request()->is('api/v10/*') ? 409 : 500, __('Insufficient balance'));
                }
                $order->balance_amount = $user->balance;
                $order->total_amount -= $user->balance;
            }
        }

        $orderService->setInvite($user);

        if (!$order->save()) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Failed to create order'));
        }

        return response([
            'data' => $order->trade_no
        ]);
    }

    public function checkout(Request $request)
    {
        $tradeNo = $request->input('trade_no');
        $method = $request->input('method');
        $order = Order::where('trade_no', $tradeNo)
            ->where('user_id', $request->user['id'])
            ->where('status', 0)
            ->first();
        if (!$order) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Order does not exist or has been paid'));
        }
        if ($order->total_amount < 0) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Invalid parameter'));
        }
        // free process
        if ($order->total_amount <= 0) {
            $orderService = new OrderService($order);
            if (!$orderService->paid($order->trade_no)) abort(500, '');
            return response([
                'type' => -1,
                'data' => true
            ]);
        }
        $payment = Payment::find($method);
        if (!$payment || $payment->enable !== 1) abort(request()->is('api/v10/*') ? 409 : 500, __('Payment method is not available'));
        $paymentService = new PaymentService($payment->payment, $payment->id);
        $order->handling_amount = NULL;
        if ($payment->handling_fee_fixed || $payment->handling_fee_percent) {
            $order->handling_amount = round(($order->total_amount * ($payment->handling_fee_percent / 100)) + $payment->handling_fee_fixed);
        }
        $order->payment_id = $method;
        // Claim payment before contacting the provider; replacement must not cancel issued payments.
        $claimed = DB::transaction(function () use ($order, $method) {
            $fresh = Order::where('id', $order->id)->lockForUpdate()->first();
            if (!$fresh || (int)$fresh->status !== 0) return false;
            $fresh->payment_id = $method;
            $fresh->handling_amount = $order->handling_amount;
            return $fresh->save();
        }, 3);
        if (!$claimed) abort(409, __('Order does not exist or has been paid'));
        $result = $paymentService->pay([
            'trade_no' => $tradeNo,
            'total_amount' => isset($order->handling_amount) ? ($order->total_amount + $order->handling_amount) : $order->total_amount,
            'user_id' => $order->user_id,
            'stripe_token' => $request->input('token')
        ]);
        return response([
            'type' => $result['type'],
            'data' => $result['data']
        ]);
    }

    public function check(Request $request)
    {
        $tradeNo = $request->input('trade_no');
        $order = Order::where('trade_no', $tradeNo)
            ->where('user_id', $request->user['id'])
            ->first();
        if (!$order) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Order does not exist'));
        }
        return response([
            'data' => $order->status
        ]);
    }

    public function getPaymentMethod()
    {
        $methods = Payment::select([
            'id',
            'name',
            'payment',
            'icon',
            'handling_fee_fixed',
            'handling_fee_percent'
        ])
            ->where('enable', 1)
            ->whereNotIn('payment', PaymentService::RETIRED_METHODS)
            ->orderBy('sort', 'ASC')
            ->get();

        return response([
            'data' => $methods
        ]);
    }

    public function cancel(Request $request)
    {
        if (empty($request->input('trade_no'))) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Invalid parameter'));
        }
        $order = Order::where('trade_no', $request->input('trade_no'))
            ->where('user_id', $request->user['id'])
            ->first();
        if (!$order) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Order does not exist'));
        }
        if ($order->status !== 0) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('You can only cancel pending orders'));
        }
        $orderService = new OrderService($order);
        if (!$orderService->cancel()) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Cancel failed'));
        }
        return response([
            'data' => true
        ]);
    }

    private function getbounus($total_amount) {
        $deposit_bounus = config('v2board.deposit_bounus', []);
        if (empty($deposit_bounus) || $deposit_bounus[0] === null) {
            return 0;
        }
        $add = 0;
        foreach ($deposit_bounus as $tier) {
            list($amount, $bounus) = explode(':', $tier);
            $amount = (float)$amount * 100;
            $bounus = (float)$bounus * 100;
            $amount = (int)$amount;
            $bounus = (int)$bounus;
            if ($total_amount >= $amount) {
                $add = max($add, $bounus);
            }
        }
        return $add;
    }
}
