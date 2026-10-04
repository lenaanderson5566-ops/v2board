<?php
namespace App\Http\Controllers\V10;
class ClientAppController extends ResourceController
{
    public function getSubscriptionsSubscriptionTokenApplicationConfig(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getSubscriptionsSubscriptionTokenApplicationConfig');
        $result = app(\App\Services\Actions\Client\AppActions::class)->getConfig($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getSubscriptionsSubscriptionTokenApplicationConfig');
    }
    public function getSubscriptionsSubscriptionTokenApplicationVersion(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getSubscriptionsSubscriptionTokenApplicationVersion');
        $result = app(\App\Services\Actions\Client\AppActions::class)->getVersion($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getSubscriptionsSubscriptionTokenApplicationVersion');
    }
}
