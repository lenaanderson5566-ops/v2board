<?php

namespace App\Services\Actions\User;


use App\Http\Requests\User\OrderSave;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
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
                    $order[$i]['plan'] = \App\Services\BillingCurrency::present(clone $plan[$x], $order[$i]->currency ?: 'CNY');
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
        $order->payment_amount = $order->payment_snapshot['payment_amount'] ?? null;
        $order->payment_currency = $order->payment_snapshot['payment_currency'] ?? null;
        if ($order->plan_id == 0) {
            $order['plan'] = [
                'id' => 0,
                'name' => 'deposit'
            ];
            $order->bounus = ($order->currency ?: 'CNY') === 'CNY' ? $this->getbounus($order->total_amount) : 0;
            $order->get_amount = $order->total_amount + $order->bounus;

            return response([
                'data' => $order
            ]);
        }
        $order['plan'] = Plan::find($order->plan_id);
        if ($order['plan']) \App\Services\BillingCurrency::present($order['plan'], $order->currency ?: 'CNY');
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
        abort_if($request->exists('coupon_code') || $request->exists('couponCode'), 422, __('Please select this coupon from your wallet.'));
        // Serialize order creation and keep cancellation/refund/new order atomic.
        return DB::transaction(function () use ($request) {
            $lockedUser = User::where('id', $request->user['id'])->lockForUpdate()->firstOrFail();
            abort_if($lockedUser->banned,403,__('Account is disabled.'));
            if ($request->filled('checkout_quote')) {
                $replayed = \App\Services\CheckoutQuote::replay($request);
                if ($replayed) return response(['data'=>$replayed->trade_no]);
            }
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
            $order->currency = \App\Services\BillingCurrency::account($user);
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
        $user = User::findOrFail($request->user['id']);
        $order = $this->prepareSubscriptionOrder($request, $user);
        $orderService = new OrderService($order);
        if ($request->filled('checkout_quote')) \App\Services\CheckoutQuote::confirm($request, $order, $user);

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

        if ($request->filled('wallet_coupon_id')) {
            DB::table('v2_coupon_wallet')->where('id', $request->input('wallet_coupon_id'))->where('user_id', $order->user_id)->update(['order_id'=>$order->id]);
        }
        return response([
            'data' => $order->trade_no
        ]);
    }

    public function quote(OrderSave $request)
    {
        abort_if((int)$request->input('plan_id') <= 0 || $request->input('period') === 'deposit', 422, __('Invalid parameter'));
        $user = User::findOrFail($request->user['id']);
        abort_if($user->banned, 403, __('Account is disabled.'));
        $replacing = null;
        if ($request->filled('replace_trade_no')) {
            $replacing = Order::where('user_id',$user->id)->where('trade_no',$request->input('replace_trade_no'))->first();
            $periods = ['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price'];
            abort_unless($replacing && (int)$replacing->status === 0 && !$replacing->payment_id
                && in_array($replacing->period,$periods,true) && in_array($request->input('period'),$periods,true),409,
                __('You have an unpaid or pending order, please try again later or cancel it'));
            $user->balance += (int)$replacing->balance_amount;
        }
        abort_if(Order::where('user_id',$user->id)->whereIn('status',[0,1])
            ->when($replacing,fn($q)=>$q->where('id','!=',$replacing->id))->exists(),409,
            __('You have an unpaid or pending order, please try again later or cancel it'));
        $order = $this->prepareSubscriptionOrder($request,$user,true,$replacing?->id);
        return response(['data'=>\App\Services\CheckoutQuote::preview($request,$order,$user)]);
    }

    private function prepareSubscriptionOrder(OrderSave $request, User $user, bool $preview = false, ?int $replacingOrderId = null): Order
    {
        $userService = new UserService();
        $planService = new PlanService($request->input('plan_id'));

        $plan = $planService->plan;

        if (!$plan) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
        }

        $currency = \App\Services\BillingCurrency::account($user);
        $price = \App\Services\BillingCurrency::price($plan, $request->input('period'), $currency);
        $isCredit = $request->input('period') === 'onetime_price';
        if ($isCredit && (!$plan->show || $plan->transfer_enable <= 0 || $plan->group_id === null)) abort(422, __('Current product is sold out'));
        if ($user->plan_id !== $plan->id && !$planService->haveCapacity() && $request->input('period') !== 'reset_price') {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Current product is sold out'));
        }

        if ($price === null || $price < 0) {
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
        $order->currency = $currency;
        $order->total_amount = $price;
        if ($isCredit) {
            $order->credit_bytes = (int)round($plan->transfer_enable * 1073741824);
            $order->credit_snapshot = $plan->only(['name','group_id','speed_limit','device_limit']);
        }

        if ($request->filled('wallet_coupon_id')) {
            \App\Services\CouponWallet::reserve($order, (int)$request->input('wallet_coupon_id'), !$preview, $replacingOrderId);
        }

        $orderService->setVipDiscount($user);
        $orderService->setOrderType($user);

        return $order;
    }

    public function checkout(Request $request)
    {
        // Older callers may omit a key, but must still respect another in-flight attempt.
        if (!$request->filled('payment_request_key')) $request->merge(['payment_request_key'=>(string)\Illuminate\Support\Str::uuid()]);
        return \App\Services\CheckoutPayment::once($request, fn()=>$this->performCheckout($request));
    }

    private function performCheckout(Request $request)
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
        $channelSnapshot = $order->payment_snapshot['channels'][(string)$method] ?? null;
        abort_if($channelSnapshot && (($channelSnapshot['uuid'] ?? null) !== $payment->uuid || ($channelSnapshot['provider'] ?? null) !== $payment->payment),409,__('Payment method is not available'));
        $paymentService = new PaymentService($payment->payment, $payment->id);
        $quote = \App\Services\PaymentQuote::make($order, $payment);
        if ($request->filled('expected_payment_amount') || ($order->currency ?: 'CNY') !== $quote['payment_currency']) {
            abort_unless((int)$request->input('expected_payment_amount') === $quote['payment_amount']
                && $request->input('expected_payment_currency') === $quote['payment_currency'], 409, __('Payment quote changed. Reload and confirm the payment amount.'));
        }
        $order->handling_amount = $quote['handling_amount'];
        $order->payment_id = $method;
        // Claim payment before contacting the provider; replacement must not cancel issued payments.
        $claimed = DB::transaction(function () use ($order, $method, $payment, $quote) {
            $fresh = Order::where('id', $order->id)->lockForUpdate()->first();
            if (!$fresh || (int)$fresh->status !== 0) return false;
            $fresh->payment_id = $method;
            $fresh->handling_amount = $order->handling_amount;
            $saved = \App\Services\OrderPaymentHistory::select($fresh, $payment, $quote);
            $order->handling_amount = $fresh->handling_amount;
            return $saved;
        }, 3);
        if (!$claimed) abort(409, __('Order does not exist or has been paid'));
        $request->attributes->set('checkout.provider_started',true);
        $result = $paymentService->pay([
            'trade_no' => $tradeNo,
            'total_amount' => $quote['payment_amount'],
            'currency' => $quote['payment_currency'],
            'user_id' => $order->user_id,
            'plan_id' => (int)$order->plan_id,
            'period' => $order->period,
            'credit_bytes' => (int)$order->credit_bytes,
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

    public function getPaymentMethod(?Request $request = null, ?Order $previewOrder = null)
    {
        $request ??= request();
        $order = $previewOrder ?? ($request->input('trade_no') ? Order::where('trade_no', $request->input('trade_no'))->where('user_id', $request->user['id'])->firstOrFail() : null);
        $methods = Payment::select([
            'currency',
            'uuid',
            'id',
            'name',
            'payment',
            'icon',
            'handling_fee_fixed',
            'handling_fee_percent',
            'config'
        ])
            ->where('enable', 1)
            ->whereNotIn('payment', PaymentService::RETIRED_METHODS)
            ->orderBy('sort', 'ASC')
            ->get()
            ->map(function ($method) use ($order) {
                $saved = $order?->payment_snapshot['channels'][(string)$method->id] ?? null;
                if ($saved && (($saved['uuid'] ?? null) !== $method->uuid || ($saved['provider'] ?? null) !== $method->payment)) return null;
                $fields = \App\Services\PaymentPresentation::fields($method->config ?? []);
                // Provider credentials must never be exposed by the public resource.
                if ($order && $order->total_amount > 0) {
                    try { $quote = \App\Services\PaymentQuote::make($order, $method); } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { if (!in_array($e->getStatusCode(),[422,503],true)) throw $e; return null; }
                    $fields += ['quoted_amount'=>$quote['payment_amount'], 'quoted_currency'=>$quote['payment_currency'], 'quoted_fee'=>$quote['handling_amount'], 'rate_time'=>$quote['fx']['quotedAt'] ?? null];
                }
                return array_merge($method->makeHidden(['config','uuid'])->toArray(), $fields);
            })->filter()->values();

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
