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
    public function getMeCoupons(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeCoupons');
        return response()->json(['data'=>\App\Services\CouponWallet::rows((int)$request->user['id'])])->header('Cache-Control', 'no-store');
    }
    public function getMeCouponOffers(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeCouponOffers');
        $rows = \App\Models\Coupon::where('public_claim', true)->where('show', 1)->where('type', 2)
            ->where('started_at', '<=', time())->where('ended_at', '>', time())
            ->where(function($q) { $q->whereNull('limit_use')->orWhere('limit_use', '>', 0); })
            ->whereNotIn('id', \Illuminate\Support\Facades\DB::table('v2_coupon_wallet')->where('user_id', $request->user['id'])->select('coupon_id'))
            ->whereNotIn('id', \App\Models\Order::where('user_id',$request->user['id'])->whereNotIn('status',[2])->whereNotNull('coupon_id')->select('coupon_id'))
            ->orderBy('ended_at')->limit(100)->get()->map(fn($c)=>[
                'id'=>(int)$c->id, ...\App\Services\CouponPresentation::localized($c->toArray()), 'discountPercent'=>(int)$c->value,
                'expiresAt'=>gmdate('c', $c->ended_at), 'planIds'=>$c->limit_plan_ids ?: [],
                'billingPeriods'=>array_map(fn($p)=>\App\Http\Resources\V10\Resource::PERIODS[$p], $c->limit_period ?: []),
            ]);
        return response()->json(['data'=>$rows])->header('Cache-Control', 'no-store');
    }
    public function postMeCouponClaims(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeCouponClaims');
        $request->validate(['coupon_id'=>'required|integer|min:1']);
        $id = \App\Services\CouponWallet::issue((int)$request->user['id'], (int)$request->input('coupon_id'));
        return response()->json(['data'=>['id'=>$id]], 201)->header('Cache-Control', 'no-store');
    }
}
