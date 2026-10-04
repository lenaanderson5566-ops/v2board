<?php

namespace App\Services\Actions\User;


use App\Services\CouponService;
use Illuminate\Http\Request;

class CouponActions
{
    public function check(Request $request)
    {
        if (empty($request->input('code'))) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Coupon cannot be empty'));
        }
        $couponService = new CouponService($request->input('code'));
        $couponService->setPlanId($request->input('plan_id'));
        $couponService->setUserId($request->user['id']);
        $couponService->check();
        return response([
            'data' => $couponService->getCoupon()
        ]);
    }
}
