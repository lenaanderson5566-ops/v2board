<?php

namespace App\Services\Actions\Guest;


use App\Utils\Dict;
use Illuminate\Support\Facades\Http;

class CommActions
{
    public function config()
    {
        return response([
            'data' => [
                'tos_url' => config('fastai.tos_url'),
                'is_email_verify' => (int)config('fastai.email_verify', 0) ? 1 : 0,
                'is_invite_force' => (int)config('fastai.invite_force', 0) ? 1 : 0,
                'email_whitelist_suffix' => (int)config('fastai.email_whitelist_enable', 0)
                    ? $this->getEmailSuffix()
                    : 0,
                'app_description' => config('fastai.app_description'),
                'app_url' => config('fastai.app_url'),
                'logo' => config('fastai.logo'),
            ]
        ]);
    }

    private function getEmailSuffix()
    {
        return \App\Utils\Helper::emailSuffixes(config('fastai.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT));
    }
}
