<?php

namespace App\Services\Actions\Guest;

use App\Services\FastaiReleaseService;
use Illuminate\Http\Request;

final class FastaiActions
{
    public function release(Request $request)
    {
        $release = (new FastaiReleaseService())->release($request->input('platform'), $request->input('architecture'));
        if (!$release) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                response()->json(['code' => 'RELEASE_UNAVAILABLE', 'message' => 'No release is published for this target.'], 404)
            );
        }
        return response()->json(['data' => $release], 200, ['Cache-Control' => 'public, max-age=300']);
    }
}
