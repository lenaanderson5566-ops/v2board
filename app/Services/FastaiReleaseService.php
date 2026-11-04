<?php

namespace App\Services;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class FastaiReleaseService
{
    public const PUBLISH_TARGETS = [
        'windows' => ['x64', 'arm64'],
        'android' => ['x64', 'arm64', 'arm'],
        'macos' => ['x64', 'arm64'],
        'linux' => ['x64', 'arm64'],
    ];

    public static function catalogRevision(array $catalog): string
    {
        return hash('sha256', json_encode($catalog, JSON_THROW_ON_ERROR));
    }

    public static function globalMinimum(): ?string
    {
        return \App\Models\ClientStrategy::query()->where('client_type', 'fastai')->value('min_version');
    }

    public static function validatePublication(array $catalog, ?string $globalMinimum, array $current = []): void
    {
        self::validateCatalog($catalog);
        $normalize = static function (array $release): array {
            $release += ['releaseNotes' => null];
            if (isset($release['latestBuild'])) $release['latestBuild'] = (int)$release['latestBuild'];
            ksort($release);
            return $release;
        };
        $previous = array_map($normalize, array_filter($current, 'is_array'));
        foreach ($catalog as $release) {
            $platform = $release['platform'];
            $architecture = $release['architecture'];
            $target = "$platform / $architecture";
            if (!in_array($architecture, self::PUBLISH_TARGETS[$platform], true)) {
                if (in_array($normalize($release), $previous, true)) continue;
                throw ValidationException::withMessages(['fastai_releases' => "构建流程不支持发布 {$target}。"]);
            }
            if (!ClientIdentity::allowsVersion($globalMinimum, $release['latestVersion'])) {
                throw ValidationException::withMessages([
                    'fastai_releases' => "$target 的待发布版本 {$release['latestVersion']} 低于客户端访问策略最低版本 {$globalMinimum}。",
                ]);
            }
        }
    }

    public function publicDownloads(): array
    {
        $policy = new ClientStrategyService();
        if (!$policy->isEnabled('fastai')) return [];
        return array_values(array_filter(config('fastai.fastai_releases', []), function ($release) use ($policy) {
            return ($release['channel'] ?? '') === 'stable'
                && str_starts_with($release['downloadUrl'] ?? '', 'https://')
                && $policy->isVersionAllowed('fastai', $release['latestVersion'] ?? null)
                && ClientIdentity::allowsVersion($release['minimumVersion'] ?? null, $release['latestVersion'] ?? null);
        }));
    }

    public static function validateCatalog(array $catalog): void
    {
        Validator::make(['releases' => $catalog], [
            'releases' => 'array|max:32',
            'releases.*' => 'array:platform,architecture,channel,latestVersion,latestBuild,minimumVersion,downloadUrl,sha256,releaseNotes,publishedAt',
            'releases.*.platform' => 'required|in:windows,android,macos,linux',
            'releases.*.architecture' => 'required|in:x64,arm64,arm,x86',
            'releases.*.channel' => 'required|in:stable',
            'releases.*.latestVersion' => ['required', 'regex:/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/'],
            'releases.*.minimumVersion' => ['required', 'regex:/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/'],
            'releases.*.latestBuild' => 'required|integer|min:1|max:2100000000',
            'releases.*.downloadUrl' => 'required|url|max:2048',
            'releases.*.sha256' => ['required', 'regex:/^[a-f0-9]{64}$/'],
            'releases.*.releaseNotes' => 'nullable|string|max:12000',
            'releases.*.publishedAt' => 'required|date_format:Y-m-d\TH:i:s\Z',
        ])->validate();
        $seen = [];
        foreach ($catalog as $release) {
            $url = parse_url($release['downloadUrl']);
            $key = $release['platform'] . ':' . $release['architecture'] . ':' . $release['channel'];
            if (($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass'])
                || isset($seen[$key]) || version_compare($release['minimumVersion'], $release['latestVersion'], '>')) {
                throw ValidationException::withMessages(['fastai_releases' => 'Invalid FastAI release origin, version range or duplicate target.']);
            }
            $seen[$key] = true;
        }
    }

    public function release(string $platform, string $architecture): ?array
    {
        $catalog = config('fastai.fastai_releases', []);
        self::validateCatalog($catalog);
        foreach ($catalog as $release) {
            if ($release['platform'] === $platform && $release['architecture'] === $architecture && $release['channel'] === 'stable') {
                return $release;
            }
        }
        return null;
    }

    public function supports(string $version, string $platform, ?string $architecture): bool
    {
        if ($architecture !== null) {
            $release = $this->release($platform, $architecture);
            return !$release || version_compare($version, $release['minimumVersion'], '>=');
        }
        $catalog = config('fastai.fastai_releases', []);
        self::validateCatalog($catalog);
        foreach ($catalog as $release) {
            if ($release['platform'] === $platform && version_compare($version, $release['minimumVersion'], '<')) return false;
        }
        return true;
    }
}
