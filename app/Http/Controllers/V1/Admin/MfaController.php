<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\MfaService;
use Illuminate\Http\Request;

final class MfaController extends Controller
{
    public function state(Request $request)
    {
        return response(['data' => app(MfaService::class)->state($request->user['id'])])->header('Cache-Control', 'no-store');
    }

    public function start(Request $request)
    {
        $request->query->replace([]);
        $request->attributes->set('mfa.adminOnly', true);
        return response(['data' => app(MfaService::class)->start(User::findOrFail($request->user['id']), $request)], 201)->header('Cache-Control', 'no-store');
    }

    public function sendEmail(Request $request)
    {
        $request->query->replace([]);
        $request->attributes->set('mfa.adminOnly', true);
        $request->validate(['challengeId' => 'required|string|regex:/^[a-f0-9]{64}$/']);
        app(MfaService::class)->sendEmail($request->input('challengeId'), $request);
        return response('', 204)->header('Cache-Control', 'no-store');
    }

    public function finish(Request $request)
    {
        $request->query->replace([]);
        $request->attributes->set('mfa.adminOnly', true);
        $request->validate(['challengeId' => 'required|string|regex:/^[a-f0-9]{64}$/']);
        $result = app(MfaService::class)->finish($request->input('challengeId'), $request);
        return response(['data' => $result['auth'] ?? $result])->header('Cache-Control', 'no-store');
    }
}
