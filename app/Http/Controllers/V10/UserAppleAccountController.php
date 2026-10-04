<?php
namespace App\Http\Controllers\V10;
class UserAppleAccountController extends ResourceController
{
    public function getMeDownloadAccounts(\Illuminate\Http\Request $request ,\App\Services\AppleAccountService $service)
    {
        $this->prepare($request, 'getMeDownloadAccounts');
        $result = app(\App\Services\Actions\User\AppleAccountActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class), $service);
        return $this->respond($request, $result, 'getMeDownloadAccounts');
    }
}
