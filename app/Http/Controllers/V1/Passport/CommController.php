<?php
namespace App\Http\Controllers\V1\Passport;

class CommController extends \App\Http\Controllers\Controller
{
    public function sendEmailVerify(\App\Http\Requests\Passport\CommSendEmailVerify $request)
    {
        return app(\App\Services\Actions\Passport\CommActions::class)->sendEmailVerify($request);
    }
}
