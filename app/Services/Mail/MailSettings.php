<?php

namespace App\Services\Mail;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\ValidationException;

final class MailSettings
{
    private const SECRET_FIELDS = ['password', 'mailgun_api_key', 'resend_api_key', 'ses_access_key', 'ses_secret_key'];

    public static function forAdmin(): array
    {
        $settings = [
            'email_provider' => config('fastai.email_provider', 'smtp'),
            'email_ses_region' => config('fastai.email_ses_region', 'us-east-1'),
            'email_ses_auth' => config('fastai.email_ses_auth', 'role'),
            'email_ses_configuration_set' => config('fastai.email_ses_configuration_set', ''),
            'email_ses_access_key' => '',
            'email_ses_secret_key' => '',
            'email_ses_key_configured' => (bool)config('fastai.email_ses_access_key') && (bool)config('fastai.email_ses_secret_key'),
            'email_resend_api_key' => '',
            'email_resend_key_configured' => (bool)config('fastai.email_resend_api_key'),
            'email_mailgun_region' => config('fastai.email_mailgun_region', 'us'),
            'email_mailgun_domain' => config('fastai.email_mailgun_domain', ''),
            'email_mailgun_api_key' => '',
            'email_mailgun_key_configured' => (bool)config('fastai.email_mailgun_api_key'),
            'email_host' => config('fastai.email_host'),
            'email_port' => config('fastai.email_port'),
            'email_username' => config('fastai.email_username'),
            'email_password' => '',
            'email_smtp_key_configured' => (bool)config('fastai.email_password'),
            'email_encryption' => config('fastai.email_encryption'),
            'email_from_address' => config('fastai.email_from_address'),
            'email_default_language' => config('fastai.email_default_language', 'zh-CN'),
            'email_send_interval' => (int)config('fastai.email_send_interval', 2),
            'email_bulk_interval' => (int)config('fastai.email_bulk_interval', 10),
            'email_domain_interval' => (int)config('fastai.email_domain_interval', 30)
        ];
        $settings['email_public_url'] = config('fastai.email_public_url', config('app.url'));
        $settings['email_announcement_separate'] = (int) config('fastai.email_announcement_separate', 0);
        $settings['email_announcements_enabled'] = (int) config('fastai.email_announcements_enabled', 1);

        foreach (MailChannel::FIELDS as $field) {
            if ($field === 'password_encrypted') {
                continue;
            }
            $key = 'email_announcement_'.$field;
            $settings[$key] = in_array($field, self::SECRET_FIELDS, true) ? '' : config('fastai.'.$key, MailChannel::DEFAULTS[$field] ?? '');
        }
        foreach (['smtp' => 'password', 'mailgun' => 'mailgun_api_key', 'resend' => 'resend_api_key', 'ses' => 'ses_secret_key'] as $provider => $field) {
            $settings['email_announcement_'.$provider.'_key_configured'] = (bool) config('fastai.email_announcement_'.$field);
        }
        foreach (['mailgun', 'resend'] as $provider) {
            $key = 'email_'.$provider.'_webhook_key';
            $settings[$key] = '';
            $settings[$key.'_configured'] = (bool) config('fastai.'.$key);
        }
        $settings['email_ses_topic_arn'] = config('fastai.email_ses_topic_arn', '');

        return $settings;
    }

    public static function prepareSecrets(array $changes): array
    {
        foreach ([
            'email_announcement_' => '公告通道的 AWS 密钥须成对填写。',
            'email_' => '轮换 AWS 密钥时请同时填写 Access Key ID 和 Secret Access Key。',
        ] as $prefix => $message) {
            $accessKey = $prefix.'ses_access_key';
            if (empty($changes[$accessKey]) !== empty($changes[$prefix.'ses_secret_key'])) {
                throw ValidationException::withMessages([$accessKey => $message]);
            }

            foreach (self::SECRET_FIELDS as $field) {
                self::encryptIfProvided($changes, $prefix.$field);
            }
            if (isset($changes[$prefix.'password'])) {
                $changes[$prefix.'password_encrypted'] = true;
            }
        }
        foreach (['email_mailgun_webhook_key', 'email_resend_webhook_key'] as $key) {
            self::encryptIfProvided($changes, $key);
        }

        return $changes;
    }

    private static function encryptIfProvided(array &$changes, string $key): void
    {
        if (empty($changes[$key])) {
            unset($changes[$key]);
        } else {
            $changes[$key] = Crypt::encryptString($changes[$key]);
        }
    }

    public static function validate(array $config): void
    {
        if (!empty($config['email_announcement_separate'])) {
            self::validateAnnouncementChannel($config);
        }
        $provider = $config['email_provider'] ?? 'smtp';
        if ($provider === 'smtp') {
            return;
        }
        $invalidAddress = validator(['email' => $config['email_from_address'] ?? null], ['email' => 'required|email:rfc'])->fails();
        if ($provider === 'mailgun' && ($invalidAddress || empty($config['email_mailgun_domain']) || empty($config['email_mailgun_api_key']))) {
            throw ValidationException::withMessages(['email_provider' => '使用 Mailgun 前请填写发送域名、API Key 和有效发件人邮箱。']);
        }
        if ($provider === 'resend' && ($invalidAddress || empty($config['email_resend_api_key']))
            || $provider === 'ses' && ($invalidAddress || (($config['email_ses_auth'] ?? 'role') === 'key'
                && (empty($config['email_ses_access_key']) || empty($config['email_ses_secret_key']))))) {
            throw ValidationException::withMessages(['email_provider' => '请填写有效发件人邮箱及所选通道的必要凭据。']);
        }
    }

    private static function validateAnnouncementChannel(array $config): void
    {
        $provider = $config['email_announcement_provider'] ?? 'smtp';
        $required = match ($provider) {
            'smtp' => ['host', 'port'],
            'mailgun' => ['mailgun_domain', 'mailgun_api_key'],
            'resend' => ['resend_api_key'],
            'ses' => ['ses_region'],
            default => ['provider'],
        };
        if ($provider === 'ses' && ($config['email_announcement_ses_auth'] ?? 'role') === 'key') {
            $required = array_merge($required, ['ses_access_key', 'ses_secret_key']);
        }
        foreach ($required as $field) {
            $key = 'email_announcement_'.$field;
            if (empty($config[$key])) {
                throw ValidationException::withMessages([$key => '请完成公告独立通道配置。']);
            }
        }
        if (validator(['email' => $config['email_announcement_from_address'] ?? null], ['email' => 'required|email:rfc'])->fails()) {
            throw ValidationException::withMessages(['email_announcement_from_address' => '请填写公告发件地址。']);
        }
    }
}
