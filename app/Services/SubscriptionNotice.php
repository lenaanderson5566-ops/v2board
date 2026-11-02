<?php

namespace App\Services;

use App\Protocols\ClashMeta;
use App\Protocols\Loon;
use App\Protocols\QuantumultX;
use App\Protocols\Shadowsocks;
use App\Protocols\Singbox;
use App\Protocols\Stash;
use App\Protocols\Surfboard;
use App\Protocols\Surge;
use App\Utils\Helper;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Yaml\Yaml;

/**
 * A closed, inert subscription document. This renderer intentionally accepts no
 * account, node list, template, or configuration; warning paths cannot inherit
 * credentials or remote providers from a normal configuration renderer.
 */
final class SubscriptionNotice
{
    public const HOST = '203.0.113.10';
    public const PORT = 61001;
    public const CREDENTIAL = '00000000-0000-4000-8000-000000000001';

    private const REASONS = [
        'no_plan', 'expired', 'traffic_exhausted', 'credits_expired',
        'credits_exhausted', 'no_available_nodes', 'banned', 'client_disabled',
        'client_version_too_low', 'subscription_changed', 'user_unavailable',
    ];

    public static function response(string $format, string $name, string $reason): Response
    {
        $format = SubscriptionClientRegistry::canonicalId($format);
        abort_unless($format !== null && $format !== 'fastai' && in_array($reason, self::REASONS, true), 422, 'Invalid subscription notice.');
        $name = self::label($name);
        $server = [
            'id'=>self::CREDENTIAL, 'name'=>$name, 'type'=>'shadowsocks', 'host'=>self::HOST,
            'port'=>self::PORT, 'cipher'=>'aes-128-gcm', 'network'=>'tcp', 'obfs'=>null,
        ];
        $handler = SubscriptionClientRegistry::handler($format);
        $contentType = 'text/plain; charset=UTF-8';

        if ($handler === Stash::class || is_a($handler, ClashMeta::class, true)) {
            $proxy = ClashMeta::buildShadowsocks(self::CREDENTIAL, $server);
            $body = Yaml::dump([
                'proxies'=>[$proxy],
                'proxy-groups'=>[['name'=>'NOTICE', 'type'=>'select', 'proxies'=>[$name]]],
                'rules'=>['MATCH,REJECT'],
            ], 8, 2, Yaml::DUMP_EMPTY_ARRAY_AS_SEQUENCE);
            $contentType = 'application/yaml; charset=UTF-8';
        } elseif ($handler === Singbox::class) {
            $proxy = [
                'type'=>'shadowsocks', 'tag'=>$name, 'server'=>self::HOST,
                'server_port'=>self::PORT, 'method'=>'aes-128-gcm', 'password'=>self::CREDENTIAL,
            ];
            $body = self::json([
                'log'=>['disabled'=>true], 'inbounds'=>[],
                'outbounds'=>[
                    ['type'=>'selector', 'tag'=>'NOTICE', 'outbounds'=>[$name], 'default'=>$name],
                    $proxy,
                ],
                // Keep the notice readable by older clients too: route only to
                // the inert node, without version-specific reject/block syntax.
                'route'=>['final'=>'NOTICE'],
            ]);
            $contentType = 'application/json; charset=UTF-8';
        } elseif ($handler === Shadowsocks::class) {
            $body = self::json([
                'version'=>1,
                'servers'=>[Shadowsocks::SIP008($server, ['uuid'=>self::CREDENTIAL])],
            ]);
            $contentType = 'application/json; charset=UTF-8';
        } elseif ($handler === Surge::class || $handler === Surfboard::class) {
            $line = $handler::buildShadowsocks(self::CREDENTIAL, $server);
            $body = "[General]\r\nloglevel=notify\r\n\r\n[Proxy]\r\n".$line
                ."\r\n[Proxy Group]\r\nNOTICE=select,".$name."\r\n\r\n[Rule]\r\nFINAL,REJECT\r\n";
        } elseif ($handler === Loon::class) {
            // Loon subscribes to a raw proxy list rather than a full rule file.
            $body = Loon::buildShadowsocks(self::CREDENTIAL, $server);
        } elseif ($handler === QuantumultX::class) {
            $body = base64_encode(QuantumultX::buildShadowsocks(self::CREDENTIAL, $server));
        } else {
            // The remaining registry families import a base64 URI list. Calling
            // handle() here would risk format-specific account/config metadata.
            $body = base64_encode(Helper::buildShadowsocksUri(self::CREDENTIAL, $server));
        }

        self::clearExportHeaders();
        return response($body, 200, [
            'Content-Type'=>$contentType, 'Cache-Control'=>'private, no-store',
            'X-Subscription-Notice'=>$reason, 'profile-update-interval'=>'1',
        ]);
    }

    public static function clearExportHeaders(): void
    {
        // Some legacy protocol renderers use PHP's global header() API. Discard
        // their account metadata when a rendered config loses authorization.
        if (headers_sent()) return;
        foreach (['subscription-userinfo', 'profile-update-interval', 'content-disposition', 'profile-title'] as $header) {
            header_remove($header);
        }
    }

    private static function json(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function label(string $name): string
    {
        // Labels also occupy unquoted INI/proxy-list fields. They must never
        // introduce another line, section, option, or URL into those formats.
        $name = preg_replace('~[a-z][a-z0-9+.-]*://[^\s]+~iu', '', $name) ?? '';
        $name = preg_replace('/[\x00-\x1f\x7f\x{2028}\x{2029},=\[\]#;"\x27]+/u', ' ', $name) ?? '';
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
        if ($name === '' || $name === '⚠') $name = 'Subscription unavailable';
        $name = mb_substr($name, 0, 200, 'UTF-8');
        return str_starts_with($name, '⚠') ? $name : '⚠ '.$name;
    }
}
