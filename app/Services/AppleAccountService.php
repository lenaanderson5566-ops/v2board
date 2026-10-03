<?php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class AppleAccountService
{
    // Default preserves existing deployments; administrators may configure another HTTPS origin.
    public const ORIGIN = 'https://account.fastdog66.com';

    public static function normalizeOrigin(string $value): string
    {
        $parts = parse_url(trim($value));
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
            || !in_array($parts['path'] ?? '', ['', '/'], true)
            || !filter_var($parts['host'], FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
            throw new \InvalidArgumentException('请输入 HTTPS 接口域名，不包含路径、账号或查询参数。');
        }
        return 'https://'.strtolower($parts['host']).(isset($parts['port']) ? ':'.$parts['port'] : '');
    }

    protected function resolveHost(string $host): array
    {
        return gethostbynamel($host) ?: [];
    }

    private function connection(): array
    {
        try {
            $origin = self::normalizeOrigin((string) config('v2board.apple_account_url', self::ORIGIN));
        } catch (\InvalidArgumentException $e) {
            abort(503, 'Invalid Apple account service URL.');
        }
        $host = parse_url($origin, PHP_URL_HOST);
        $port = parse_url($origin, PHP_URL_PORT) ?: 443;
        $addresses = $this->resolveHost($host);
        abort_if(!$addresses, 503, 'Apple account service DNS lookup failed.');
        foreach ($addresses as $ip) {
            abort_unless(filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE), 503, 'Apple account service requires a public address.');
        }
        // Pin the validated address, preventing a second DNS lookup or proxy from reaching an internal host.
        return [$origin, ['connect_timeout' => 3, 'allow_redirects' => false, 'proxy' => '',
            'curl' => [CURLOPT_RESOLVE => ["{$host}:{$port}:{$addresses[0]}"]]]];
    }

    private function get(string $path, array $query = []): array
    {
        $token = (string) config('v2board.apple_account_token', '');
        abort_if($token === '', 503, 'Apple account service is not configured.');
        [$origin, $options] = $this->connection();
        try {
            $response = Http::withHeaders(['X-API-Key' => $token])->acceptJson()
                ->timeout(8)->withOptions($options)
                ->get($origin.$path, $query);
        } catch (\Throwable $e) {
            abort(503, 'Apple account service connection failed. Please retry later.');
        }
        abort_unless($response->successful(), 503, 'Apple account service HTTP '.$response->status().'.');
        $body = $response->json();
        abort_unless(is_array($body) && ($body['ret'] ?? 0) == 1, 503, 'Apple account service rejected the request. Check API key and share page validity.');
        return is_array($body['data'] ?? null) ? $body['data'] : [];
    }

    public function accounts(): array
    {
        $code = trim((string) config('v2board.apple_account_share', ''));
        abort_if($code === '', 503, 'Apple account share page is not configured.');
        $pages = $this->get('/client/getAllSharepages');
        $page = collect($pages)->first(function ($page) use ($code) {
            return is_array($page) && ($page['share_link'] ?? null) === $code;
        });
        abort_unless($page && (int) ($page['id'] ?? 0) > 0, 503, 'Configured Apple account share page was not found.');
        $accounts = $this->get('/client/getShareAccounts', ['id' => (int) $page['id']]);
        $result = [];
        foreach ($accounts as $account) {
            if (!is_array($account) || (int) ($account['status'] ?? 0) !== 1 || !in_array($account['last_check_success'] ?? null, [true, 1, '1'], true)) continue;
            if (!is_string($account['username'] ?? null) || !is_string($account['password'] ?? null) || $account['username'] === '' || $account['password'] === '') continue;
            $result[] = array_intersect_key($account, array_flip(['username', 'password', 'region_display', 'last_check']));
        }
        return array_slice($result, 0, 20);
    }
}
