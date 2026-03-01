<?php

namespace App\Services;

use App\Models\CurrencyRate;
use Illuminate\Support\Facades\Http;

class CurrencyRateService
{
    public function getBillingCurrency(): string
    {
        return strtoupper(config('v2board.billing_currency', config('v2board.currency', 'CNY')));
    }

    public function getRate(string $baseCurrency, string $quoteCurrency): ?string
    {
        $baseCurrency = strtoupper($baseCurrency);
        $quoteCurrency = strtoupper($quoteCurrency);
        if ($baseCurrency === $quoteCurrency) {
            return '1';
        }

        $latest = CurrencyRate::query()
            ->where('base_currency', $baseCurrency)
            ->where('quote_currency', $quoteCurrency)
            ->orderByDesc('fetched_at')
            ->first();

        return $latest ? (string) $latest->rate : null;
    }

    public function convert(int $amount, string $fromCurrency, string $toCurrency): int
    {
        if (strtoupper($fromCurrency) === strtoupper($toCurrency)) {
            return $amount;
        }

        $rate = $this->resolveCrossRate($fromCurrency, $toCurrency);
        if (!$rate) {
            abort(500, __('Currency conversion has timed out, please try again later'));
        }

        return (int) round($amount * (float) $rate);
    }

    public function resolveCrossRate(string $fromCurrency, string $toCurrency): ?string
    {
        $fromCurrency = strtoupper($fromCurrency);
        $toCurrency = strtoupper($toCurrency);
        if ($fromCurrency === $toCurrency) {
            return '1';
        }

        $direct = $this->getRate($fromCurrency, $toCurrency);
        if ($direct) {
            return $direct;
        }

        $billingCurrency = $this->getBillingCurrency();
        $toBilling = $this->getRate($fromCurrency, $billingCurrency);
        $billingToTarget = $this->getRate($billingCurrency, $toCurrency);

        if ($toBilling && $billingToTarget) {
            return (string) ((float) $toBilling * (float) $billingToTarget);
        }

        return null;
    }

    public function syncRates(array $quoteCurrencies, ?string $baseCurrency = null): array
    {
        $baseCurrency = strtoupper($baseCurrency ?: $this->getBillingCurrency());
        $quoteCurrencies = array_values(array_unique(array_map('strtoupper', $quoteCurrencies)));
        $quoteCurrencies = array_values(array_filter($quoteCurrencies, fn($item) => $item !== $baseCurrency));

        if (!count($quoteCurrencies)) {
            return ['base' => $baseCurrency, 'saved' => 0];
        }

        $response = Http::timeout(15)->get('https://api.exchangerate.host/latest', [
            'base' => $baseCurrency,
            'symbols' => implode(',', $quoteCurrencies)
        ]);

        if (!$response->successful()) {
            abort(500, 'Failed to sync currency rates');
        }

        $payload = $response->json();
        $rates = $payload['rates'] ?? [];
        $now = time();
        $saved = 0;

        foreach ($quoteCurrencies as $quoteCurrency) {
            if (!isset($rates[$quoteCurrency])) {
                continue;
            }
            CurrencyRate::query()->create([
                'base_currency' => $baseCurrency,
                'quote_currency' => $quoteCurrency,
                'rate' => (string) $rates[$quoteCurrency],
                'source' => 'exchangerate.host',
                'fetched_at' => $now
            ]);
            $saved++;
        }

        CurrencyRate::query()->create([
            'base_currency' => $baseCurrency,
            'quote_currency' => $baseCurrency,
            'rate' => '1',
            'source' => 'system',
            'fetched_at' => $now
        ]);

        return ['base' => $baseCurrency, 'saved' => $saved + 1];
    }
}
