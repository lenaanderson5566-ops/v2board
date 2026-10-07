<?php
namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Cookie;

final class BrowserSession
{
    public function cookieName(string $scope): string
    {
        return (config('browser.secure') ? '__Host-' : '').'fastdog_'.$scope;
    }

    private function key(string $scope, string $id): string
    {
        return 'BROWSER_SESSION:'.$scope.':'.hash('sha256', $id);
    }

    public function load(Request $request, string $scope): array
    {
        $id = (string)$request->cookie($this->cookieName($scope), '');
        $record = preg_match('/^[a-f0-9]{64}$/D', $id) ? Cache::get($this->key($scope, $id)) : null;
        if (!$record || $record['expiresAt'] <= time()) return $this->fresh($scope);
        if ($record['credential'] && !AuthService::decryptAuthData($record['credential'])) {
            Cache::forget($this->key($scope, $id));
            return $this->fresh($scope);
        }
        return $record + ['id'=>$id, 'scope'=>$scope, 'changed'=>false];
    }

    private function fresh(string $scope, string $credential = ''): array
    {
        $expires = $credential ? AuthService::sessionReference($credential)['expiresAt'] : time()+600;
        return ['id'=>bin2hex(random_bytes(32)), 'scope'=>$scope, 'credential'=>$credential,
            'csrfToken'=>bin2hex(random_bytes(32)), 'expiresAt'=>$expires, 'changed'=>true];
    }

    public function rotate(array $previous, string $credential): array
    {
        Cache::forget($this->key($previous['scope'], $previous['id']));
        return $this->fresh($previous['scope'], $credential);
    }

    public function destroy(array $record): void
    {
        Cache::forget($this->key($record['scope'], $record['id']));
        $user = $record['credential'] ? AuthService::decryptAuthData($record['credential']) : null;
        if ($user) (new AuthService(\App\Models\User::findOrFail($user['id'])))->removeCurrentSession($record['credential']);
    }

    public function persist(array $record, $response): void
    {
        $idle = $record['credential'] ? config('browser.'.$record['scope'].'_idle_seconds') : 600;
        $ttl = max(1, min($idle, $record['expiresAt']-time()));
        Cache::put($this->key($record['scope'], $record['id']), array_diff_key($record, array_flip(['id','scope','changed'])), $ttl);
        if ($record['changed']) $response->headers->setCookie(new Cookie($this->cookieName($record['scope']), $record['id'], $record['credential'] ? $record['expiresAt'] : time()+$ttl, '/', null, (bool)config('browser.secure'), true, false, 'lax'));
        $response->headers->set('X-CSRF-Token', $record['csrfToken']);
        $response->headers->set('Cache-Control', 'private, no-store');
    }

    public function projection(array $record): array
    {
        return ['accountId'=>$record['credential'] ? AuthService::sessionReference($record['credential'])['userId'] : null, 'authenticated'=>(bool)$record['credential'], 'csrfToken'=>$record['csrfToken'],
            'expiresAt'=>$record['credential'] ? gmdate('Y-m-d\TH:i:s\Z', $record['expiresAt']) : null];
    }
}
