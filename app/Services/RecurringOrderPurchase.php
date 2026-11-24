<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

final class RecurringOrderPurchase
{
    public const CONFIRMED_STATUSES = [1, 3, 4];

    public static function valued(string $alias = 'o'): Builder
    {
        return self::valuedWithConfirmedStatus($alias)->where($alias.'.paid_at', '>', 0);
    }

    public static function valuedWithConfirmedStatus(string $alias): Builder
    {
        return self::valuedTerm($alias)->whereIn($alias.'.status', self::CONFIRMED_STATUSES);
    }

    public static function valuedTerm(string $alias = 'o'): Builder
    {
        return DB::table('v2_order as '.$alias)
            ->where($alias.'.plan_id', '>', 0)
            ->whereIn($alias.'.period', array_keys(OrderService::STR_TO_TIME))
            ->where(function (Builder $query) use ($alias) {
                $query->whereNull($alias.'.credit_bytes')->orWhere($alias.'.credit_bytes', 0);
            })
            ->where($alias.'.total_amount', '>=', 0)
            ->whereRaw('COALESCE('.$alias.'.balance_amount, 0) >= 0')
            ->whereRaw($alias.'.total_amount + COALESCE('.$alias.'.balance_amount, 0) > 0');
    }

    public static function prior(bool $atCheckout = false): Builder
    {
        return self::valued('p')->whereColumn('p.user_id', 'o.user_id')
            ->where(self::before('p.paid_at', 'p.id', $atCheckout ? 'o.created_at' : 'o.paid_at'));
    }

    public static function potentiallyPriorUndated(bool $atCheckout = false): Builder
    {
        $history = self::valuedWithConfirmedStatus('h')
            ->whereColumn('h.user_id', 'o.user_id')
            ->where(function (Builder $query) {
                $query->whereNull('h.paid_at')->orWhere('h.paid_at', '<=', 0);
            });
        return $atCheckout
            ? $history->where(self::before('h.created_at', 'h.id', 'o.created_at'))
            : $history->whereColumn('h.created_at', '<=', 'o.paid_at');
    }

    private static function before(string $time, string $id, string $boundary): \Closure
    {
        return static function (Builder $query) use ($time, $id, $boundary) {
            $query->whereColumn($time, '<', $boundary)
                ->orWhere(static function (Builder $tie) use ($time, $id, $boundary) {
                    $tie->whereColumn($time, $boundary)->whereColumn($id, '<', 'o.id');
                });
        };
    }
}
