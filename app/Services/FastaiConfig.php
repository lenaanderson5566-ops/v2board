<?php

namespace App\Services;

// Keep native configuration separate from public subscription protocol discovery.
class FastaiConfig extends \App\Protocols\ClashMeta
{
    public $flag = 'fastai';
    protected $templateName = 'fastai';
    protected $subscriptionMetadata = false;

    protected function prepareConfig(array $config): array
    {
        $config['geo-auto-update'] = false;
        unset($config['geo-update-interval'], $config['geox-url']);
        foreach ($config['rule-providers'] ?? [] as $provider) {
            if (!is_array($provider) || ($provider['type'] ?? null) === 'http' || array_key_exists('url', $provider)) {
                throw new \RuntimeException('FastAI requires bundled or inline rule providers.');
            }
        }
        return $config;
    }
}
