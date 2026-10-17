<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class ConfigSave extends FormRequest
{
    const RULES = [
        'subscription_ip_minute_limit' => 'integer|min:1|max:10000',
        'subscription_user_minute_limit' => 'integer|min:1|max:1000',
        'subscription_user_day_limit' => 'integer|min:1|max:100000',
        'subscription_ua_whitelist_enabled' => 'missing',
        'subscription_ua_whitelist' => 'missing',
        'fastai_enabled' => 'in:0,1',
        'fastai_entrypoints' => 'sometimes|array|max:16',
        'fastai_releases' => 'sometimes|array|max:32',
        'apple_account_url' => 'sometimes|required|string|url|max:2048',
        'apple_account_enable' => 'in:0,1',
        'apple_account_token' => 'nullable|string|max:256',
        'apple_account_share' => 'nullable|alpha_num|max:128',
        // deposit
        'deposit_bounus' => [
            'nullable',
            'array',
        ],
        // invite & commission
        'ticket_status' => 'in:0,1,2',
        'invite_force' => 'in:0,1',
        'invite_commission' => 'integer',
        'invite_gen_limit' => 'integer',
        'invite_registration_gb' => 'nullable|numeric|min:0|max:10000',
        'invite_credit_months' => 'nullable|integer|min:1|max:120',
        'invite_first_use_gb' => 'nullable|numeric|min:0|max:10000',
        'invite_never_expire' => 'in:0,1',
        'commission_first_time_enable' => 'in:0,1',
        'commission_auto_check_enable' => 'in:0,1',
        'commission_withdraw_limit' => 'nullable|numeric',
        'commission_withdraw_method' => 'nullable|array',
        'withdraw_close_enable' => 'in:0,1',
        'commission_distribution_enable' => 'in:0,1',
        'commission_distribution_l1' => 'nullable|numeric',
        'commission_distribution_l2' => 'nullable|numeric',
        'commission_distribution_l3' => 'nullable|numeric',
        // site
        'logo' => 'nullable|url',
        'force_https' => 'in:0,1',
        'stop_register' => 'in:0,1',
        'system_timezone' => 'string|timezone',
        'app_name' => '',
        'app_description' => '',
        'landing_style' => 'sometimes|required|in:original,minimal',
        'app_url' => 'nullable|url',
        'subscribe_url' => 'nullable',
        'subscribe_path' => 'nullable|regex:/^\\//',
        'try_out_enable' => 'in:0,1',
        'try_out_plan_id' => 'integer',
        'try_out_hour' => 'numeric',
        'tos_url' => 'nullable|url',
        'new_user_currency' => 'sometimes|required|in:CNY,USD',
        'currency' => 'sometimes|required|in:CNY',
        'currency_symbol' => 'sometimes|required|in:CNY',
        // subscribe
        'credit_base_group_id' => 'nullable|integer|min:1|exists:v2_server_group,id',
        'plan_change_enable' => 'in:0,1',
        'reset_traffic_method' => 'in:0,1,2,3,4',
        'surplus_enable' => 'in:0,1',
        'allow_new_period' => 'in:0,1',
        'new_order_event_id' => 'in:0,1',
        'renew_order_event_id' => 'in:0,1',
        'change_order_event_id' => 'in:0,1',
        'show_info_to_server_enable' => 'in:0,1',
        'show_subscribe_method' => 'in:0,1,2',
        'show_subscribe_expire' => 'nullable|integer|min:1',
        // server
        'server_api_url' => 'nullable|url|regex:~^https://[^/?#\s@]+(?:/[^?#\s]*)?$~',
        'server_token' => 'nullable|min:16',
        'server_pull_interval' => 'integer',
        'server_push_interval' => 'integer',
        'device_limit_mode' => 'in:0,1',
        'server_node_report_min_traffic' => 'integer', 
        'server_device_online_min_traffic' => 'integer', 
        // Custom footer is independent of any frontend theme.
        'custom_footer_html' => 'nullable|string',
        // email
        'email_provider' => 'in:smtp,mailgun,ses,resend',
        'email_resend_api_key' => 'nullable|string|max:256|regex:/^re_[A-Za-z0-9_-]+$/D',
        'email_ses_region' => ['string', 'max:32', 'regex:/^(us|eu|ap|ca|sa|me|af|il|mx)-(?:[a-z]+-)?[a-z]+-[1-9]$/D'],
        'email_ses_auth' => 'in:role,key',
        'email_ses_access_key' => 'nullable|string|regex:/^AKIA[A-Z0-9]{16}$/D',
        'email_ses_secret_key' => 'nullable|string|max:128|regex:/^[A-Za-z0-9+\/=]+$/D',
        'email_ses_configuration_set' => 'nullable|string|max:64|regex:/^[A-Za-z0-9_-]+$/D',
        'email_mailgun_region' => 'in:us,eu',
        'email_mailgun_domain' => 'nullable|string|max:253|regex:/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/D',
        'email_mailgun_api_key' => 'nullable|string|max:256|regex:/^[A-Za-z0-9_-]+$/D',
        'email_template' => '',
        'email_default_language' => 'in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR,es-ES,pt-BR',
        'email_send_interval' => 'integer|min:1|max:3600',
        'email_bulk_interval' => 'integer|min:1|max:3600',
        'email_domain_interval' => 'integer|min:1|max:3600',
        'email_host' => '',
        'email_port' => '',
        'email_username' => '',
        'email_password' => 'nullable|string|max:512',
        'email_encryption' => '',
        'email_from_address' => '',
        // telegram
        'telegram_bot_enable' => 'in:0,1',
        'telegram_bot_token' => '',
        'telegram_discuss_id' => 'nullable|regex:/^-[1-9][0-9]{0,15}$/D',
        'telegram_group_policy_enable' => 'in:0,1',
        'telegram_group_grace_days' => 'integer|min:0|max:30',
        'telegram_channel_id' => '',
        'telegram_discuss_link' => 'nullable|url',
        'client_primary_android' => 'nullable|in:cmfa,singbox,flclash',
        'client_secondary_android' => 'nullable|in:cmfa,singbox,flclash',
        'client_primary_windows' => 'nullable|in:clash,singbox,flclash',
        'client_secondary_windows' => 'nullable|in:clash,singbox,flclash',
        'client_primary_macos' => 'nullable|in:clash,singbox,flclash,shadowrocket,surge,stash',
        'client_secondary_macos' => 'nullable|in:clash,singbox,flclash,shadowrocket,surge,stash',
        'client_primary_linux' => 'nullable|in:clash,singbox,flclash',
        'client_secondary_linux' => 'nullable|in:clash,singbox,flclash',
        'client_primary_ios' => 'nullable|in:shadowrocket,singbox,surge,quantumult,stash',
        'client_secondary_ios' => 'nullable|in:shadowrocket,singbox,surge,quantumult,stash',
        // app
        'windows_version' => '',
        'windows_download_url' => '',
        'macos_version' => '',
        'macos_download_url' => '',
        'android_version' => '',
        'android_download_url' => '',
        // safe
        'email_whitelist_enable' => 'in:0,1',
        'email_whitelist_suffix' => 'nullable|array',
        'email_gmail_limit_enable' => 'in:0,1',
        'recaptcha_enable' => 'in:0,1',
        'recaptcha_key' => '',
        'recaptcha_site_key' => '',
        'email_verify' => 'in:0,1',
        'safe_mode_enable' => 'in:0,1',
        'register_limit_by_ip_enable' => 'in:0,1',
        'register_limit_count' => 'integer',
        'register_limit_expire' => 'integer',
        'secure_path' => 'min:8|regex:/^[\w-]*$/',
        'password_limit_enable' => 'in:0,1',
        'password_limit_count' => 'integer',
        'password_limit_expire' => 'integer',
    ];
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function withValidator($validator) {
        $validator->after(function ($validator) {
            if ($this->input('telegram_group_policy_enable',config('v2board.telegram_group_policy_enable',0)) &&
                (!$this->input('telegram_bot_enable',config('v2board.telegram_bot_enable',0)) || (int)$this->input('telegram_discuss_id',config('v2board.telegram_discuss_id',0))>=0)) {
                $validator->errors()->add('telegram_group_policy_enable','请先启用 Telegram 机器人，并填写有效的负数群 ID。');
            }
            if ($this->has('system_timezone') && !\App\Services\TimeZones::valid($this->input('system_timezone'))) $validator->errors()->add('system_timezone','请选择有效的 IANA 时区。');
            $registration = $this->input('invite_registration_gb', config('v2board.invite_registration_gb', 0));
            $usage = $this->input('invite_first_use_gb', config('v2board.invite_first_use_gb', 0));
            $group = $this->input('credit_base_group_id', config('v2board.credit_base_group_id'));
            if (((float)$registration > 0 || (float)$usage > 0) && (!$group || !\App\Models\ServerGroup::where('id', $group)->exists()))
                $validator->errors()->add('invite_registration_gb', '请先在订阅设置中配置有效的额度基础权限组，再启用邀请流量奖励。');
        });
    }

    public static function allRules(): array
    {
        $rules=self::RULES;
        foreach (\App\Services\MailChannel::FIELDS as $field) if (isset($rules['email_'.$field])) $rules['email_announcement_'.$field]=$rules['email_'.$field];
        $rules['email_public_url']='nullable|string|max:2048|url|regex:~^https://[^/?#@]+/?$~iD';
        $rules['email_announcement_separate']='in:0,1';
        $rules['email_announcements_enabled']='in:0,1';
        $rules['email_mailgun_webhook_key']='nullable|string|max:256|regex:/^[A-Za-z0-9_-]+$/D';
        $rules['email_resend_webhook_key']='nullable|string|max:256|regex:/^whsec_[A-Za-z0-9+\/=]+$/D';
        $rules['email_ses_topic_arn']='nullable|string|max:256|regex:/^arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+$/D';
        return $rules;
    }
    public function rules()
    {
        $rules = self::allRules();

        $rules['deposit_bounus'][] = function ($attribute, $value, $fail) {
            foreach ($value as $tier) {
                if (!preg_match('/^\d+(\.\d+)?:\d+(\.\d+)?$/', $tier)) {
                    if($tier == '') {
                        continue;
                    }
                    $fail('充值奖励格式不正确，必须为充值金额:奖励金额');
                }
            }
        };
        return $rules;
    }

    public function messages()
    {
        // illiteracy prompt
        return [
            'subscription_ua_whitelist_enabled.missing' => '白名单已合并，请在客户端策略中设置「允许订阅访问」。',
            'subscription_ua_whitelist.missing' => '白名单已合并，请在客户端策略中设置「允许订阅访问」。',
            'app_url.url' => '站点URL格式不正确，必须携带http(s)://',
            'server_api_url.regex' => '节点通讯地址必须使用 HTTPS，且不能包含账号、查询参数或片段。',
            'server_api_url.url' => '节点通讯地址必须是有效的 HTTPS 地址。',
            'subscribe_url.url' => '订阅URL格式不正确，必须携带http(s)://',
            'subscribe_path.regex' => '订阅路径必须以/开头',
            'server_token.min' => '通讯密钥长度必须大于16位',
            'tos_url.url' => '服务条款URL格式不正确，必须携带http(s)://',
            'telegram_discuss_link.url' => 'Telegram群组地址必须为URL格式，必须携带http(s)://',
            'logo.url' => 'LOGO URL格式不正确，必须携带https(s)://',
            'secure_path.min' => '后台路径长度最小为8位',
            'secure_path.regex' => '后台路径只能为字母或数字',
        ];
    }
}
