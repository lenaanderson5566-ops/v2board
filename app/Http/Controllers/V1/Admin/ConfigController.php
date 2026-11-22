<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ConfigSave;
use App\Jobs\SendEmailJob;
use App\Services\Mail\MailSettings;
use App\Services\Settings\SiteSettings;
use App\Services\TelegramService;
use App\Support\AdminPath;
use App\Utils\Dict;
use Illuminate\Http\Request;

class ConfigController extends Controller
{
    public function previewMail(Request $request)
    {
        $request->validate([
            'template' => 'required|in:' . implode(',', \App\Services\Mail\ProductMail::TYPES),
            'language' => 'required|in:' . implode(',', \App\Services\LanguagePreferenceService::SUPPORTED),
            'subject' => 'nullable|string|max:200', 'content' => 'nullable|string|max:100000',
        ]);
        $data = app(\App\Services\Mail\ProductMail::class)->data([
            'template_name'=>$request->input('template'), 'language'=>$request->input('language'),
            'subject'=>$request->input('subject') ?: 'Preview',
            'template_value'=>['code'=>'123456', 'url'=>config('fastai.app_url'),
                'content'=>$request->input('content', ''), 'ticket_id'=>12345],
        ]);
        return response(['data'=>['subject'=>$data['subject'],
            'html'=>view('mail.product.message', $data)->render(),
            'text'=>view('mail.product.text', $data)->render()]]);
    }

    public function testSendMail(Request $request)
    {
        $request->validate(['stream'=>'nullable|in:transactional,announcement']);
        abort_if($request->input('stream')==='announcement' && !config('fastai.email_announcement_separate'),422,'尚未启用公告独立通道。');
        $obj = new SendEmailJob([
            'test_stream'=>$request->input('stream','transactional'),
            'email' => $request->user['email'], 'template_name' => 'test',
            'template_value' => ['url' => config('fastai.app_url')]
        ]);
        $result = $obj->handle();
        if (!empty($result['skipped'])) $result += ['error'=>'MAIL_TEST_SKIPPED','advice'=>'当前管理员邮箱被限制发送，请在人工禁发名单或邮件抑制名单核查；本次未发送邮件。'];
        return response(['data'=>empty($result['error']), 'log'=>$result]);
    }

    public function setTelegramWebhook(Request $request)
    {
        $telegramService = new TelegramService($request->input('telegram_bot_token'));
        $telegramService->getMe();
        $telegramService->setWebhook();
        return response([
            'data' => true
        ]);
    }

