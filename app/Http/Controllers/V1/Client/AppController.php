<?php
namespace App\Http\Controllers\V1\Client;

class AppController extends \App\Http\Controllers\Controller
{
    public function getConfig(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Client\AppActions::class)->getConfig($request);
    }
    public function getVersion(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Client\AppActions::class)->getVersion($request);
    }
}
