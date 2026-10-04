<?php
namespace App\Http\Controllers\V10;
class UserCouponController extends ResourceController
{
    public function postMeCouponValidations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeCouponValidations');
        $result = app(\App\Services\Actions\User\CouponActions::class)->check($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeCouponValidations');
    }
}
