<?php
namespace App\Http\Controllers\V10;
class PassportClientAuthorizationController extends ResourceController
{
    public function postAuthClientAuthorizations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthClientAuthorizations');
        $result = app(\App\Services\Actions\Passport\ClientAuthorizationActions::class)->create($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postAuthClientAuthorizations');
    }
    public function getMeClientAuthorizationsAuthorizationId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeClientAuthorizationsAuthorizationId');
        $result = app(\App\Services\Actions\Passport\ClientAuthorizationActions::class)->details($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeClientAuthorizationsAuthorizationId');
    }
    public function postMeClientAuthorizationsAuthorizationIdApproval(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeClientAuthorizationsAuthorizationIdApproval');
        $result = app(\App\Services\Actions\Passport\ClientAuthorizationActions::class)->approve($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeClientAuthorizationsAuthorizationIdApproval');
    }
    public function postAuthClientSessionExchanges(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthClientSessionExchanges');
        $result = app(\App\Services\Actions\Passport\ClientAuthorizationActions::class)->exchange($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postAuthClientSessionExchanges');
    }
}
