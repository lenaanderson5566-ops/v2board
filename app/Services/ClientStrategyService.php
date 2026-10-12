<?php

namespace App\Services;

use App\Models\ClientStrategy;
use App\Models\RiskSetting;
use Illuminate\Support\Facades\DB;


class ClientStrategyService
{
    // Read-only public presentation data, no rule details or blacklist information.
    public function frontendPolicies(): array
    {
        $mapping = ['cmfa'=>'meta', 'clash'=>'verge', 'flclash'=>'flclash', 'hiddify'=>'sing', 'singbox'=>'sing',
            'shadowrocket'=>'shadowrocket', 'surge'=>'surge', 'quantumult'=>'quantumult%20x', 'stash'=>'stash', 'surfboard'=>'surfboard'];
        $rows = ClientStrategy::query()->whereIn('client_type', array_merge(array_values($mapping), ['meta']))->get()->keyBy('client_type');
        $enabledMap = $this->enabledMap();
        $result = [];
        foreach ($mapping as $id => $flag) {
            $row = $rows->get($flag);
            $enabled = $enabledMap[$flag];
            $result[$id] = ['enabled' => $enabled, 'minVersion' => $row->min_version ?? null];
        }
        return $result;
    }

    public function scanProtocols(): array
    {
        $clients = [];
        foreach (SubscriptionClientRegistry::CLIENTS as $flag => [$id, $class, $name]) {
            $clients[$flag] = ['client_type'=>$flag, 'client_name'=>$name];
        }
        ksort($clients);
        return $clients;
    }

    public function syncStrategies(): array
    {
        $protocols = $this->scanProtocols();
        $unified = RiskSetting::query()->where('key', 'client_access_unified')->exists();
        foreach ($protocols as $protocol) {
            $strategy = ClientStrategy::query()->firstOrCreate(
                ['client_type' => $protocol['client_type']],
                ['client_name' => $protocol['client_name'], 'is_enabled' => $unified ? 0 : 1]
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
        $existing = ClientStrategy::query()
            ->whereIn('client_type', array_keys(SubscriptionClientRegistry::CLIENTS))
            ->orderBy('sort')
            ->orderBy('client_name')
            ->get()->keyBy('client_type');
        $enabledMap = $this->enabledMap();
        return collect($this->scanProtocols())->map(function ($defaults, $type) use ($existing, $enabledMap) {
                $row = $existing->get($type) ?? new ClientStrategy($defaults + ['is_enabled'=>1, 'sort'=>0]);
                $type = $row->client_type;
                $row->setAttribute('is_enabled', $enabledMap[$type]);
                $row->setAttribute('client_id', SubscriptionClientRegistry::CLIENTS[$type][0]);
                $examples = ['meta'=>'1.19.0', 'sing'=>'1.12.0', 'verge'=>'2.3.1', 'flclash'=>'0.8.0'];
                $row->setAttribute('version_source', in_array($type, ['meta','sing'], true) ? '内核版本（UA 明确提供时）' : (in_array($type, ['flclash','verge'], true) ? '应用版本' : 'UA 版本／构建号，需核验'));
                $row->setAttribute('ua_verification', in_array($type, ['flclash','verge','meta'], true) ? '官方来源已核对；支持自定义 UA' : ($type === 'sing' ? 'Hiddify 来源已核对；其他变体未核对' : '兼容规则；官方来源未核对'));
                $row->setAttribute('version_example', $examples[$type] ?? '1.2.3');
                $row->setAttribute('ua_names', implode(' / ', ClientIdentity::ALIASES[$type] ?? []));
                return $row;
            })->sortBy([['sort', 'asc'], ['client_name', 'asc']])->values();
    }

    public function accessDenial(string $format, string $ua): ?string
    {
        $client = ClientIdentity::identify($ua);
        if (!$client) return 'client_ua_not_allowed';
        if (!SubscriptionClientRegistry::compatible($client, $format)) return 'client_format_not_allowed';
        $types = SubscriptionClientRegistry::policyTypes($client);
        if (!$this->isEnabled($client)) return 'client_disabled';
        foreach ($types as $type) if (!$this->isVersionAllowed($type, ClientIdentity::version($type, $ua))) return 'client_version_too_low';
        return null;
    }
    private function enabledMap(): array
    {
        $unified = RiskSetting::query()->where('key', 'client_access_unified')->exists();
        $rows = ClientStrategy::query()->pluck('is_enabled', 'client_type');
        $legacyWhitelist = !$unified && config('v2board.subscription_ua_whitelist_enabled', 0);
        $allowed = (array) config('v2board.subscription_ua_whitelist', []);
        $result = [];
        foreach (array_keys(SubscriptionClientRegistry::CLIENTS) as $type) {
            $enabled = (bool) ($rows[$type] ?? !$unified);
            if (!$unified) {
                if ($legacyWhitelist && !in_array($type, $allowed, true)) $enabled = false;
                foreach (SubscriptionClientRegistry::policyTypes($type) as $parent) {
                    if (isset($rows[$parent]) && !$rows[$parent]) $enabled = false;
                }
            }
            $result[$type] = $enabled;
        }
        return $result;
    }

    public function isEnabled(?string $clientType): bool
    {
        return $this->enabledMap()[strtolower((string) $clientType)] ?? false;
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
            if (!isset(SubscriptionClientRegistry::CLIENTS[strtolower((string) ($item['client_type'] ?? ''))])) abort(422, 'invalid client_type');
            if (!empty($item['min_version']) && ClientIdentity::normalizeVersion((string) $item['min_version']) === null) abort(422, '最低版本格式无效，例如 1.19.0、v2.3.1 或 2.0.0-rc.1');
        }
        return DB::transaction(function () use ($items) {
            $protocols = $this->syncStrategies();
            // Lock the same rows on every write so concurrent first saves cannot import twice.
            ClientStrategy::query()->orderBy('id')->lockForUpdate()->get();
            if (!RiskSetting::query()->where('key', 'client_access_unified')->exists()) {
                $effective = $this->enabledMap();
                foreach ($effective as $type => $enabled) ClientStrategy::query()->where('client_type', $type)->update(['is_enabled'=>(int) $enabled]);
                RiskSetting::query()->create(['key'=>'client_access_unified', 'value'=>'1']);
            }
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
        });
    }

}
