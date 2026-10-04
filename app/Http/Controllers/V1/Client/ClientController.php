<?php
namespace App\Http\Controllers\V1\Client;

class ClientController extends \App\Http\Controllers\Controller
{
    public function subscribe(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Client\ClientActions::class)->subscribe($request);
    }
}
