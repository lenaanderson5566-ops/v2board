<?php
namespace App\Http\Controllers\V10;
class GuestPaymentController extends ResourceController
{
    public function getWebhooksPaymentsProviderEndpointId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getWebhooksPaymentsProviderEndpointId');
        $result = app(\App\Services\Actions\Guest\PaymentActions::class)->notify($request->route('provider'), $request->route('endpointId'), $this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getWebhooksPaymentsProviderEndpointId');
    }
}
