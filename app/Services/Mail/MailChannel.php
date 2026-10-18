<?php
namespace App\Services\Mail;

class MailChannel
{
    public const DEFAULTS=['provider'=>'smtp','port'=>587,'encryption'=>'tls','mailgun_region'=>'us','ses_region'=>'us-east-1','ses_auth'=>'role'];
    public const FIELDS = ['provider','host','port','username','password','password_encrypted','encryption','from_address','mailgun_domain','mailgun_region','mailgun_api_key','ses_region','ses_auth','ses_access_key','ses_secret_key','ses_configuration_set','resend_api_key'];
    public static function run(bool $announcement, callable $action)
    {
        if (!$announcement || !config('v2board.email_announcement_separate',0)) return $action();
        $saved = config('v2board'); $mail = config('mail');
        try {
            foreach (self::FIELDS as $field) config(['v2board.email_'.$field=>config('v2board.email_announcement_'.$field,self::DEFAULTS[$field] ?? null)]);
            return $action();
        } finally {
            config(['v2board'=>$saved,'mail'=>$mail]);
            \Illuminate\Support\Facades\Mail::forgetMailers();
        }
    }
    public static function settings(): array
    {
        $result=['email_public_url'=>config('v2board.email_public_url',config('app.url')), 'email_announcement_separate'=>(int)config('v2board.email_announcement_separate',0),'email_announcements_enabled'=>(int)config('v2board.email_announcements_enabled',1)];
        $secrets=['password','mailgun_api_key','resend_api_key','ses_access_key','ses_secret_key'];
        $defaults=['provider'=>'smtp','port'=>587,'encryption'=>'tls','mailgun_region'=>'us','ses_region'=>'us-east-1','ses_auth'=>'role'];
        foreach (self::FIELDS as $field) {
            if ($field==='password_encrypted') continue;
            $result['email_announcement_'.$field]=in_array($field,$secrets,true) ? '' : config('v2board.email_announcement_'.$field,$defaults[$field] ?? '');
        }
        foreach (['smtp'=>'password','mailgun'=>'mailgun_api_key','resend'=>'resend_api_key','ses'=>'ses_secret_key'] as $provider=>$field) $result['email_announcement_'.$provider.'_key_configured']=(bool)config('v2board.email_announcement_'.$field);
        foreach (['mailgun','resend'] as $provider) {
            $result['email_'.$provider.'_webhook_key']='';
            $result['email_'.$provider.'_webhook_key_configured']=(bool)config('v2board.email_'.$provider.'_webhook_key');
        }
        $result['email_ses_topic_arn']=config('v2board.email_ses_topic_arn','');
        return $result;
    }
}
