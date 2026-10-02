<?php
namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Services\UsageResetService;
use Illuminate\Http\Request;

class UsageResetController extends Controller
{
    public function fetch(Request $request, UsageResetService $service)
    {
        return response(['data' => $service->summary((int)$request->user['id'])]);
    }
    public function consume(Request $request, UsageResetService $service)
    {
        $data = $request->validate(['request_key' => 'required|uuid']);
        return response(['data' => $service->consume((int)$request->user['id'], $data['request_key'])]);
    }
}
