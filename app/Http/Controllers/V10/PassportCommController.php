<?php
namespace App\Http\Controllers\V10;
class PassportCommController extends ResourceController
{
    public function postAuthEmailVerifications(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthEmailVerifications');
        $result = app(\App\Services\Actions\Passport\CommActions::class)->sendEmailVerify($this->businessRequest($request, \App\Http\Requests\Passport\CommSendEmailVerify::class));
        return $this->respond($request, $result, 'postAuthEmailVerifications');
    }
    public function postPublicPageViews(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postPublicPageViews');
        $result = app(\App\Services\Actions\Passport\CommActions::class)->pv($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postPublicPageViews');
    }
}
