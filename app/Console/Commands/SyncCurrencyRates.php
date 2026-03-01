<?php

namespace App\Console\Commands;

use App\Services\CurrencyRateService;
use Illuminate\Console\Command;

class SyncCurrencyRates extends Command
{
    protected $signature = 'sync:currency-rate';
    protected $description = 'Sync exchange rates for configured currencies';

    public function handle(CurrencyRateService $currencyRateService): int
    {
        $currencies = config('v2board.currency_support_list', ['CNY', 'USD', 'EUR', 'HKD', 'JPY']);
        $billingCurrency = strtoupper(config('v2board.billing_currency', config('v2board.currency', 'CNY')));
        if (!in_array('CNY', $currencies, true)) {
            $currencies[] = 'CNY';
        }
        if (!in_array($billingCurrency, $currencies, true)) {
            $currencies[] = $billingCurrency;
        }

        $result = $currencyRateService->syncRates($currencies, $billingCurrency);
        $this->info(sprintf('Currency rates synced. base=%s saved=%d', $result['base'], $result['saved']));
        return self::SUCCESS;
    }
}
