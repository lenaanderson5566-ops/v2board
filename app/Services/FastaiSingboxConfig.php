<?php

namespace App\Services;

class FastaiSingboxConfig extends \App\Protocols\Singbox
{
    private array $nodeMetadata = [];

    public function __construct($user, $servers)
    {
        foreach ($servers as &$server) {
            $metadata = NodeDisplayService::metadata($server);
            if ($metadata['nodeId'] !== null) {
                $this->nodeMetadata[$metadata['proxyName']] = $metadata;
                $server['name'] = $metadata['proxyName'];
            }
        }
        unset($server);
        parent::__construct($user, $servers);
    }

    protected function loadConfig()
    {
        $custom = resource_path('rules/custom.fastai.sing-box.json');
        $path = is_file($custom) ? $custom : resource_path('rules/default.fastai.sing-box.json');
        $config = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($config) || !is_array($config['outbounds'] ?? null)) {
            throw new \RuntimeException('FastAI sing-box template requires outbounds.');
        }
        if (array_intersect(array_column($config['outbounds'], 'tag'), array_keys($this->nodeMetadata))) {
            throw new \RuntimeException('FastAI template names conflict with managed node identities.');
        }
        foreach ($config['route']['rule_set'] ?? [] as $rule) {
            if (($rule['type'] ?? '') === 'remote' || isset($rule['url'])) {
                throw new \RuntimeException('FastAI requires bundled or inline rule sets.');
            }
        }
        $config['inbounds'] = [];
        unset($config['experimental']['clash_api'], $config['experimental']['cache_file']);
        return $config;
    }

    protected function buildProxies()
    {
        $proxies = parent::buildProxies();
        $this->nodeMetadata = array_intersect_key($this->nodeMetadata, array_fill_keys(array_column($proxies, 'tag'), true));
        return $proxies;
    }

    public function nodes(): array
    {
        return array_values($this->nodeMetadata);
    }
}
