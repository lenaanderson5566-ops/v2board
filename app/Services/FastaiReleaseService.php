<?php

namespace App\Services;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class FastaiReleaseService
{
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
        $catalog = config('v2board.fastai_releases', []);
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
        $catalog = config('v2board.fastai_releases', []);
        self::validateCatalog($catalog);
        foreach ($catalog as $release) {
            if ($release['platform'] === $platform && version_compare($version, $release['minimumVersion'], '<')) return false;
        }
        return true;
    }
}
