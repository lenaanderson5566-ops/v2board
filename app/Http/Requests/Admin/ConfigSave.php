<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class ConfigSave extends FormRequest
{
    const RULES = [
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
        'app_name' => '',
        'app_description' => '',
        'app_url' => 'nullable|url',
        'subscribe_url' => 'nullable',
        'subscribe_path' => 'nullable|regex:/^\\//',
        'try_out_enable' => 'in:0,1',
        'try_out_plan_id' => 'integer',
        'try_out_hour' => 'numeric',
        'tos_url' => 'nullable|url',
        'currency' => '',
        'currency_symbol' => '',
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
        'server_api_url' => 'nullable|string',
        'server_token' => 'nullable|min:16',
        'server_pull_interval' => 'integer',
        'server_push_interval' => 'integer',
        'device_limit_mode' => 'in:0,1',
        'server_node_report_min_traffic' => 'integer', 
        'server_device_online_min_traffic' => 'integer', 
        // Custom footer is independent of any frontend theme.
        'custom_footer_html' => 'nullable|string',
        // email
        'email_template' => '',
        'email_default_language' => 'in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
        'email_send_interval' => 'integer|min:1|max:3600',
        'email_bulk_interval' => 'integer|min:1|max:3600',
        'email_domain_interval' => 'integer|min:1|max:3600',
        'email_host' => '',
        'email_port' => '',
        'email_username' => '',
        'email_password' => '',
        'email_encryption' => '',
        'email_from_address' => '',
        // telegram
        'telegram_bot_enable' => 'in:0,1',
        'telegram_bot_token' => '',
        'telegram_discuss_id' => '',
        'telegram_channel_id' => '',
        'telegram_discuss_link' => 'nullable|url',
        'client_mirror_clash_windows' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_clash_macos' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_clash_linux' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_hiddify_windows' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_hiddify_macos' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_hiddify_linux' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_hiddify_android' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_hiddify_ios' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_singbox_android' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_singbox_macos' => 'nullable|url|regex:~^https?://~i|max:2048',
        'client_mirror_singbox_ios' => 'nullable|url|regex:~^https?://~i|max:2048',
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
    public function rules()
    {
        $rules = self::RULES;

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
            'app_url.url' => '站点URL格式不正确，必须携带http(s)://',
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
