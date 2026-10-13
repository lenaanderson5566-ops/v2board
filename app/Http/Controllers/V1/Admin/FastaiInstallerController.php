<?php

namespace App\Http\Controllers\V1\Admin;

use App\Services\FastaiInstallerService;
use Illuminate\Http\Request;

final class FastaiInstallerController extends \App\Http\Controllers\Controller
{
    public function fetch(FastaiInstallerService $service)
    {
        return response()->json(['data'=>$service->listing()]);
    }

    public function create(Request $request, FastaiInstallerService $service)
    {
        $data = $request->validate([
            'name'=>'required|string|max:180', 'size'=>'required|integer|min:1|max:'.FastaiInstallerService::MAX_BYTES,
            'platform'=>'required|in:windows,android,macos,linux', 'architecture'=>'required|in:x64,arm64,arm,x86',
            'latestVersion'=>['required','string','max:32','regex:/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/'],
            'latestBuild'=>'required|integer|min:1|max:2100000000',
        ]);
        return response()->json(['data'=>$service->create($data)], 201);
    }

    public function chunk(Request $request, FastaiInstallerService $service)
    {
        $data = $request->validate(['id'=>'required|string|max:43', 'index'=>'required|integer|min:0|max:1023', 'chunk'=>'required|file|max:512']);
        $service->chunk($data['id'], $data['index'], $request->file('chunk'));
        return response()->json(['data'=>true]);
    }

    public function complete(Request $request, FastaiInstallerService $service)
    {
        $data = $request->validate(['id'=>'required|string|max:43']);
        return response()->json(['data'=>$service->complete($data['id'])]);
    }
}
