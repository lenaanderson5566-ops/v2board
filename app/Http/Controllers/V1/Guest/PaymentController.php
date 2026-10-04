<?php
namespace App\Http\Controllers\V1\Guest;

class PaymentController extends \App\Http\Controllers\Controller
{
    public function notify($method, $uuid, \Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Guest\PaymentActions::class)->notify($method, $uuid, $request);
    }
}
