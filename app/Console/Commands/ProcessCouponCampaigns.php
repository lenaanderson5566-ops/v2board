<?php

namespace App\Console\Commands;

use App\Services\CouponCampaign;
use Illuminate\Console\Command;

final class ProcessCouponCampaigns extends Command
{
    protected $signature = 'coupons:campaigns {--limit=200 : Maximum recipients per run}';
    protected $description = 'Process reserved coupon campaign recipients';

    public function handle(): int
    {
        $this->info('Processed '.CouponCampaign::process((int)$this->option('limit')).' coupon recipients.');
        return 0;
    }
}
