<?php
namespace App\Services\Actions\User;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

final class ClientEventActions {
    public function store(Request $request) {
        $data=$request->validate([
            'clientVersion'=>['required','string','max:32','regex:/^\d+(?:\.\d+){1,3}$/'],
            'platform'=>'required|in:windows,macos,linux,android,ios',
            'events'=>'required|array|min:1|max:30',
            'events.*'=>'required|array:name,outcome,elapsedMs,errorClass',
            'events.*.name'=>'required|in:connection,config_sync,subscription_sync,account_sync',
            'events.*.outcome'=>'required|in:success,failure',
            'events.*.elapsedMs'=>'required|integer|min:0|max:300000',
            'events.*.errorClass'=>'required|in:none,timeout,network,certificate,authentication,policy,server,unknown',
        ]);
        $userId=(int)$request->user['id'];
        $key='client-events:'.$userId;
        $lock=Cache::lock($key.':lock',10);
        if (!$lock->get()) abort(429,'Client report is already being received.');
        try {
            if (RateLimiter::tooManyAttempts($key,12)) abort(429,'Client event limit reached.');
            RateLimiter::hit($key,3600);
            $id=(string)Str::uuid();
            DB::table('v2_client_diagnostic_report')->insert([
                'user_id'=>$userId,'report_id'=>$id,'report_kind'=>'runtime',
                'client_version'=>$data['clientVersion'],'platform'=>$data['platform'],
                'checks'=>json_encode($data['events']),'created_at'=>time(),
            ]);
            return response()->json(['data'=>['report_id'=>$id]]);
        } finally { $lock->release(); }
    }
}
