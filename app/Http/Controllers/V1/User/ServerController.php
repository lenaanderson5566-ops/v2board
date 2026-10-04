<?php
namespace App\Http\Controllers\V1\User;

class ServerController extends \App\Http\Controllers\Controller
{
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\ServerActions::class)->fetch($request);
    }
}
