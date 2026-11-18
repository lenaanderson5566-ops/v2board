<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

final class RecurringOrderPurchase
{
    public static function valued(string $alias = 'o'): Builder
    {
        return self::valuedWithConfirmedStatus($alias)->where($alias.'.paid_at', '>', 0);
    }

    public static function valuedWithConfirmedStatus(string $alias): Builder
    {
        return DB::table('v2_order as '.$alias)
            ->whereIn($alias.'.status', [1, 3, 4])
            ->where($alias.'.plan_id', '>', 0)
            ->whereIn($alias.'.period', array_keys(OrderService::STR_TO_TIME))
            ->where(function (Builder $query) use ($alias) {
                $query->whereNull($alias.'.credit_bytes')->orWhere($alias.'.credit_bytes', 0);
            })
            ->where($alias.'.total_amount', '>=', 0)
            ->whereRaw('COALESCE('.$alias.'.balance_amount, 0) >= 0')
            ->whereRaw($alias.'.total_amount + COALESCE('.$alias.'.balance_amount, 0) > 0');
    }

    public static function prior(): Builder
    {
        return self::valued('p')->whereColumn('p.user_id', 'o.user_id')
            ->where(function (Builder $query) {
                $query->whereColumn('p.paid_at', '<', 'o.paid_at')
                    ->orWhere(function (Builder $tie) {
                        $tie->whereColumn('p.paid_at', 'o.paid_at')->whereColumn('p.id', '<', 'o.id');
                    });
            });
    }

    public static function potentiallyPriorUndated(): Builder
    {
        return self::valuedWithConfirmedStatus('h')
            ->whereColumn('h.user_id', 'o.user_id')
            ->whereColumn('h.created_at', '<=', 'o.paid_at')
            ->where(function (Builder $query) {
                $query->whereNull('h.paid_at')->orWhere('h.paid_at', '<=', 0);
            });
    }
}
