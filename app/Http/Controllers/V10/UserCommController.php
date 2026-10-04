<?php
namespace App\Http\Controllers\V10;
class UserCommController extends ResourceController
{
    public function getMePreferencesOptions(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMePreferencesOptions');
        $result = app(\App\Services\Actions\User\CommActions::class)->config();
        return $this->respond($request, $result, 'getMePreferencesOptions');
    }
    public function getPaymentMethodsPaymentIdPublicKey(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPaymentMethodsPaymentIdPublicKey');
        $result = app(\App\Services\Actions\User\CommActions::class)->getStripePublicKey($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPaymentMethodsPaymentIdPublicKey');
    }
}
