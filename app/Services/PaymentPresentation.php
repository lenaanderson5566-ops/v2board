<?php

namespace App\Services;

use Illuminate\Support\Facades\Validator;

class PaymentPresentation
{
    public static function validate(array $config): void
    {
        if (!array_key_exists('_console_checkout', $config)) return;
        Validator::make($config, [
            '_console_checkout' => 'required|array',
            '_console_checkout.category' => 'required|in:regular,crypto',
            '_console_checkout.asset' => 'required_if:_console_checkout.category,crypto|nullable|string|max:20|regex:/^[A-Z0-9][A-Z0-9._-]*$/',
            '_console_checkout.network' => 'required_if:_console_checkout.category,crypto|nullable|string|max:40|regex:/^[a-z0-9][a-z0-9_-]*$/',
            '_console_checkout.networkName' => 'required_if:_console_checkout.category,crypto|nullable|string|max:80',
            '_console_checkout.networkIcon' => 'nullable|url:http,https|max:2048',
        ])->validate();
    }

    public static function fields(array $config): array
    {
        $meta = $config['_console_checkout'] ?? [];
        $crypto = is_array($meta) && ($meta['category'] ?? '') === 'crypto'
            && !empty($meta['asset']) && !empty($meta['network']) && !empty($meta['networkName']);
        $catalog = json_decode(file_get_contents(resource_path('payment-catalog.json')), true);
        $asset = $crypto ? $meta['asset'] : null;
        $network = $crypto ? $meta['network'] : null;
        $assetEntry = collect($catalog['assets'])->firstWhere('id', $asset);
        $networkEntry = collect($catalog['networks'])->firstWhere('id', $network);
        return [
            'category' => $crypto ? 'crypto' : 'regular',
            'asset' => $asset,
            'asset_icon' => $crypto ? '/payment-icons/' . ($assetEntry['icon'] ?? 'crypto-generic') . '.svg' : null,
            'network' => $network,
            'network_name' => $crypto ? ($networkEntry['name'] ?? $meta['networkName']) : null,
            'network_icon' => $crypto ? (!empty($meta['networkIcon']) ? $meta['networkIcon'] : '/payment-icons/' . ($networkEntry['icon'] ?? 'crypto-generic') . '.svg') : null,
        ];
    }
}
