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

    public static function requiringManualEvidence(Builder $query, string $alias): Builder
    {
        return $query->where(function (Builder $payment) use ($alias) {
            $payment->whereNull($alias.'.callback_no')
                ->orWhereRaw("CAST($alias.callback_no AS BINARY) <> ?", ['manual_operation'])
                ->orWhere(function (Builder $manual) use ($alias) {
                    $evidence = $alias.'.manual_payment_evidence';
                    $reference = "JSON_EXTRACT($evidence, '$.reference')";
                    $amount = "JSON_EXTRACT($evidence, '$.amount')";
                    $currency = "JSON_EXTRACT($evidence, '$.currency')";
                    $confirmedAt = "JSON_EXTRACT($evidence, '$.confirmed_at')";
                    $administratorId = "JSON_EXTRACT($evidence, '$.administrator_id')";

                    $manual->where($alias.'.total_amount', '>', 0)
                        ->whereRaw("JSON_TYPE($reference) = 'STRING' AND JSON_UNQUOTE($reference) REGEXP '[^[:space:]]'")
                        ->whereRaw("JSON_TYPE($amount) = 'INTEGER' AND CAST(JSON_UNQUOTE($amount) AS SIGNED) = $alias.total_amount")
                        ->whereRaw("JSON_TYPE($currency) = 'STRING' AND CAST(JSON_UNQUOTE($currency) AS BINARY) = CAST(COALESCE(NULLIF($alias.currency, ''), 'CNY') AS BINARY)")
                        ->whereRaw("JSON_TYPE($confirmedAt) = 'INTEGER' AND CAST(JSON_UNQUOTE($confirmedAt) AS SIGNED) > 0")
                        ->whereRaw("JSON_TYPE($administratorId) = 'INTEGER' AND CAST(JSON_UNQUOTE($administratorId) AS SIGNED) > 0");
                });
        });
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
