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
use App\Services\OrderService;
use App\Services\UserService;
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
        $order['payment_display'] = \App\Services\OrderPaymentHistory::display($order, \App\Models\Payment::find($order->payment_id));
        $order['payment_provider'] = $order->payment_snapshot['provider'] ?? null;
        $order['callback_history'] = \App\Services\PaymentCallbackHistory::forOrder($order);
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
        $orderModel = Order::orderBy('created_at', 'DESC');
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
        $plans = Plan::whereIn('id', $res->pluck('plan_id')->filter())->pluck('name', 'id');
        $payments = \App\Models\Payment::whereIn('id', $res->pluck('payment_id')->filter())->get()->keyBy('id');
        for ($i = 0; $i < count($res); $i++) {
            $res[$i]['payment_display'] = \App\Services\OrderPaymentHistory::display($res[$i], $payments->get($res[$i]->payment_id));
            if ($plans->has($res[$i]['plan_id'])) $res[$i]['plan_name'] = $plans->get($res[$i]['plan_id']);
        }
        return response([
            'data' => $res,
            'total' => $total
        ]);
    }

    public function paid(Request $request)
    {
        $order = Order::where('trade_no', $request->input('trade_no'))
            ->first();
        if (!$order) {
            abort(500, '订单不存在');
        }
        if ($order->status !== 0) abort(500, '只能对待支付的订单进行操作');

        $orderService = new OrderService($order);
        if (!$orderService->paid('manual_operation')) {
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

        $order = Order::where('trade_no', $request->input('trade_no'))
            ->first();
        if (!$order) {
            abort(500, '订单不存在');
        }

        if ($request->has('commission_status') && (in_array($order->status, [0, 2]) || !$order->commission_balance || $order->commission_status === 2)) {
            abort(422, '该订单佣金不可审核');
        }
        try {
            $order->update($params);
        } catch (\Exception $e) {
            abort(500, '更新失败');
        }

        return response([
            'data' => true
        ]);
    }

    public function assign(OrderAssign $request)
    {
        $plan = Plan::find($request->input('plan_id'));
        $user = User::where('email', $request->input('email'))->first();

        if (!$user) {
            abort(500, '该用户不存在');
        }

        if (!$plan) {
            abort(500, '该订阅不存在');
        }

        $userService = new UserService();
        if ($userService->isNotCompleteOrderByUserId($user->id)) {
            abort(500, '该用户还有待支付的订单，无法分配');
        }

        DB::beginTransaction();
        $order = new Order();
            $order->currency = $user->currency ?: 'CNY';
        $orderService = new OrderService($order);
        $order->user_id = $user->id;
        $order->plan_id = $plan->id;
        $order->period = $request->input('period');
        $order->trade_no = Helper::guid();
        $order->total_amount = $request->input('total_amount');

        if ($order->period === 'reset_price') {
            $order->type = 4;
        } else if ($user->plan_id !== NULL && $order->plan_id !== $user->plan_id) {
            $order->type = 3;
        } else if ($user->expired_at > time() && $order->plan_id == $user->plan_id) {
            $order->type = 2;
        } else {
            $order->type = 1;
        }

        $orderService->setInvite($user);

        if (!$order->save()) {
            DB::rollback();
            abort(500, '订单创建失败');
        }

        DB::commit();

        return response([
            'data' => $order->trade_no
        ]);
    }
}
