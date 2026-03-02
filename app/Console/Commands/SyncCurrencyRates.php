<?php

namespace App\Console\Commands;

use App\Services\CurrencyRateService;
use Illuminate\Console\Command;

class SyncCurrencyRates extends Command
{
    protected $signature = 'currency:sync';
    protected $description = '同步国际化中心汇率';

    public function handle(CurrencyRateService $currencyRateService)
    {
        $ok = $currencyRateService->refreshAllRates();
        if (!$ok) {
            $this->warn('汇率同步失败，继续使用上次有效汇率');
            return 0;
        }
        $this->info('汇率同步成功');
        return 0;
    }
}
