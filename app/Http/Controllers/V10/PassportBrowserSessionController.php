<?php
namespace App\Http\Controllers\V10;
class PassportBrowserSessionController extends ResourceController
{
    public function getAuthBrowserSession(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getAuthBrowserSession');
        $result = app(\App\Services\Actions\Passport\BrowserSessionActions::class)->show($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getAuthBrowserSession');
    }
    public function postAuthBrowserSession(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthBrowserSession');
        $result = app(\App\Services\Actions\Passport\BrowserSessionActions::class)->migrate($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postAuthBrowserSession');
    }
    public function deleteAuthBrowserSession(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'deleteAuthBrowserSession');
        $result = app(\App\Services\Actions\Passport\BrowserSessionActions::class)->destroy($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'deleteAuthBrowserSession');
    }
}
