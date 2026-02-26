<?php

namespace App\Services;

use App\Models\ClientStrategy;
use ReflectionClass;

class ClientStrategyService
{
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
            ->get();
    }

    public function isEnabled(?string $clientType): bool
    {
        $clientType = strtolower((string) $clientType);
        if (!$clientType) {
            return true;
        }

        $this->syncStrategies();
        $strategy = ClientStrategy::query()->where('client_type', $clientType)->first();

        return $strategy ? (bool) $strategy->is_enabled : true;
    }



    public function isVersionAllowed(?string $clientType, ?string $clientVersion): bool
    {
        $clientType = strtolower((string) $clientType);
        if (!$clientType) {
            return true;
        }

        $this->syncStrategies();
        $strategy = ClientStrategy::query()->where('client_type', $clientType)->first();
        if (!$strategy) {
            return true;
        }

        $minVersion = $this->normalizeVersion((string) ($strategy->min_version ?? ''));
        if (!$minVersion) {
            return true;
        }

        $currentVersion = $this->normalizeVersion((string) $clientVersion);
        if (!$currentVersion) {
            return false;
        }

        return version_compare($currentVersion, $minVersion, '>=');
    }

    public function resolveClientVersion(string $clientType, string $requestedFlag, string $userAgent): ?string
    {
        $candidates = [trim((string) $requestedFlag), trim((string) $userAgent)];
        foreach ($candidates as $raw) {
            if (!$raw) {
                continue;
            }

            if (preg_match('/(?:^|[^a-z0-9])' . preg_quote($clientType, '/') . '[\/\s_-]*v?(\d+(?:\.\d+){0,3})/i', $raw, $m)) {
                return $m[1];
            }
            if (preg_match('/\bv?(\d+(?:\.\d+){1,3})\b/i', $raw, $m)) {
                return $m[1];
            }
        }

        return null;
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

    private function normalizeVersion(string $version): ?string
    {
        $version = trim(strtolower($version));
        if (!$version) {
            return null;
        }

        if (!preg_match('/v?(\d+(?:\.\d+){0,3})/', $version, $m)) {
            return null;
        }

        return $m[1];
    }

    private function defaultClientName(string $className): string
    {
        $name = preg_replace('/(?<!^)([A-Z])/', ' $1', $className);
        return trim((string) $name) ?: $className;
    }
}
