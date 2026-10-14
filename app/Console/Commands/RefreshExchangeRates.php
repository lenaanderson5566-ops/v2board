<?php
namespace App\Console\Commands;
class RefreshExchangeRates extends \Illuminate\Console\Command {
    protected $signature='billing:exchange-rates';
    protected $description='Refresh the public reference exchange rate at most once per UTC day';
    public function handle() { \App\Services\ExchangeRate::refresh(); return 0; }
}
