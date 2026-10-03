<?php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class AppleAccountService
{
    // Explicit upstream allowlist: never send this credential to arbitrary hosts or redirects.
    public const ORIGIN = 'https://account.fastdog66.com';

    private function get(string $path, array $query = []): array
    {
        $token = (string) config('v2board.apple_account_token', '');
        abort_if($token === '', 503, 'Apple account service is not configured.');
        try {
            $response = Http::withHeaders(['X-API-Key' => $token])->acceptJson()
                ->timeout(8)->withOptions(['connect_timeout' => 3, 'allow_redirects' => false])
                ->get(self::ORIGIN.$path, $query);
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
