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

    public function getRateToCny(string $currency): ?float
    {
        $currency = $this->normalizeCurrency($currency);
        if ($currency === 'CNY') {
            return 1.0;
        }
        if (!Schema::hasTable('v2_currency_rate')) return null;
        $row = CurrencyRate::where('quote_currency', $currency)->orderBy('fetched_at', 'DESC')->first();
        return $row ? (float)$row->rate_to_cny : null;
    }


    public function convertMinorToCnyMinor(int $amountMinor, string $fromCurrency): int
    {
        $fromCurrency = $this->normalizeCurrency($fromCurrency);
        if ($fromCurrency === 'CNY') {
            return $amountMinor;
        }
        $rateToCny = $this->getRateToCny($fromCurrency);
        if (!$rateToCny || $rateToCny <= 0) {
            abort(500, __('Currency rate not found, please contact administrator'));
        }
        return (int)max(1, round($amountMinor * $rateToCny));
    }


    public function convertMinor(int $amountMinor, string $fromCurrency, string $toCurrency): int
    {
        $fromCurrency = $this->normalizeCurrency($fromCurrency);
        $toCurrency = $this->normalizeCurrency($toCurrency);
        if ($fromCurrency === $toCurrency) return $amountMinor;

        $amountCny = $this->convertMinorToCnyMinor($amountMinor, $fromCurrency);
        if ($toCurrency === 'CNY') return $amountCny;

        $rateToCny = $this->getRateToCny($toCurrency);
        if (!$rateToCny || $rateToCny <= 0) {
            abort(500, __('Currency rate not found, please contact administrator'));
        }
        return (int)max(1, round($amountCny / $rateToCny));
    }

    public function convertCnyAmountToTargetMinor(int $cnyMinor, string $targetCurrency): array
    {
        $targetCurrency = $this->normalizeCurrency($targetCurrency);
        $rateToCny = $this->getRateToCny($targetCurrency);
        if (!$rateToCny || $rateToCny <= 0) {
            abort(500, __('Currency rate not found, please contact administrator'));
        }
        $targetMinor = (int)max(1, round($cnyMinor / $rateToCny));
        return [
            'amount_minor' => $targetMinor,
            'rate_to_cny' => $rateToCny,
            'fetched_at' => CurrencyRate::where('quote_currency', $targetCurrency)->max('fetched_at') ?: time()
        ];
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
        if (!is_array($payload) || empty($payload['rates']) || !isset($payload['rates']['CNY'])) {
            return false;
        }

        $rates = $payload['rates'];
        $cnyPerBase = (float)$rates['CNY']; // 1 base = ? CNY
        if ($cnyPerBase <= 0) {
            return false;
        }

        $now = time();
        foreach ($rates as $quote => $rateToBase) {
            $quote = $this->normalizeCurrency($quote);
            $rateToBase = (float)$rateToBase;
            if ($rateToBase <= 0) {
                continue;
            }
            $rateToCny = $cnyPerBase / $rateToBase;
            CurrencyRate::updateOrCreate(
                [
                    'base_currency' => $base,
                    'quote_currency' => $quote,
                ],
                [
                    'rate_to_base' => $rateToBase,
                    'rate_to_cny' => $rateToCny,
                    'fetched_at' => $now,
                ]
            );
        }

        return true;
    }
}
