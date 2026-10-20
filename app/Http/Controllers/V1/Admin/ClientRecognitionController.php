<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\ClientRecognition;
use Illuminate\Http\Request;

final class ClientRecognitionController extends Controller
{
    public function fetch(ClientRecognition $library)
    {
        return response()->json(['data'=>['items'=>$library->catalog(),'version'=>$library->snapshot()['version']]])->header('Cache-Control','no-store');
    }
    public function save(Request $request, ClientRecognition $library)
    {
        abort_unless($request->isJson(),415,'JSON required');
        abort_if(strlen($request->getContent())>65536,413);
        $data=$request->validate(['rules'=>'present|array|max:30','version'=>'required|integer|min:0']);
        abort_if(array_diff(array_keys($request->except(['user','auth_data'])),array_keys($data)),422);
        $library->save($data['rules'],(int)$data['version'],(int)$request->user['id']);
        return response()->json(['data'=>true]);
    }
    public function preview(Request $request, ClientRecognition $library)
    {
        abort_unless($request->isJson(),415,'JSON required');
        abort_if(strlen($request->getContent())>65536,413);
        $data=$request->validate(['rules'=>'present|array|max:30','ua'=>'present|string|max:1024']);
        return response()->json(['data'=>$library->identify($data['ua'],ClientRecognition::validate($data['rules']))])->header('Cache-Control','no-store');
    }
}
