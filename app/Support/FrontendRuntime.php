<?php
namespace App\Support;

final class FrontendRuntime
{
    public static function config(string $mode, ?bool $landing = null): array
    {
        if (!in_array($mode, ['user', 'admin'], true)) throw new \InvalidArgumentException('Invalid frontend mode');
        $securePath = config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
        $config = [
            'mode' => $mode,
            'systemTimeZone' => \App\Services\TimeZones::system(),
            'timeZones' => \App\Services\TimeZones::all(),
            'landing' => $landing,
            'landingStyle' => config('fastai.landing_style') === 'minimal' ? 'minimal' : 'original',
            'title' => Branding::name(config('fastai.app_name', config('app.name', 'FastAI'))),
            'description' => $landing ? '提供 AI 应用配置、设备使用指引与技术支持。' : config('fastai.app_description', '查看订阅状态、管理账户与设备连接。'),
            'adminPath' => $mode === 'admin' ? $securePath : '',
            'opsPath' => $mode === 'admin' ? config('fastai.ops_api_path', 'ops') : '',
            'clientRecommendations' => collect(['android','windows','macos','linux','ios'])->mapWithKeys(fn($os) => [$os => [config('fastai.client_primary_'.$os), config('fastai.client_secondary_'.$os)]])->all(),
            'clientPolicies' => $landing ? [] : (new \App\Services\ClientStrategyService())->frontendPolicies(),
            'clientMirrors' => (new \App\Services\ClientMirrorService())->urls(),
            'fastaiDownloads' => (new \App\Services\FastaiReleaseService())->publicDownloads(),
            'legacyDownloads' => [
                'windows' => config('fastai.windows_download_url', ''),
                'macos' => config('fastai.macos_download_url', ''),
                'android' => config('fastai.android_download_url', ''),
            ],
            'appleAccountEnabled' => (bool) config('fastai.apple_account_enable', 0),
            'emailVerify' => (bool) config('fastai.email_verify', 0),
            'browserPolicies' => \App\Services\BrowserAccess::policies(),
            'passkeyEnabled' => app(\App\Services\PasskeyService::class)->enabled(),
            'registerClosed' => (bool) config('fastai.stop_register', 0),
            'creditAccessPolicy' => \App\Services\TrafficCreditService::baseGroupId() !== null,
            'inviteRequired' => (bool) config('fastai.invite_force', 0),
            'emailWhitelistEnabled' => (bool) config('fastai.email_whitelist_enable', 0),
            'emailWhitelistSuffixes' => config('fastai.email_whitelist_enable', 0) ? \App\Utils\Helper::emailSuffixes(config('fastai.email_whitelist_suffix', \App\Utils\Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT)) : [],
            'tosUrl' => (string) config('fastai.tos_url', ''),
            'currency' => \App\Services\Money::CURRENCY,
            'currencySymbol' => \App\Services\Money::CURRENCY,
        ];
        if ($landing === null) unset($config['landing']);
        if ($mode === 'user') $config['footerHtml'] = FrontendConfig::footer();
        return $config;
    }
}
