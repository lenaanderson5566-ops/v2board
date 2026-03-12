<?php

namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\User\OrderSave;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
use App\Services\CouponService;
use App\Services\CurrencyRateService;
use App\Services\OrderService;
use App\Services\PaymentService;
use App\Services\PlanService;
use App\Services\UserService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    public function fetch(Request $request)
    {
        $model = Order::where('user_id', $request->user['id'])
            ->orderBy('created_at', 'DESC');
        if ($request->input('status') !== null) {
            $model->where('status', $request->input('status'));
        }
        $order = $model->get();
        $plan = Plan::get();
        $baseCurrency = (new CurrencyRateService())->getBusinessBaseCurrency();
        for ($i = 0; $i < count($order); $i++) {
            if (empty($order[$i]['pricing_currency'])) {
                $order[$i]['pricing_currency'] = $baseCurrency;
            }
            $order[$i]['order_currency'] = $order[$i]['pricing_currency'] ?: $baseCurrency;
            for ($x = 0; $x < count($plan); $x++) {
                if ($order[$i]['plan_id'] === $plan[$x]['id']) {
                    $order[$i]['plan'] = $plan[$x];
                }
            }
            $order[$i]['type_text'] = Order::typeText((int) $order[$i]['type']);
            $order[$i]['change_apply_mode_text'] = Order::changeApplyModeText(isset($order[$i]['change_apply_mode']) ? (int) $order[$i]['change_apply_mode'] : null);
            $order[$i]['coupon_discount_amount'] = (int) ($order[$i]['coupon_discount_amount'] ?? 0);
            $order[$i]['user_discount_amount'] = (int) ($order[$i]['user_discount_amount'] ?? 0);
            $order[$i]['discount_breakdown'] = [
                'coupon_discount_amount' => $order[$i]['coupon_discount_amount'],
                'user_discount_amount' => $order[$i]['user_discount_amount'],
                'total_discount_amount' => (int) ($order[$i]['discount_amount'] ?? 0),
            ];
        }
        return response([
            'data' => $order->makeHidden(['id', 'user_id'])
        ]);
    }

    public function detail(Request $request)
    {
        $order = Order::where('user_id', $request->user['id'])
            ->where('trade_no', $request->input('trade_no'))
            ->first();
        if (!$order) {
            abort(500, __('Order does not exist or has been paid'));
        }
        $baseCurrency = (new CurrencyRateService())->getBusinessBaseCurrency();
        if (empty($order->pricing_currency)) $order->pricing_currency = $baseCurrency;
        $order->order_currency = $order->pricing_currency ?: $baseCurrency;
        $order->type_text = Order::typeText((int) $order->type);
        $order->change_apply_mode_text = Order::changeApplyModeText(isset($order->change_apply_mode) ? (int) $order->change_apply_mode : null);
        $order->coupon_discount_amount = (int) ($order->coupon_discount_amount ?? 0);
        $order->user_discount_amount = (int) ($order->user_discount_amount ?? 0);
        $order->discount_breakdown = [
            'coupon_discount_amount' => $order->coupon_discount_amount,
            'user_discount_amount' => $order->user_discount_amount,
            'total_discount_amount' => (int) ($order->discount_amount ?? 0),
        ];

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
        if (!$order['plan']) {
            abort(500, __('Subscription plan does not exist'));
        }
        if ($order->surplus_order_ids) {
            $order['surplus_orders'] = Order::whereIn('id', $order->surplus_order_ids)->get();
        }
        return response([
            'data' => $order
        ]);
    }

    public function save(OrderSave $request)
    {
        $userService = new UserService();
        $currencyRateService = new CurrencyRateService();
        if ($userService->isNotCompleteOrderByUserId($request->user['id'])) {
            abort(500, __('You have an unpaid or pending order, please try again later or cancel it'));
        }
        if ($request->input('plan_id') == 0) {
            $amount = $request->input('deposit_amount');
            if ($amount <= 0) {
                abort(500, __('Failed to create order, deposit amount must be greater than 0'));
            }
            if ($amount >= 9999999 ) {
                abort(500, __('Deposit amount too large, please contact the administrator'));
            }
            $user = User::find($request->user['id']);
            DB::beginTransaction();
            $order = new Order();
            $orderService = new OrderService($order);
            $order->user_id = $request->user['id'];
            $order->plan_id = $request->input('plan_id');
            $order->period = 'deposit';
            $order->trade_no = Helper::generateOrderNo();
            $order->total_amount = $amount;
            $order->pricing_currency = $currencyRateService->getBusinessBaseCurrency();
            $order->coupon_discount_amount = 0;
            $order->user_discount_amount = 0;
            
            $orderService->setOrderType($user);
            $orderService->setInvite($user);

            if (!$order->save()) {
                DB::rollback();
                abort(500, __('Failed to create order'));
            }
    
            DB::commit();
    
            return response([
                'data' => $order->trade_no
            ]);
        }
        $planService = new PlanService($request->input('plan_id'));

        $plan = $planService->plan;
        $user = User::find($request->user['id']);

        if (!$plan) {
            abort(500, __('Subscription plan does not exist'));
        }

        if ($user->plan_id !== $plan->id && !$planService->haveCapacity() && $request->input('period') !== 'reset_price') {
            abort(500, __('Current product is sold out'));
        }

        if ($plan[$request->input('period')] === NULL) {
            abort(500, __('This payment period cannot be purchased, please choose another period'));
        }

        if ($request->input('period') === 'reset_price') {
            if (!$userService->isAvailable($user) || $plan->id !== $user->plan_id) {
                abort(500, __('Subscription has expired or no active subscription, unable to purchase Data Reset Package'));
            }
        }


        if ($request->input('period') === 'onetime_price') {
            if (!$userService->isAvailable($user) || is_null($user->plan_id)) {
                abort(500, __('An active monthly subscription is required before purchasing a Quota Package'));
            }
        }

        if ((!$plan->show && !$plan->renew) || (!$plan->show && $user->plan_id !== $plan->id)) {
            if ($request->input('period') !== 'reset_price') {
                abort(500, __('This subscription has been sold out, please choose another subscription'));
            }
        }

        if (!$plan->renew && $user->plan_id == $plan->id && $request->input('period') !== 'reset_price') {
            abort(500, __('This subscription cannot be renewed, please change to another subscription'));
        }


        if (!$plan->show && $plan->renew && !$userService->isAvailable($user)) {
            abort(500, __('This subscription has expired, please change to another subscription'));
        }

        DB::beginTransaction();
        $order = new Order();
        $orderService = new OrderService($order);
        $order->user_id = $request->user['id'];
        $order->plan_id = $plan->id;
        $order->period = $request->input('period');
        $order->trade_no = Helper::generateOrderNo();
        $order->total_amount = $plan[$request->input('period')];
        $order->pricing_currency = $currencyRateService->getBusinessBaseCurrency();
        $order->coupon_discount_amount = 0;
        $order->user_discount_amount = 0;

        if ($request->input('coupon_code')) {
            $couponService = new CouponService($request->input('coupon_code'));
            if (!$couponService->use($order)) {
                DB::rollBack();
                abort(500, __('Coupon failed'));
            }
            $order->coupon_id = $couponService->getId();
            $order->coupon_discount_amount = (int) ($order->discount_amount ?? 0);
        }

        $orderService->setVipDiscount($user);
        $orderService->setOrderType($user);

        if ($order->total_amount > 0) {
            $userService = new UserService();
            $deducted = $userService->deductByMultiCurrencyWallet(
                $order->user_id,
                (int)$order->total_amount,
                $order->pricing_currency ?: 'CNY',
                $currencyRateService
            );
            if ($deducted > 0) {
                $order->balance_amount = $deducted;
                $order->total_amount = max(0, $order->total_amount - $deducted);
            }
        }

        $orderService->setInvite($user);

        if (!$order->save()) {
            DB::rollback();
            abort(500, __('Failed to create order'));
        }

        DB::commit();

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
            abort(500, __('Order does not exist or has been paid'));
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
        if (!$payment || $payment->enable !== 1) abort(500, __('Payment method is not available'));
        $paymentService = new PaymentService($payment->payment, $payment->id);
        $currencyRateService = new CurrencyRateService();
        $order->handling_amount = NULL;
        if ($payment->handling_fee_fixed || $payment->handling_fee_percent) {
            $order->handling_amount = round(($order->total_amount * ($payment->handling_fee_percent / 100)) + $payment->handling_fee_fixed);
        }
        $order->payment_id = $method;
        $amountByPricingCurrency = isset($order->handling_amount) ? ($order->total_amount + $order->handling_amount) : $order->total_amount;
        $pricingCurrency = $order->pricing_currency ?: 'CNY';
        $paymentCurrency = $currencyRateService->getPaymentCurrencyByGateway($payment);
        $convertedAmount = $currencyRateService->convertMinor($amountByPricingCurrency, $pricingCurrency, $paymentCurrency);
        $paymentRateToBase = $currencyRateService->getRateToBase($paymentCurrency);
        $pricingRateToBase = $currencyRateService->getRateToBase($pricingCurrency);
        $exchangeRate = ($paymentRateToBase && $pricingRateToBase) ? ($paymentRateToBase / $pricingRateToBase) : null;
        $order->payment_currency = $paymentCurrency;
        $order->payment_amount = $convertedAmount;
        $order->exchange_rate = $exchangeRate;
        $order->exchange_rate_at = time();
        if (!$order->save()) abort(500, __('Request failed, please try again later'));
        $result = $paymentService->pay([
            'trade_no' => $tradeNo,
            'total_amount' => $amountByPricingCurrency,
            'locked_payment_amount' => $convertedAmount,
            'locked_payment_currency' => $paymentCurrency,
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
            abort(500, __('Order does not exist'));
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
            'handling_fee_percent',
            'currency'
        ])
            ->where('enable', 1)
            ->orderBy('sort', 'ASC')
            ->get();

        return response([
            'data' => $methods
        ]);
    }

    public function cancel(Request $request)
    {
        if (empty($request->input('trade_no'))) {
            abort(500, __('Invalid parameter'));
        }
        $order = Order::where('trade_no', $request->input('trade_no'))
            ->where('user_id', $request->user['id'])
            ->first();
        if (!$order) {
            abort(500, __('Order does not exist'));
        }
        if ($order->status !== 0) {
            abort(500, __('You can only cancel pending orders'));
        }
        $orderService = new OrderService($order);
        if (!$orderService->cancel()) {
            abort(500, __('Cancel failed'));
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
