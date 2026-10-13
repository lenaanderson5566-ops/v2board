<?php
namespace App\Services\Actions\User;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

final class DiagnosticActions {
    public function store(Request $request) {
        $data = $request->validate([
            'clientVersion' => ['required','string','max:32','regex:/^\d+(?:\.\d+){1,3}$/'],
            'platform' => 'required|in:windows,macos,linux,android,ios',
            'checks' => 'required|array|min:1|max:9',
            'checks.*' => 'required|array:id,status,elapsedMs',
            'checks.*.id' => 'required|distinct|in:dns,website,proxy,settings,systemProxy,route,tcp,tls,reference',
            'checks.*.status' => 'required|in:passed,failed,skipped,unverified',
            'checks.*.elapsedMs' => 'nullable|integer|min:0|max:300000',
        ]);
        $userId = (int) $request->user['id'];
        $key = 'diagnostic-report:'.$userId;
        if (RateLimiter::tooManyAttempts($key, 5)) abort(429, 'Diagnostic report limit reached.');
        RateLimiter::hit($key, 3600);
        $id = (string) Str::uuid();
        DB::table('v2_client_diagnostic_report')->insert([
            'user_id'=>$userId, 'report_id'=>$id, 'client_version'=>$data['clientVersion'],
            'platform'=>$data['platform'], 'checks'=>json_encode($data['checks']), 'created_at'=>time(),
        ]);
        return response()->json(['data'=>['report_id'=>$id]]);
    }
}
