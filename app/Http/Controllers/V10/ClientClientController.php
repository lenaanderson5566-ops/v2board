<?php
namespace App\Http\Controllers\V10;
class ClientClientController extends ResourceController
{
    public function getSubscriptionsSubscriptionToken(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getSubscriptionsSubscriptionToken');
        $result = app(\App\Services\Actions\Client\ClientActions::class)->subscribe($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getSubscriptionsSubscriptionToken');
    }
    public function getMeClientConfig(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeClientConfig');
        $result = app(\App\Services\Actions\Client\ClientActions::class)->authenticatedConfig($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeClientConfig');
    }
}
