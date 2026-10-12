<?php

namespace App\Services;

use App\Models\ClientStrategy;
use ReflectionClass;

class ClientStrategyService
{
    // Read-only public presentation data, no rule details or blacklist information.
    public function frontendPolicies(): array
    {
        $mapping = ['cmfa'=>'meta', 'clash'=>'verge', 'flclash'=>'flclash', 'hiddify'=>'sing', 'singbox'=>'sing',
            'shadowrocket'=>'shadowrocket', 'surge'=>'surge', 'quantumult'=>'quantumult%20x', 'stash'=>'stash', 'surfboard'=>'surfboard'];
        $rows = ClientStrategy::query()->whereIn('client_type', array_merge(array_values($mapping), ['meta']))->get()->keyBy('client_type');
        $result = [];
        foreach ($mapping as $id => $flag) {
            $row = $rows->get($flag);
            $enabled = !$row || (bool) $row->is_enabled;
            if (in_array($flag, ['flclash', 'verge'], true) && $rows->get('meta') && !$rows->get('meta')->is_enabled) $enabled = false;
            $result[$id] = ['enabled' => $enabled, 'minVersion' => $row->min_version ?? null];
        }
        return $result;
    }

    public function scanProtocols(): array
    {
        $clients = [];
        foreach (glob(app_path('Protocols') . '/*.php') as $file) {
            $class = 'App\\Protocols\\' . basename($file, '.php');
            if (!class_exists($class)) {
                continue;
            }

            $defaultProperties = (new ReflectionClass($class))->getDefaultProperties();
            $flag = strtolower((string) ($defaultProperties['flag'] ?? ''));
            if (!$flag) {
                continue;
            }

            $clients[$flag] = [
                'client_type' => $flag,
                'client_name' => $this->defaultClientName(basename($file, '.php')),
            ];
        }

        ksort($clients);
        return $clients;
    }

    public function syncStrategies(): array
    {
        $protocols = $this->scanProtocols();
        foreach ($protocols as $protocol) {
            $strategy = ClientStrategy::query()->firstOrCreate(
                ['client_type' => $protocol['client_type']],
                ['client_name' => $protocol['client_name']]
            );

            // Keep administrator custom name unchanged.
            if (!$strategy->client_name) {
                $strategy->client_name = $protocol['client_name'];
                $strategy->save();
            }
        }

        return $protocols;
    }

    public function getStrategies()
    {
        $this->syncStrategies();

        return ClientStrategy::query()
            ->orderBy('sort')
            ->orderBy('client_name')
            ->get()->map(function ($row) {
                $type = $row->client_type;
                $examples = ['meta'=>'1.19.0', 'sing'=>'1.12.0', 'verge'=>'2.3.1', 'flclash'=>'0.8.0'];
                $row->setAttribute('version_source', in_array($type, ['meta','sing'], true) ? '内核版本' : ($type === 'general' ? '无版本识别' : '应用版本'));
                $row->setAttribute('version_example', $type === 'general' ? '请留空' : ($examples[$type] ?? '1.2.3'));
                $row->setAttribute('ua_names', implode(' / ', ClientIdentity::ALIASES[$type] ?? []));
                return $row;
            });
    }

    public function accessDenial(string $format, string $ua): ?string
    {
        $types = array_values(array_unique(array_filter([$format, ClientIdentity::identify($ua)])));
        if (in_array('verge', $types, true) || in_array('flclash', $types, true)) $types[] = 'meta';
        foreach ($types as $type) if (!$this->isEnabled($type)) return 'client_disabled';
        foreach ($types as $type) if (!$this->isVersionAllowed($type, ClientIdentity::version($type, $ua))) return 'client_version_too_low';
        return null;
    }
    public function isEnabled(?string $clientType): bool
    {
        $clientType = strtolower((string) $clientType);
        if (!$clientType) {
            return true;
        }

        $strategy = ClientStrategy::query()->where('client_type', $clientType)->first();

        if (in_array($clientType, ['flclash', 'verge'], true) && !$this->isEnabled('meta')) return false;
        return $strategy ? (bool) $strategy->is_enabled : true;
    }



    public function isVersionAllowed(?string $clientType, ?string $clientVersion): bool
    {
        $clientType = strtolower((string) $clientType);
        if (!$clientType) {
            return true;
        }

        $strategy = ClientStrategy::query()->where('client_type', $clientType)->first();
        if (!$strategy) {
            return true;
        }

        return ClientIdentity::allowsVersion($strategy->min_version, $clientVersion);
    }
    public function resolveClientVersion(string $clientType, string $requestedFlag, string $userAgent): ?string
    {
        return ClientIdentity::version($clientType, $userAgent);
    }
    public function deleteStrategy(string $clientType): bool
    {
        $clientType = strtolower(trim($clientType));
        if (!$clientType) {
            abort(422, 'invalid client_type');
        }

        $protocols = $this->scanProtocols();
        if (isset($protocols[$clientType])) {
            abort(422, 'client_type exists in protocols, remove protocol file first');
        }

        return (bool) ClientStrategy::query()->where('client_type', $clientType)->delete();
    }

    public function updateStrategies(array $items)
    {
        foreach ($items as $item) {
            if (($item['client_type'] ?? '') === 'general' && trim((string) ($item['min_version'] ?? '')) !== '') abort(422, '通用格式无法识别版本，请将最低版本留空');
            if (!empty($item['min_version']) && ClientIdentity::normalizeVersion((string) $item['min_version']) === null) abort(422, '最低版本格式无效，例如 1.19.0、v2.3.1 或 2.0.0-rc.1');
        }
        $protocols = $this->syncStrategies();
        $allowed = array_flip(array_keys($protocols));

        foreach ($items as $item) {
            $clientType = strtolower((string) ($item['client_type'] ?? ''));
            if (!$clientType || !isset($allowed[$clientType])) {
                abort(422, 'invalid client_type: ' . $clientType);
            }

            $payload = [];
            if (array_key_exists('is_enabled', $item)) {
                $payload['is_enabled'] = (int) ((bool) $item['is_enabled']);
            }
            if (array_key_exists('sort', $item)) {
                $payload['sort'] = (int) $item['sort'];
            }
            if (array_key_exists('client_name', $item) && !is_null($item['client_name'])) {
                $payload['client_name'] = trim((string) $item['client_name']);
            }
            if (array_key_exists('min_version', $item)) {
                $payload['min_version'] = trim((string) ($item['min_version'] ?? '')) ?: null;
            }

            if ($payload) {
                ClientStrategy::query()->where('client_type', $clientType)->update($payload);
            }
        }

        return $this->getStrategies();
    }

    private function defaultClientName(string $className): string
    {
        if ($className === 'FlClash') return 'FlClash';
        $name = preg_replace('/(?<!^)([A-Z])/', ' $1', $className);
        return trim((string) $name) ?: $className;
    }
}
