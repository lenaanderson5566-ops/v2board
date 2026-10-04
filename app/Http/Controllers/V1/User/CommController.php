<?php
namespace App\Http\Controllers\V1\User;

class CommController extends \App\Http\Controllers\Controller
{
    public function config()
    {
        return app(\App\Services\Actions\User\CommActions::class)->config();
    }
    public function getStripePublicKey(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\CommActions::class)->getStripePublicKey($request);
    }
}
