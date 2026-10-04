<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Services\ClientReleaseService;
use Illuminate\Http\Request;

class ClientReleaseController extends Controller
{
    public function fetch(ClientReleaseService $service)
    {
        return response(['data' => $service->all()]);
    }

    public function check(Request $request, ClientReleaseService $service)
    {
        $params = $request->validate(['id' => 'required|string']);
        $service->check($params['id']);
        return response(['data' => $service->all()]);
    }
}
