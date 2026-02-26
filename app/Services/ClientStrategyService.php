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
            ClientStrategy::query()->updateOrCreate(
                ['client_type' => $protocol['client_type']],
                ['client_name' => $protocol['client_name']]
            );
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

            if ($payload) {
                ClientStrategy::query()->where('client_type', $clientType)->update($payload);
            }
        }

        return $this->getStrategies();
    }

    private function defaultClientName(string $className): string
    {
        $name = preg_replace('/(?<!^)([A-Z])/', ' $1', $className);
        return trim((string) $name) ?: $className;
    }
}
