<?php
namespace App\Http\Controllers\V1\User;

class OrderController extends \App\Http\Controllers\Controller
{
    public function save(\App\Http\Requests\User\OrderSave $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->save($request);
    }
    public function checkout(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->checkout($request);
    }
    public function check(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->check($request);
    }
    public function detail(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->detail($request);
    }
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->fetch($request);
    }
    public function getPaymentMethod()
    {
        return app(\App\Services\Actions\User\OrderActions::class)->getPaymentMethod();
    }
    public function cancel(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\OrderActions::class)->cancel($request);
    }
}
