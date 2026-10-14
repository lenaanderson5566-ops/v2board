<?php
namespace App\Services;
use App\Models\Plan;
use App\Models\User;

final class BillingCurrency
{
    public const PERIODS=['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price','onetime_price','reset_price'];
    public static function account(?User $user): string { return $user->currency ?? 'CNY'; }
    public static function price(Plan $plan, string $period, string $currency): ?int {
        if (!in_array($period,self::PERIODS,true) || !in_array($currency,['CNY','USD'],true)) throw new \InvalidArgumentException('Invalid price currency or period');
        $value=$currency === 'CNY' ? $plan->getRawOriginal($period) : ($plan->usd_prices[$period] ?? null);
        return $value === null ? null : (int)$value;
    }
    public static function present(Plan $plan, string $currency): Plan {
        foreach(self::PERIODS as $period) $plan->setAttribute($period,self::price($plan,$period,$currency));
        $plan->setAttribute('currency',$currency);
        return $plan;
    }
}
