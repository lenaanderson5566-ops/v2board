<?php

namespace App\Services;

use App\Models\Order;
use Carbon\CarbonImmutable;

class DashboardRevenue
{
    public static function summary(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $year = $now->startOfYear();
        $lastYear = $year->subYear();
        $month = $now->startOfMonth();
        $ranges = [
            'day_income' => [$now->startOfDay(), $now->addSecond()],
            'month_income' => [$month, $now->addSecond()],
            'last_month_income' => [$month->subMonth(), $month],
            'year_income' => [$year, $now->addSecond()],
            'last_year_income' => [$lastYear, $year],
            'last_year_same_period_income' => [$lastYear, $now->subYearNoOverflow()->addSecond()],
        ];
        $query = Order::query()->whereNotIn('status', [0, 2])
            ->where('paid_at', '>=', $lastYear->timestamp)
            ->where('paid_at', '<=', $now->timestamp);
        foreach ($ranges as $key => [$start, $end]) {
            $query->selectRaw("COALESCE(SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN total_amount ELSE 0 END), 0) AS {$key}", [$start->timestamp, $end->timestamp]);
        }
        $result = $query->first();
        return array_map(fn ($value) => (int) $value, $result->getAttributes());
    }
}
