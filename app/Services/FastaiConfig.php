<?php

namespace App\Services;

// Keep native configuration separate from public subscription protocol discovery.
class FastaiConfig extends \App\Protocols\ClashMeta
{
    public $flag = 'fastai';
    protected $templateName = 'fastai';
    protected $subscriptionMetadata = false;
    private array $nodeMetadata = [];
    private bool $structured;

    public function __construct($user, $servers, bool $structured = false)
    {
        $this->structured = $structured;
        $servers = ClientConfigService::uniqueNames($servers, 'name', ['DIRECT', 'REJECT', 'GLOBAL']);
        foreach ($servers as &$server) {
            $metadata = NodeDisplayService::metadata($server);
            if ($metadata['nodeId'] !== null) {
                $this->nodeMetadata[$metadata['proxyName']] = $metadata;
                if ($structured) {
                    $server['original_name'] = $server['name'];
                    $server['name'] = $metadata['proxyName'];
                }
            }
        }
        unset($server);
        parent::__construct($user, $servers);
    }

    public function nodes(): array
    {
        return array_values($this->nodeMetadata);
    }


    protected function validateTemplate(array $config): void
    {
        if (!$this->structured) return;
        $reserved = array_merge(array_column($config['proxies'] ?? [], 'name'), array_column($config['proxy-groups'] ?? [], 'name'));
        if (array_intersect($reserved, array_keys($this->nodeMetadata))) {
            throw new \RuntimeException('FastAI template names conflict with managed node identities.');
        }
    }

    protected function prepareConfig(array $config): array
    {
        $labels = [];
        foreach (require resource_path('client/copy.php') as $copy) {
            foreach (['remaining', 'expiry', 'reset'] as $key) $labels[] = $copy[$key];
            $labels = array_merge($labels, $copy['metadata_aliases'] ?? []);
        }
        $removed = [];
        $config['proxies'] = array_values(array_filter($config['proxies'] ?? [], function ($proxy) use ($labels, &$removed) {
            $name = trim((string)($this->nodeMetadata[$proxy['name'] ?? '']['name'] ?? $proxy['name'] ?? ''));
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
        if ($this->structured) {
            $this->nodeMetadata = array_intersect_key($this->nodeMetadata, array_fill_keys(array_column($config['proxies'], 'name'), true));
        }
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
