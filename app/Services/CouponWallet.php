<?php
namespace App\Services;

use App\Models\Coupon;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;

final class CouponWallet
{
    // Claiming reserves stock; the issued terms remain unchanged by later template edits.
    public static function issue(int $userId, int $couponId, ?int $administratorId = null): int
    {
        return DB::transaction(function () use ($userId, $couponId, $administratorId) {
            User::whereKey($userId)->lockForUpdate()->firstOrFail();
            $coupon = Coupon::whereKey($couponId)->lockForUpdate()->firstOrFail();
            $existing = DB::table('v2_coupon_wallet')->where('user_id', $userId)->where('coupon_id', $couponId)->first();
            if ($existing) return (int)$existing->id;
            abort_if(Order::where('user_id',$userId)->where('coupon_id',$couponId)->whereNotIn('status',[2])->exists(),409,__('This coupon has already been claimed or used.'));
            abort_unless($coupon->show && (int)$coupon->type === 2 && $coupon->value > 0 && $coupon->value <= 100
                && $coupon->started_at <= time() && $coupon->ended_at > time()
                && ($administratorId !== null || $coupon->public_claim), 409, __('Coupon is not available.'));
            abort_if($coupon->limit_use !== null && $coupon->limit_use <= 0, 409, __('Coupon is sold out.'));
            if ($coupon->limit_use !== null) { $coupon->limit_use--; $coupon->save(); }
            return DB::table('v2_coupon_wallet')->insertGetId([
                'user_id'=>$userId, 'coupon_id'=>$couponId,
                'snapshot'=>json_encode($coupon->only(['name','value','started_at','ended_at','limit_plan_ids','limit_period','translations','activity_title','activity_description']), JSON_THROW_ON_ERROR),
                'order_id'=>null, 'administrator_id'=>$administratorId, 'created_at'=>time(),
            ]);
        }, 3);
    }

    public static function reserve(Order $order, int $walletId): void
    {
        $wallet = DB::table('v2_coupon_wallet')->where('id', $walletId)->where('user_id', $order->user_id)->lockForUpdate()->first();
        abort_unless($wallet && $wallet->order_id === null, 409, __('Coupon is not available.'));
        $terms = json_decode($wallet->snapshot, true, 512, JSON_THROW_ON_ERROR);
        abort_unless(self::eligible($terms, (int)$order->plan_id, $order->period), 409, __('Coupon is not applicable to this order.'));
        $order->discount_amount = intdiv((int)$order->total_amount * (int)$terms['value'], 100);
        $order->coupon_id = $wallet->coupon_id;
    }

    /** The campaign has already reserved stock; called inside its recipient transaction. */
    public static function deliverReserved(int $userId, int $couponId, array $terms, int $administratorId): array
    {
        if (DB::transactionLevel() < 1) throw new \LogicException('Reserved issuance requires a transaction');
        $user = User::whereKey($userId)->lockForUpdate()->first();
        $coupon = Coupon::whereKey($couponId)->lockForUpdate()->first();
        $reason = !$user || !$coupon ? 'record_missing' : ($user->banned ? 'account_disabled' : null);
        $existing = DB::table('v2_coupon_wallet')->where('user_id',$userId)->where('coupon_id',$couponId)->first();
        if ($existing || Order::where('user_id',$userId)->where('coupon_id',$couponId)->whereNotIn('status',[2])->exists()) $reason = 'already_claimed';
        if (!$reason && $terms['ended_at'] <= time()) $reason = 'expired';
        if ($reason) return ['walletId'=>null,'reason'=>$reason];
        $id = DB::table('v2_coupon_wallet')->insertGetId([
            'user_id'=>$userId,'coupon_id'=>$couponId,'snapshot'=>json_encode($terms,JSON_THROW_ON_ERROR),
            'order_id'=>null,'administrator_id'=>$administratorId,'created_at'=>time(),
        ]);
        return ['walletId'=>(int)$id,'reason'=>'issued'];
    }

    public static function eligible(array $terms, int $planId, string $period): bool
    {
        return $terms['started_at'] <= time() && $terms['ended_at'] > time()
            && (!$terms['limit_plan_ids'] || in_array($planId, $terms['limit_plan_ids']))
            && (!$terms['limit_period'] || in_array($period, $terms['limit_period'], true));
    }

    public static function rows(int $userId): array
    {
        return DB::table('v2_coupon_wallet')->where('user_id', $userId)->orderByDesc('id')->limit(100)->get()->map(function ($row) {
            $t = json_decode($row->snapshot, true, 512, JSON_THROW_ON_ERROR);
            return ['id'=>(int)$row->id, 'name'=>CouponPresentation::localized($t)['name'], 'discountPercent'=>(int)$t['value'],
                'expiresAt'=>gmdate('c', $t['ended_at']), 'status'=>$row->order_id ? 'reservedOrUsed' : ($t['ended_at'] <= time() ? 'expired' : 'available'),
                'planIds'=>$t['limit_plan_ids'] ?: [], 'billingPeriods'=>array_map(fn($p)=>\App\Http\Resources\V10\Resource::PERIODS[$p], $t['limit_period'] ?: [])];
        })->all();
    }
}
