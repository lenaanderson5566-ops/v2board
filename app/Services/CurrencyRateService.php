<?php

namespace App\Services;

use App\Models\CurrencyRate;
use App\Models\CurrencySetting;
use Illuminate\Support\Facades\Schema;

class CurrencyRateService
{
    public function normalizeCurrency(?string $currency): string
    {
        $currency = strtoupper((string)$currency);
        return $currency ?: 'CNY';
    }

    public function getBusinessBaseCurrency(): string
    {
        return $this->normalizeCurrency(CurrencySetting::getValue('business_base_currency', 'CNY'));
    }

    public function getPaymentCurrencyByGateway($payment): string
    {
        if (is_array($payment)) {
            return $this->normalizeCurrency($payment['currency'] ?? 'CNY');
        }
        return $this->normalizeCurrency($payment->currency ?? 'CNY');
    }

    public function getRateToBase(string $currency): ?float
    {
        $currency = $this->normalizeCurrency($currency);
        $baseCurrency = $this->getBusinessBaseCurrency();
        if ($currency === $baseCurrency) {
            return 1.0;
        }
        if (!Schema::hasTable('v2_currency_rate')) return null;
        $row = CurrencyRate::where('base_currency', $baseCurrency)
            ->where('quote_currency', $currency)
            ->orderBy('fetched_at', 'DESC')
            ->first();
        return $row ? (float)$row->rate_to_base : null;
    }


    public function convertMinorToCurrencyMinor(int $amountMinor, string $fromCurrency, string $targetCurrency): int
    {
        return $this->convertMinor($amountMinor, $fromCurrency, $targetCurrency);
    }

    // Backward-compat wrapper, avoid using CNY-specific naming in new code
    public function convertMinorToCnyMinor(int $amountMinor, string $fromCurrency): int
    {
        return $this->convertMinorToCurrencyMinor($amountMinor, $fromCurrency, 'CNY');
    }


    public function convertMinor(int $amountMinor, string $fromCurrency, string $toCurrency): int
    {
        $fromCurrency = $this->normalizeCurrency($fromCurrency);
        $toCurrency = $this->normalizeCurrency($toCurrency);
        if ($fromCurrency === $toCurrency) return $amountMinor;

        $fromRateToBase = $this->getRateToBase($fromCurrency);
        $toRateToBase = $this->getRateToBase($toCurrency);

        if (!$fromRateToBase || $fromRateToBase <= 0 || !$toRateToBase || $toRateToBase <= 0) {
            abort(500, __('Currency rate not found, please contact administrator'));
        }

        $amountInBase = $amountMinor * $fromRateToBase;
        return (int)max(1, round($amountInBase / $toRateToBase));
    }

    public function convertFromCurrencyAmountToTargetMinor(int $amountMinor, string $fromCurrency, string $targetCurrency): array
    {
        $fromCurrency = $this->normalizeCurrency($fromCurrency);
        $targetCurrency = $this->normalizeCurrency($targetCurrency);
        $targetMinor = $this->convertMinor($amountMinor, $fromCurrency, $targetCurrency);

        $baseCurrency = $this->getBusinessBaseCurrency();
        $targetRateToBase = $this->getRateToBase($targetCurrency);
        $fromRateToBase = $this->getRateToBase($fromCurrency);

        $rateFromTargetToFrom = null;
        if ($targetRateToBase && $targetRateToBase > 0 && $fromRateToBase && $fromRateToBase > 0) {
            $rateFromTargetToFrom = $targetRateToBase / $fromRateToBase;
        }

        return [
            'amount_minor' => $targetMinor,
            'rate_from_target_to_from' => $rateFromTargetToFrom,
            'base_currency' => $baseCurrency,
            'fetched_at' => CurrencyRate::where('base_currency', $baseCurrency)
                ->where('quote_currency', $targetCurrency)
                ->max('fetched_at') ?: time()
        ];
    }

    // Backward-compat wrapper, avoid using CNY-specific naming in new code
    public function convertCnyAmountToTargetMinor(int $cnyMinor, string $targetCurrency): array
    {
        return $this->convertFromCurrencyAmountToTargetMinor($cnyMinor, 'CNY', $targetCurrency);
    }

    public function refreshAllRates(): bool
    {
        if (!Schema::hasTable('v2_currency_rate')) return false;
        $base = $this->getBusinessBaseCurrency();
        $endpoint = CurrencySetting::getValue('currency_rate_api', 'https://open.er-api.com/v6/latest/{base}');
        $url = str_replace('{base}', $base, $endpoint);

        $json = @file_get_contents($url);
        if (!$json) {
            return false;
        }
        $payload = json_decode($json, true);
        if (!is_array($payload) || empty($payload['rates'])) {
            return false;
        }

        $rates = $payload['rates'];

        $now = time();
        foreach ($rates as $quote => $rateToBase) {
            $quote = $this->normalizeCurrency($quote);
            $rateToBase = (float)$rateToBase;
            if ($rateToBase <= 0) {
                continue;
            }
            // API response is: 1 base = ? quote, we store: 1 quote = ? base
            $rateToBase = 1 / $rateToBase;
            CurrencyRate::updateOrCreate(
                [
                    'base_currency' => $base,
                    'quote_currency' => $quote,
                ],
                [
                    'rate_to_base' => $rateToBase,
                    'fetched_at' => $now,
                ]
            );
        }

        return true;
    }
}
