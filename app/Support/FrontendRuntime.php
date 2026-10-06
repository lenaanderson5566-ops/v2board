<?php
namespace App\Support;

final class FrontendRuntime
{
    public static function config(string $mode, ?bool $landing = null): array
    {
        if (!in_array($mode, ['user', 'admin'], true)) throw new \InvalidArgumentException('Invalid frontend mode');
        $securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
        $config = [
            'mode' => $mode,
            'landing' => $landing,
            'title' => config('v2board.app_name', 'V2Board'),
            'description' => $landing ? 'AI 应用配置助手，让设备配置更简单。' : config('v2board.app_description', '连接世界，轻松管理你的订阅。'),
            'adminPath' => $mode === 'admin' ? $securePath : '',
            'opsPath' => $mode === 'admin' ? config('v2board.ops_api_path', 'ops') : '',
            'clientRecommendations' => collect(['android','windows','macos','linux','ios'])->mapWithKeys(fn($os) => [$os => [config('v2board.client_primary_'.$os), config('v2board.client_secondary_'.$os)]])->all(),
            'clientPolicies' => $landing ? [] : (new \App\Services\ClientStrategyService())->frontendPolicies(),
            'clientMirrors' => (new \App\Services\ClientMirrorService())->urls(),
            'legacyDownloads' => [
                'windows' => config('v2board.windows_download_url', ''),
                'macos' => config('v2board.macos_download_url', ''),
                'android' => config('v2board.android_download_url', ''),
            ],
            'appleAccountEnabled' => (bool) config('v2board.apple_account_enable', 0),
            'emailVerify' => (bool) config('v2board.email_verify', 0),
            'registerClosed' => (bool) config('v2board.stop_register', 0),
            'creditAccessPolicy' => \App\Services\TrafficCreditService::baseGroupId() !== null,
            'inviteRequired' => (bool) config('v2board.invite_force', 0),
            'emailWhitelistEnabled' => (bool) config('v2board.email_whitelist_enable', 0),
            'emailWhitelistSuffixes' => config('v2board.email_whitelist_enable', 0) ? \App\Utils\Helper::emailSuffixes(config('v2board.email_whitelist_suffix', \App\Utils\Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT)) : [],
            'recaptchaSiteKey' => config('v2board.recaptcha_enable') ? (string) config('v2board.recaptcha_site_key', '') : '',
            'tosUrl' => (string) config('v2board.tos_url', ''),
            'currency' => \App\Services\Money::CURRENCY,
            'currencySymbol' => \App\Services\Money::CURRENCY,
        ];
        if ($landing === null) unset($config['landing']);
        if ($mode === 'user') $config['footerHtml'] = FrontendConfig::footer();
        return $config;
    }
}
