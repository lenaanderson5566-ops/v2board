<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Services\ClientReleaseService;
use Illuminate\Http\Request;

class ClientReleaseController extends Controller
{
    public function mirrors(\App\Services\ClientMirrorService $service) { return response(['data'=>$service->listing()]); }
    public function download(Request $request, \App\Services\ClientMirrorService $service) {
        $p=$request->validate(['client'=>'required|string','asset_id'=>'required|integer|min:1','target'=>'required|string']);
        return response(['data'=>['id'=>$service->enqueue($p['client'],$p['asset_id'],$p['target'])]]);
    }
    public function mirrorAction(Request $request, \App\Services\ClientMirrorService $service) {
        $p=$request->validate(['id'=>'required|uuid','action'=>'required|in:publish,unpublish,delete']);
        $service->action($p['id'],$p['action']); return response(['data'=>true]);
    }

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
