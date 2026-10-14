<?php

namespace App\Http\Controllers\V10;

use App\Http\Resources\V10\Resource;
use App\Models\User;
use App\Services\MfaService;
use Illuminate\Http\Request;

final class MfaController extends ResourceController
{
    public function state(Request $request)
    {
        $this->prepare($request, 'getMeMfa');
        return response()->json(['data' => app(MfaService::class)->state($request->user['id'])]);
    }

    public function start(Request $request)
    {
        $this->prepare($request, 'postMeMfaChallenges');
        return response()->json(['data' => app(MfaService::class)->start(User::findOrFail($request->user['id']), $request)], 201);
    }

    public function sendEmail(Request $request)
    {
        $this->prepare($request, 'postMfaEmails');
        $request->validate(['challengeId' => 'required|string|regex:/^[a-f0-9]{64}$/']);
        app(MfaService::class)->sendEmail($request->input('challengeId'), $request);
        return response('', 204);
    }

    public function finish(Request $request)
    {
        $this->prepare($request, 'postMfaVerifications');
        $request->validate(['challengeId' => 'required|string|regex:/^[a-f0-9]{64}$/']);
        $result = app(MfaService::class)->finish($request->input('challengeId'), $request);
        return response()->json(['data' => isset($result['auth']) ? Resource::encode('authentication', $result['auth']) : $result]);
    }
}