    public function fetch(Request $request)
    {
        $key = $request->input('key');
        $siteSettings = \App\Support\SiteConfiguration::read();
        $releases = $siteSettings === null
            ? config('fastai.fastai_releases', [])
            : ($siteSettings['fastai_releases'] ?? []);
        $data = [
            'ticket' => [
                'ticket_status' => config('fastai.ticket_status', 0)
            ],
            'deposit' => [
                'deposit_bounus' => config('fastai.deposit_bounus', [])
            ],
            'invite' => [
                'invite_force' => (int)config('fastai.invite_force', 0),
                'invite_commission' => config('fastai.invite_commission', 10),
                'invite_registration_gb' => config('fastai.invite_registration_gb', 0),
                'invite_credit_months' => max(1, (int)config('fastai.invite_credit_months', 1)),
                'invite_first_use_gb' => config('fastai.invite_first_use_gb', 0),
                'invite_gen_limit' => config('fastai.invite_gen_limit', 5),
                'invite_never_expire' => config('fastai.invite_never_expire', 0),
                'commission_first_time_enable' => config('fastai.commission_first_time_enable', 1),
                'commission_auto_check_enable' => config('fastai.commission_auto_check_enable', 1),
                'commission_withdraw_limit' => config('fastai.commission_withdraw_limit', 100),
                'commission_withdraw_method' => config('fastai.commission_withdraw_method', Dict::WITHDRAW_METHOD_WHITELIST_DEFAULT),
                'withdraw_close_enable' => config('fastai.withdraw_close_enable', 0),
            ],
            'site' => [
                'system_timezone' => \App\Services\TimeZones::system(),
                'logo' => config('fastai.logo'),
                'force_https' => (int)config('fastai.force_https', 0),
                'stop_register' => (int)config('fastai.stop_register', 0),
                'app_name' => \App\Support\Branding::name(config('fastai.app_name', config('app.name', 'FastAI'))),
                'landing_style' => config('fastai.landing_style', 'original'),
                'app_description' => config('fastai.app_description', 'FastAI configuration and account management.'),
                'app_url' => config('fastai.app_url'),
                'subscribe_url' => config('fastai.subscribe_url'),
                'subscribe_path' => config('fastai.subscribe_path'),
                'try_out_plan_id' => (int)config('fastai.try_out_plan_id', 0),
                'try_out_hour' => (int)config('fastai.try_out_hour', 1),
                'tos_url' => config('fastai.tos_url'),
                'new_user_currency' => config('fastai.new_user_currency','CNY'),
                'currency' => \App\Services\Money::CURRENCY,
                'currency_symbol' => \App\Services\Money::CURRENCY,
            ],
            'subscribe' => [
                'credit_base_group_id' => config('fastai.credit_base_group_id'),
                'plan_change_enable' => (int)config('fastai.plan_change_enable', 1),
                'reset_traffic_method' => (int)config('fastai.reset_traffic_method', 0),
                'surplus_enable' => (int)config('fastai.surplus_enable', 1),
                'new_order_event_id' => (int)config('fastai.new_order_event_id', 0),
                'renew_order_event_id' => (int)config('fastai.renew_order_event_id', 0),
                'change_order_event_id' => (int)config('fastai.change_order_event_id', 0),
                'show_info_to_server_enable' => (int)config('fastai.show_info_to_server_enable', 0),
                'show_subscribe_method' => (int)config('fastai.show_subscribe_method', 0),
                'show_subscribe_expire' => (int)config('fastai.show_subscribe_expire', 5),
            ],
            'footer' => [
                'custom_footer_html' => \App\Support\FrontendConfig::footer(),
            ],
            'server' => [
                'server_api_url' => config('fastai.server_api_url'),
                'server_token' => config('fastai.server_token'),
                'server_pull_interval' => config('fastai.server_pull_interval', 60),
                'server_push_interval' => config('fastai.server_push_interval', 60),
                'server_node_report_min_traffic' => config('fastai.server_node_report_min_traffic', 0),
                'server_device_online_min_traffic' => config('fastai.server_device_online_min_traffic', 0),
                'device_limit_mode' => config('fastai.device_limit_mode', 0)
            ],
            'email' => MailSettings::forAdmin(),
            'telegram' => [
                'telegram_bot_enable' => config('fastai.telegram_bot_enable', 0),
                'telegram_bot_token' => config('fastai.telegram_bot_token'),
                'telegram_discuss_id' => config('fastai.telegram_discuss_id'),
                'telegram_group_policy_enable' => (int)config('fastai.telegram_group_policy_enable',0),
                'telegram_group_grace_days' => (int)config('fastai.telegram_group_grace_days',3),
            ],
            'entrypoints' => [
                'fastai_entrypoints' => config('fastai.fastai_entrypoints', []),
                'fastai_entrypoints_version' => config('fastai.fastai_entrypoints_version', 1),
                'fastai_entrypoint_public_key' => app(\App\Services\FastaiEntrypoints::class)->publicKey(),
            ],
            'app' => [
                'subscription_ip_minute_limit' => (int) config('fastai.subscription_ip_minute_limit', 120),
                'subscription_user_minute_limit' => (int) config('fastai.subscription_user_minute_limit', 30),
                'subscription_user_day_limit' => (int) config('fastai.subscription_user_day_limit', 240),
                'fastai_enabled' => config('fastai.fastai_enabled', 1),
                'fastai_releases' => $releases,
                'fastai_releases_revision' => \App\Services\FastaiReleaseService::catalogRevision($releases),
                'fastai_release_targets' => \App\Services\FastaiReleaseService::PUBLISH_TARGETS,
                'client_primary_ios' => config('fastai.client_primary_ios', ''),
                'client_primary_android' => config('fastai.client_primary_android', ''),
                'client_secondary_android' => config('fastai.client_secondary_android', ''),
                'client_primary_windows' => config('fastai.client_primary_windows', ''),
                'client_secondary_windows' => config('fastai.client_secondary_windows', ''),
                'client_primary_macos' => config('fastai.client_primary_macos', ''),
                'client_secondary_macos' => config('fastai.client_secondary_macos', ''),
                'client_primary_linux' => config('fastai.client_primary_linux', ''),
                'client_secondary_linux' => config('fastai.client_secondary_linux', ''),
                'client_secondary_ios' => config('fastai.client_secondary_ios', ''),
                'apple_account_url' => config('fastai.apple_account_url', \App\Services\AppleAccountService::ORIGIN),
                'apple_account_enable' => (int) config('fastai.apple_account_enable', 0),
                'apple_account_token' => '',
                'apple_account_share' => config('fastai.apple_account_share', ''),
            ],
            'safe' => [
                'browser_policy_wechat' => \App\Services\BrowserAccess::policies()['wechat'],
                'browser_policy_qq' => \App\Services\BrowserAccess::policies()['qq'],
                'browser_policy_weibo' => \App\Services\BrowserAccess::policies()['weibo'],
                'browser_policy_xiaohongshu' => \App\Services\BrowserAccess::policies()['xiaohongshu'],
                'browser_policy_douyin' => \App\Services\BrowserAccess::policies()['douyin'],
                'browser_policy_bilibili' => \App\Services\BrowserAccess::policies()['bilibili'],
                'browser_policy_alipay' => \App\Services\BrowserAccess::policies()['alipay'],
                'browser_policy_dingtalk' => \App\Services\BrowserAccess::policies()['dingtalk'],
                'browser_policy_wecom' => \App\Services\BrowserAccess::policies()['wecom'],
                'browser_policy_other' => \App\Services\BrowserAccess::policies()['other'],
                'account_deletion_enable' => (int)config('fastai.account_deletion_enable',0),
                'passkey_enable' => (int)config('fastai.passkey_enable',0),
                'mfa_enable' => (int)config('fastai.mfa_enable',0),
                'email_verify' => (int)config('fastai.email_verify', 0),
                'safe_mode_enable' => (int)config('fastai.safe_mode_enable', 0),
                'secure_path' => AdminPath::resolve(),
                'email_whitelist_enable' => (int)config('fastai.email_whitelist_enable', 0),
                'email_whitelist_suffix' => config('fastai.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT),
                'email_gmail_limit_enable' => config('fastai.email_gmail_limit_enable', 0),
                'register_limit_by_ip_enable' => (int)config('fastai.register_limit_by_ip_enable', 0),
                'register_limit_count' => config('fastai.register_limit_count', 3),
                'register_limit_expire' => config('fastai.register_limit_expire', 60),
                'password_limit_enable' => (int)config('fastai.password_limit_enable', 1),
                'password_limit_count' => config('fastai.password_limit_count', 5),
                'password_limit_expire' => config('fastai.password_limit_expire', 60)
            ]
        ];
        if ($key === 'app' || !$key || !isset($data[$key])) {
            $data['app']['fastai_release_min_version'] = \App\Services\FastaiReleaseService::globalMinimum();
        }
        if ($key && isset($data[$key])) {
            return response([
                'data' => [
                    $key => $data[$key]
                ]
            ]);
        };
        // TODO: default should be in Dict
        return response([
            'data' => $data
        ]);
    }

    public function testAppleAccount(\App\Services\AppleAccountService $service)
    {
        $accounts = array_filter($service->accounts(), fn($account) => $account['available']);
        abort_if(count($accounts) === 0, 503, '连接成功，但分享页暂无检查正常的可用账号。');
        return response(['data' => ['available' => count($accounts)]])->header('Cache-Control', 'no-store');
    }

    public function testFastaiEntrypoint(\Illuminate\Http\Request $request)
    {
        $data=$request->validate(['origin'=>'required|string|max:253']);
        return response()->json(['data'=>app(\App\Services\FastaiEntrypoints::class)->check($data['origin'])]);
    }

    public function save(ConfigSave $request)
    {
        SiteSettings::save($request->validated(), array_keys(ConfigSave::allRules()));
        return response(['data' => true]);
    }
}
