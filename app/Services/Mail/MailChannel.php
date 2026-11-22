<?php
namespace App\Services\Mail;

class MailChannel
{
    public const DEFAULTS=['provider'=>'smtp','port'=>587,'encryption'=>'tls','mailgun_region'=>'us','ses_region'=>'us-east-1','ses_auth'=>'role'];
    public const FIELDS = ['provider','host','port','username','password','password_encrypted','encryption','from_address','mailgun_domain','mailgun_region','mailgun_api_key','ses_region','ses_auth','ses_access_key','ses_secret_key','ses_configuration_set','resend_api_key'];
    public static function run(bool $announcement, callable $action)
    {
        if (!$announcement || !config('fastai.email_announcement_separate',0)) return $action();
        $saved = config('fastai'); $mail = config('mail');
        try {
            foreach (self::FIELDS as $field) config(['fastai.email_'.$field=>config('fastai.email_announcement_'.$field,self::DEFAULTS[$field] ?? null)]);
            return $action();
        } finally {
            config(['fastai'=>$saved,'mail'=>$mail]);
            \Illuminate\Support\Facades\Mail::forgetMailers();
        }
    }
}
