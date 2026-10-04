<?php
namespace App\Http\Controllers\V1\User;

class CouponController extends \App\Http\Controllers\Controller
{
    public function check(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\CouponActions::class)->check($request);
    }
}
