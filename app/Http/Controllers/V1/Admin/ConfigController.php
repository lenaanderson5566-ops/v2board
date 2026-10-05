<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ConfigSave;
use App\Jobs\SendEmailJob;
use App\Services\TelegramService;
use App\Utils\Dict;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Cache;

class ConfigController extends Controller
{
    public function getEmailTemplate()
    {
        $path = resource_path('views/mail/');
        $files = array_map(function ($item) use ($path) {
            return str_replace($path, '', $item);
        }, glob($path . '*'));
        return response([
            'data' => $files
        ]);
    }

    public function previewMail(Request $request)
    {
        $request->validate([
            'template' => 'required|in:' . implode(',', \App\Services\ProductMail::TYPES),
            'language' => 'required|in:' . implode(',', \App\Services\LanguagePreferenceService::SUPPORTED),
            'subject' => 'nullable|string|max:200', 'content' => 'nullable|string|max:100000',
        ]);
        $data = app(\App\Services\ProductMail::class)->data([
            'template_name'=>$request->input('template'), 'language'=>$request->input('language'),
            'subject'=>$request->input('subject') ?: 'Preview',
            'template_value'=>['code'=>'123456', 'url'=>config('v2board.app_url'),
                'content'=>$request->input('content', ''), 'ticket_id'=>12345],
        ]);
        return response(['data'=>['subject'=>$data['subject'],
            'html'=>view('mail.product.message', $data)->render(),
            'text'=>view('mail.product.text', $data)->render()]]);
    }

    public function testSendMail(Request $request)
    {
        $obj = new SendEmailJob([
            'email' => $request->user['email'], 'template_name' => 'test',
            'template_value' => ['url' => config('v2board.app_url')]
        ]);
        $result = $obj->handle();
        return response(['data'=>empty($result['error']), 'log'=>$result]);
    }

    public function setTelegramWebhook(Request $request)
    {
        $hookUrl = secure_url('/api/v10/webhooks/telegram');
        $telegramService = new TelegramService($request->input('telegram_bot_token'));
        $telegramService->getMe();
        $telegramService->setWebhook($hookUrl);
        return response([
            'data' => true
        ]);
    }

