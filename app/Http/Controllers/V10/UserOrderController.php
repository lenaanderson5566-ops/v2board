<?php
namespace App\Http\Controllers\V10;
class UserOrderController extends ResourceController
{
    public function postMeOrders(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeOrders');
        $result = app(\App\Services\Actions\User\OrderActions::class)->save($this->businessRequest($request, \App\Http\Requests\User\OrderSave::class));
        return $this->respond($request, $result, 'postMeOrders');
    }
    public function postMeOrdersOrderNumberPayments(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeOrdersOrderNumberPayments');
        $result = app(\App\Services\Actions\User\OrderActions::class)->checkout($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeOrdersOrderNumberPayments');
    }
    public function getMeOrdersOrderNumberStatus(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeOrdersOrderNumberStatus');
        $result = app(\App\Services\Actions\User\OrderActions::class)->check($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeOrdersOrderNumberStatus');
    }
    public function getMeOrdersOrderNumber(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeOrdersOrderNumber');
        $result = app(\App\Services\Actions\User\OrderActions::class)->detail($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeOrdersOrderNumber');
    }
    public function getMeOrders(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeOrders');
        $result = app(\App\Services\Actions\User\OrderActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeOrders');
    }
    public function getPaymentMethods(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPaymentMethods');
        $result = app(\App\Services\Actions\User\OrderActions::class)->getPaymentMethod();
        return $this->respond($request, $result, 'getPaymentMethods');
    }
    public function postMeOrdersOrderNumberCancellation(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeOrdersOrderNumberCancellation');
        $result = app(\App\Services\Actions\User\OrderActions::class)->cancel($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeOrdersOrderNumberCancellation');
    }
}
