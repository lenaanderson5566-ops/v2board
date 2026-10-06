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
        $labels = [];
        foreach (require resource_path('client/copy.php') as $copy) {
            foreach (['remaining', 'expiry', 'reset'] as $key) $labels[] = $copy[$key];
        }
        $removed = [];
        $config['proxies'] = array_values(array_filter($config['proxies'] ?? [], function ($proxy) use ($labels, &$removed) {
            $name = trim((string)($proxy['name'] ?? ''));
            foreach ($labels as $label) {
                if (preg_match('/^'.preg_quote($label, '/').'\\s*[:：]/iu', $name)) {
                    $removed[] = $proxy['name'];
                    return false;
                }
            }
            return true;
        }));
        foreach ($config['proxy-groups'] as &$group) {
            $group['proxies'] = array_values(array_diff($group['proxies'] ?? [], $removed));
        }
        unset($group);
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