    public function fetch(Request $request)
    {
        $key = $request->input('key');
        $data = [
            'ticket' => [
                'ticket_status' => config('v2board.ticket_status', 0)
            ],
            'deposit' => [
                'deposit_bounus' => config('v2board.deposit_bounus', [])
            ],
            'invite' => [
                'invite_force' => (int)config('v2board.invite_force', 0),
                'invite_commission' => config('v2board.invite_commission', 10),
                'invite_registration_gb' => config('v2board.invite_registration_gb', 0),
                'invite_credit_months' => max(1, (int)config('v2board.invite_credit_months', 1)),
                'invite_first_use_gb' => config('v2board.invite_first_use_gb', 0),
                'invite_gen_limit' => config('v2board.invite_gen_limit', 5),
                'invite_never_expire' => config('v2board.invite_never_expire', 0),
                'commission_first_time_enable' => config('v2board.commission_first_time_enable', 1),
                'commission_auto_check_enable' => config('v2board.commission_auto_check_enable', 1),
                'commission_withdraw_limit' => config('v2board.commission_withdraw_limit', 100),
                'commission_withdraw_method' => config('v2board.commission_withdraw_method', Dict::WITHDRAW_METHOD_WHITELIST_DEFAULT),
                'withdraw_close_enable' => config('v2board.withdraw_close_enable', 0),
                'commission_distribution_enable' => config('v2board.commission_distribution_enable', 0),
                'commission_distribution_l1' => config('v2board.commission_distribution_l1'),
                'commission_distribution_l2' => config('v2board.commission_distribution_l2'),
                'commission_distribution_l3' => config('v2board.commission_distribution_l3')
            ],
            'site' => [
                'logo' => config('v2board.logo'),
                'force_https' => (int)config('v2board.force_https', 0),
                'stop_register' => (int)config('v2board.stop_register', 0),
                'app_name' => config('v2board.app_name', 'V2Board'),
                'app_description' => config('v2board.app_description', 'V2Board is best!'),
                'app_url' => config('v2board.app_url'),
                'subscribe_url' => config('v2board.subscribe_url'),
                'subscribe_path' => config('v2board.subscribe_path'),
                'try_out_plan_id' => (int)config('v2board.try_out_plan_id', 0),
                'try_out_hour' => (int)config('v2board.try_out_hour', 1),
                'tos_url' => config('v2board.tos_url'),
                'currency' => config('v2board.currency', 'CNY'),
                'currency_symbol' => config('v2board.currency_symbol', '¥'),
            ],
            'subscribe' => [
                'credit_base_group_id' => config('v2board.credit_base_group_id'),
                'plan_change_enable' => (int)config('v2board.plan_change_enable', 1),
                'reset_traffic_method' => (int)config('v2board.reset_traffic_method', 0),
                'surplus_enable' => (int)config('v2board.surplus_enable', 1),
                'allow_new_period' => (int)config('v2board.allow_new_period', 0),
                'new_order_event_id' => (int)config('v2board.new_order_event_id', 0),
                'renew_order_event_id' => (int)config('v2board.renew_order_event_id', 0),
                'change_order_event_id' => (int)config('v2board.change_order_event_id', 0),
                'show_info_to_server_enable' => (int)config('v2board.show_info_to_server_enable', 0),
                'show_subscribe_method' => (int)config('v2board.show_subscribe_method', 0),
                'show_subscribe_expire' => (int)config('v2board.show_subscribe_expire', 5),
            ],
            'footer' => [
                'custom_footer_html' => \App\Support\FrontendConfig::footer(),
            ],
            'server' => [
                'server_api_url' => config('v2board.server_api_url'),
                'server_token' => config('v2board.server_token'),
                'server_pull_interval' => config('v2board.server_pull_interval', 60),
                'server_push_interval' => config('v2board.server_push_interval', 60),
                'server_node_report_min_traffic' => config('v2board.server_node_report_min_traffic', 0),
                'server_device_online_min_traffic' => config('v2board.server_device_online_min_traffic', 0),
                'device_limit_mode' => config('v2board.device_limit_mode', 0)
            ],
            'email' => [
                'email_template' => config('v2board.email_template', 'default'),
                'email_host' => config('v2board.email_host'),
                'email_port' => config('v2board.email_port'),
                'email_username' => config('v2board.email_username'),
                'email_password' => config('v2board.email_password'),
                'email_encryption' => config('v2board.email_encryption'),
                'email_from_address' => config('v2board.email_from_address'),
                'email_default_language' => config('v2board.email_default_language', 'zh-CN'),
                'email_send_interval' => (int)config('v2board.email_send_interval', 2),
                'email_bulk_interval' => (int)config('v2board.email_bulk_interval', 10),
                'email_domain_interval' => (int)config('v2board.email_domain_interval', 30)
            ],
            'telegram' => [
                'telegram_bot_enable' => config('v2board.telegram_bot_enable', 0),
                'telegram_bot_token' => config('v2board.telegram_bot_token'),
                'telegram_discuss_link' => config('v2board.telegram_discuss_link')
            ],
            'app' => [
                'client_primary_android' => config('v2board.client_primary_android', ''),
                'client_secondary_android' => config('v2board.client_secondary_android', ''),
                'client_primary_windows' => config('v2board.client_primary_windows', ''),
                'client_secondary_windows' => config('v2board.client_secondary_windows', ''),
                'client_primary_macos' => config('v2board.client_primary_macos', ''),
                'client_secondary_macos' => config('v2board.client_secondary_macos', ''),
                'client_primary_linux' => config('v2board.client_primary_linux', ''),
                'client_secondary_linux' => config('v2board.client_secondary_linux', ''),
                'client_primary_ios' => config('v2board.client_primary_ios', ''),
                'client_secondary_ios' => config('v2board.client_secondary_ios', ''),
                'apple_account_url' => config('v2board.apple_account_url', \App\Services\AppleAccountService::ORIGIN),
                'apple_account_enable' => (int) config('v2board.apple_account_enable', 0),
                'apple_account_token' => '',
                'apple_account_share' => config('v2board.apple_account_share', ''),
                'windows_version' => config('v2board.windows_version'),
                'windows_download_url' => config('v2board.windows_download_url'),
                'macos_version' => config('v2board.macos_version'),
                'macos_download_url' => config('v2board.macos_download_url'),
                'android_version' => config('v2board.android_version'),
                'android_download_url' => config('v2board.android_download_url')
            ],
            'safe' => [
                'email_verify' => (int)config('v2board.email_verify', 0),
                'safe_mode_enable' => (int)config('v2board.safe_mode_enable', 0),
                'secure_path' => config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))),
                'email_whitelist_enable' => (int)config('v2board.email_whitelist_enable', 0),
                'email_whitelist_suffix' => config('v2board.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT),
                'email_gmail_limit_enable' => config('v2board.email_gmail_limit_enable', 0),
                'recaptcha_enable' => (int)config('v2board.recaptcha_enable', 0),
                'recaptcha_key' => config('v2board.recaptcha_key'),
                'recaptcha_site_key' => config('v2board.recaptcha_site_key'),
                'register_limit_by_ip_enable' => (int)config('v2board.register_limit_by_ip_enable', 0),
                'register_limit_count' => config('v2board.register_limit_count', 3),
                'register_limit_expire' => config('v2board.register_limit_expire', 60),
                'password_limit_enable' => (int)config('v2board.password_limit_enable', 1),
                'password_limit_count' => config('v2board.password_limit_count', 5),
                'password_limit_expire' => config('v2board.password_limit_expire', 60)
            ]
        ];
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

    public function save(ConfigSave $request)
    {
        $data = $request->validated();
        if (isset($data['apple_account_url'])) {
            try { $data['apple_account_url'] = \App\Services\AppleAccountService::normalizeOrigin($data['apple_account_url']); }
            catch (\InvalidArgumentException $e) { throw \Illuminate\Validation\ValidationException::withMessages(['apple_account_url' => $e->getMessage()]); }
        }
        if (empty($data['apple_account_token'])) unset($data['apple_account_token']);
        $config = config('v2board');
        $config['custom_footer_html'] = \App\Support\FrontendConfig::footer();
        foreach (['frontend_theme', 'frontend_theme_sidebar', 'frontend_theme_header', 'frontend_theme_color', 'frontend_background_url'] as $legacyKey) {
            unset($config[$legacyKey]);
        }
        foreach (ConfigSave::RULES as $k => $v) {
            if (!in_array($k, array_keys(ConfigSave::RULES))) {
                unset($config[$k]);
                continue;
            }
            if (array_key_exists($k, $data)) {
                $config[$k] = $data[$k];
            }
        }
        $data = var_export($config, 1);
        if (!File::put(base_path() . '/config/v2board.php', "<?php\n return $data ;")) {
            abort(500, '修改失败');
        }
        if (function_exists('opcache_get_status') && opcache_get_status(false) !== false) {
            if (opcache_reset() === false) {
                abort(500, '缓存清除失败，请卸载或检查opcache配置状态');
            }
        }
        Artisan::call('config:cache');
        if(Cache::has('WEBMANPID')) {
            $pid = Cache::get('WEBMANPID');
            Cache::forget('WEBMANPID');
            return response([
                'data' => posix_kill($pid, 15)
            ]);
        }
        return response([
            'data' => true
        ]);
    }
}
