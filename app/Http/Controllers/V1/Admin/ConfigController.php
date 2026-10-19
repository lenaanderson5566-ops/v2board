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
            'template' => 'required|in:' . implode(',', \App\Services\Mail\ProductMail::TYPES),
            'language' => 'required|in:' . implode(',', \App\Services\LanguagePreferenceService::SUPPORTED),
            'subject' => 'nullable|string|max:200', 'content' => 'nullable|string|max:100000',
        ]);
        $data = app(\App\Services\Mail\ProductMail::class)->data([
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
        $request->validate(['stream'=>'nullable|in:transactional,announcement']);
        abort_if($request->input('stream')==='announcement' && !config('v2board.email_announcement_separate'),422,'尚未启用公告独立通道。');
        $obj = new SendEmailJob([
            'test_stream'=>$request->input('stream','transactional'),
            'email' => $request->user['email'], 'template_name' => 'test',
            'template_value' => ['url' => config('v2board.app_url')]
        ]);
        $result = $obj->handle();
        if (!empty($result['skipped'])) $result += ['error'=>'MAIL_TEST_SKIPPED','advice'=>'当前管理员邮箱被限制发送，请在人工禁发名单或邮件抑制名单核查；本次未发送邮件。'];
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
                'system_timezone' => \App\Services\TimeZones::system(),
                'logo' => config('v2board.logo'),
                'force_https' => (int)config('v2board.force_https', 0),
                'stop_register' => (int)config('v2board.stop_register', 0),
                'app_name' => config('v2board.app_name', 'V2Board'),
                'landing_style' => config('v2board.landing_style', 'original'),
                'app_description' => config('v2board.app_description', 'V2Board is best!'),
                'app_url' => config('v2board.app_url'),
                'subscribe_url' => config('v2board.subscribe_url'),
                'subscribe_path' => config('v2board.subscribe_path'),
                'try_out_plan_id' => (int)config('v2board.try_out_plan_id', 0),
                'try_out_hour' => (int)config('v2board.try_out_hour', 1),
                'tos_url' => config('v2board.tos_url'),
                'new_user_currency' => config('v2board.new_user_currency','CNY'),
                'currency' => \App\Services\Money::CURRENCY,
                'currency_symbol' => \App\Services\Money::CURRENCY,
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
                'email_provider' => config('v2board.email_provider', 'smtp'),
                'email_ses_region' => config('v2board.email_ses_region', 'us-east-1'),
                'email_ses_auth' => config('v2board.email_ses_auth', 'role'),
                'email_ses_configuration_set' => config('v2board.email_ses_configuration_set', ''),
                'email_ses_access_key' => '',
                'email_ses_secret_key' => '',
                'email_ses_key_configured' => (bool)config('v2board.email_ses_access_key') && (bool)config('v2board.email_ses_secret_key'),
                'email_resend_api_key' => '',
                'email_resend_key_configured' => (bool)config('v2board.email_resend_api_key'),
                'email_mailgun_region' => config('v2board.email_mailgun_region', 'us'),
                'email_mailgun_domain' => config('v2board.email_mailgun_domain', ''),
                'email_mailgun_api_key' => '',
                'email_mailgun_key_configured' => (bool)config('v2board.email_mailgun_api_key'),
                'email_template' => config('v2board.email_template', 'default'),
                'email_host' => config('v2board.email_host'),
                'email_port' => config('v2board.email_port'),
                'email_username' => config('v2board.email_username'),
                'email_password' => '',
                'email_smtp_key_configured' => (bool)config('v2board.email_password'),
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
                'telegram_discuss_id' => config('v2board.telegram_discuss_id'),
                'telegram_group_policy_enable' => (int)config('v2board.telegram_group_policy_enable',0),
                'telegram_group_grace_days' => (int)config('v2board.telegram_group_grace_days',3),
            ],
            'entrypoints' => [
                'fastai_entrypoints' => config('v2board.fastai_entrypoints', []),
                'fastai_entrypoints_version' => config('v2board.fastai_entrypoints_version', 1),
                'fastai_entrypoint_public_key' => app(\App\Services\FastaiEntrypoints::class)->publicKey(),
            ],
            'app' => [
                'subscription_ip_minute_limit' => (int) config('v2board.subscription_ip_minute_limit', 120),
                'subscription_user_minute_limit' => (int) config('v2board.subscription_user_minute_limit', 30),
                'subscription_user_day_limit' => (int) config('v2board.subscription_user_day_limit', 240),
                'fastai_enabled' => config('v2board.fastai_enabled', 1),
                'fastai_releases' => config('v2board.fastai_releases', []),
                'client_primary_ios' => config('v2board.client_primary_ios', ''),
                'client_primary_android' => config('v2board.client_primary_android', ''),
                'client_secondary_android' => config('v2board.client_secondary_android', ''),
                'client_primary_windows' => config('v2board.client_primary_windows', ''),
                'client_secondary_windows' => config('v2board.client_secondary_windows', ''),
                'client_primary_macos' => config('v2board.client_primary_macos', ''),
                'client_secondary_macos' => config('v2board.client_secondary_macos', ''),
                'client_primary_linux' => config('v2board.client_primary_linux', ''),
                'client_secondary_linux' => config('v2board.client_secondary_linux', ''),
                'client_secondary_ios' => config('v2board.client_secondary_ios', ''),
                'apple_account_url' => config('v2board.apple_account_url', \App\Services\AppleAccountService::ORIGIN),
                'apple_account_enable' => (int) config('v2board.apple_account_enable', 0),
                'apple_account_token' => '',
                'apple_account_share' => config('v2board.apple_account_share', ''),
            ],
            'safe' => [
                'passkey_enable' => (int)config('v2board.passkey_enable',0),
                'email_verify' => (int)config('v2board.email_verify', 0),
                'safe_mode_enable' => (int)config('v2board.safe_mode_enable', 0),
                'secure_path' => config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))),
                'email_whitelist_enable' => (int)config('v2board.email_whitelist_enable', 0),
                'email_whitelist_suffix' => config('v2board.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT),
                'email_gmail_limit_enable' => config('v2board.email_gmail_limit_enable', 0),
                'register_limit_by_ip_enable' => (int)config('v2board.register_limit_by_ip_enable', 0),
                'register_limit_count' => config('v2board.register_limit_count', 3),
                'register_limit_expire' => config('v2board.register_limit_expire', 60),
                'password_limit_enable' => (int)config('v2board.password_limit_enable', 1),
                'password_limit_count' => config('v2board.password_limit_count', 5),
                'password_limit_expire' => config('v2board.password_limit_expire', 60)
            ]
        ];
        $data['email']=array_merge($data['email'], \App\Services\Mail\MailChannel::settings());
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
        $data = $request->validated();
        if (!empty($data['passkey_enable'])) abort_unless(app(\App\Services\PasskeyService::class)->available(),409,'请先通过更新流程安装 Passkey 数据表和依赖。');
        if (!empty($data['passkey_enable'])) app(\App\Services\PasskeyService::class)->assertConfigured();
        if (($data['new_user_currency'] ?? null) === 'USD') {
            abort_unless(\App\Models\Plan::where('show',1)->whereNotNull('usd_prices')->get()->contains(fn($p)=>collect($p->usd_prices)->contains(fn($v)=>$v !== null)),422,'请先为至少一个在售套餐配置美元价格。');
            abort_unless(\App\Models\Payment::where('enable',1)->whereIn('payment',['EPay','Paytaro','PaytaroQR','StripeCheckout'])->exists(),422,'请先启用支付方式。');
            \App\Services\ExchangeRate::snapshot();
        }
        if (!empty($data['email_announcement_ses_access_key']) xor !empty($data['email_announcement_ses_secret_key'])) throw \Illuminate\Validation\ValidationException::withMessages(['email_announcement_ses_access_key'=>'公告通道的 AWS 密钥须成对填写。']);
        foreach (['password','mailgun_api_key','resend_api_key','ses_access_key','ses_secret_key'] as $field) {
            $key='email_announcement_'.$field;
            if (empty($data[$key])) unset($data[$key]);
            else $data[$key]=\Illuminate\Support\Facades\Crypt::encryptString($data[$key]);
        }
        if (isset($data['email_announcement_password'])) $data['email_announcement_password_encrypted']=true;
        foreach (['email_mailgun_webhook_key','email_resend_webhook_key'] as $key) {
            if (empty($data[$key])) unset($data[$key]);
            else $data[$key]=\Illuminate\Support\Facades\Crypt::encryptString($data[$key]);
        }
        $announcement=array_merge(config('v2board'),$data);
        if (!empty($announcement['email_announcement_separate'])) {
            $provider=$announcement['email_announcement_provider'] ?? 'smtp';
            $required=match($provider) { 'smtp'=>['host','port'], 'mailgun'=>['mailgun_domain','mailgun_api_key'], 'resend'=>['resend_api_key'], 'ses'=>['ses_region'], default=>['provider'] };
            if ($provider==='ses' && ($announcement['email_announcement_ses_auth'] ?? 'role')==='key') $required=array_merge($required,['ses_access_key','ses_secret_key']);
            foreach ($required as $field) if (empty($announcement['email_announcement_'.$field])) throw \Illuminate\Validation\ValidationException::withMessages(['email_announcement_'.$field=>'请完成公告独立通道配置。']);
            if (validator(['email'=>$announcement['email_announcement_from_address'] ?? null],['email'=>'required|email:rfc'])->fails()) throw \Illuminate\Validation\ValidationException::withMessages(['email_announcement_from_address'=>'请填写公告发件地址。']);
        }
        if (!empty($data['email_ses_access_key']) xor !empty($data['email_ses_secret_key'])) {
            throw \Illuminate\Validation\ValidationException::withMessages(['email_ses_access_key'=>'轮换 AWS 密钥时请同时填写 Access Key ID 和 Secret Access Key。']);
        }
        foreach (['email_password','email_mailgun_api_key','email_resend_api_key','email_ses_access_key','email_ses_secret_key'] as $secret) {
            if (empty($data[$secret])) unset($data[$secret]);
            else $data[$secret] = \Illuminate\Support\Facades\Crypt::encryptString($data[$secret]);
        }
        if (isset($data['email_password'])) $data['email_password_encrypted'] = true;
        $effective = array_merge(config('v2board'), $data);
        $provider = $effective['email_provider'] ?? 'smtp';
        if (in_array($provider, ['ses','resend'], true)) {
            $invalid = validator(['email'=>$effective['email_from_address'] ?? null], ['email'=>'required|email:rfc'])->fails();
            if ($provider === 'resend') $invalid = $invalid || empty($effective['email_resend_api_key']);
            if ($provider === 'ses' && ($effective['email_ses_auth'] ?? 'role') === 'key') $invalid = $invalid || empty($effective['email_ses_access_key']) || empty($effective['email_ses_secret_key']);
            if ($invalid) throw \Illuminate\Validation\ValidationException::withMessages(['email_provider'=>'请填写有效发件人邮箱及所选通道的必要凭据。']);
        }
        if (($data['email_provider'] ?? config('v2board.email_provider', 'smtp')) === 'mailgun') {
            $effective = array_merge(config('v2board'), $data);
            if (empty($effective['email_mailgun_domain']) || empty($effective['email_mailgun_api_key'])
                || validator(['email'=>$effective['email_from_address'] ?? null], ['email'=>'required|email:rfc'])->fails()) {
                throw \Illuminate\Validation\ValidationException::withMessages(['email_provider'=>'使用 Mailgun 前请填写发送域名、API Key 和有效发件人邮箱。']);
            }
        }
        $previousTimezone = \App\Services\TimeZones::system();
        if (isset($data['fastai_entrypoints'])) {
            $data['fastai_entrypoints'] = \App\Services\FastaiEntrypoints::validate($data['fastai_entrypoints']);
            app(\App\Services\FastaiEntrypoints::class)->requireVerified($data['fastai_entrypoints']);
        }
        if (isset($data['fastai_releases'])) {
            \App\Services\FastaiReleaseService::validateCatalog($data['fastai_releases']);
            foreach ($data['fastai_releases'] as $release) app(\App\Services\FastaiInstallerService::class)->validateRelease($release);
        }
        if (isset($data['apple_account_url'])) {
            try { $data['apple_account_url'] = \App\Services\AppleAccountService::normalizeOrigin($data['apple_account_url']); }
            catch (\InvalidArgumentException $e) { throw \Illuminate\Validation\ValidationException::withMessages(['apple_account_url' => $e->getMessage()]); }
        }
        if (empty($data['apple_account_token'])) unset($data['apple_account_token']);
        $config = config('v2board');
        $config['custom_footer_html'] = \App\Support\FrontendConfig::footer();
        foreach (['frontend_theme', 'frontend_theme_sidebar', 'frontend_theme_header', 'frontend_theme_color', 'frontend_background_url', 'recaptcha_enable', 'recaptcha_key', 'recaptcha_site_key', 'frontend_theme_google_analytics', 'google_analytics'] as $legacyKey) {
            unset($config[$legacyKey]);
        }
        foreach (ConfigSave::allRules() as $k => $v) {
            if (!in_array($k, array_keys(ConfigSave::allRules()))) {
                unset($config[$k]);
                continue;
            }
            if (array_key_exists($k, $data)) {
                $config[$k] = $data[$k];
            }
        }
        foreach (['email_password_encrypted','email_announcement_password_encrypted'] as $flag) if (isset($data[$flag])) $config[$flag]=$data[$flag];
        if (isset($data['fastai_entrypoints'])) $config['fastai_entrypoints_version'] = max((int)($config['fastai_entrypoints_version'] ?? 1)+1,(int)floor(microtime(true)*1000));
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
        if ($previousTimezone !== ($config['system_timezone'] ?? $previousTimezone)) {
            \Log::info('System business time zone changed', ['previous_timezone'=>$previousTimezone,'timezone'=>$config['system_timezone']]);
        }
        return response([
            'data' => true
        ]);
    }
}
