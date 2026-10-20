<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\{NodeDictionary,NodeDisplayService,LanguagePreferenceService};
use Illuminate\Http\Request;

final class NodeDictionaryController extends Controller
{
    public function fetch(NodeDictionary $dictionary)
    {
        $versions=[];$overrides=[];
        foreach ($dictionary->rows() as $key=>$row) { $versions[$key]=(int)$row->version;$overrides[$key]=json_decode($row->names,true); }
        return response()->json(['data'=>['catalog'=>NodeDisplayService::catalog(),'defaults'=>NodeDictionary::defaults(),'versions'=>(object)$versions,'overrides'=>(object)$overrides,'languages'=>LanguagePreferenceService::SUPPORTED]])->header('Cache-Control','no-store');
    }
    public function save(Request $request, NodeDictionary $dictionary)
    {
        abort_unless($request->isJson(),415,'JSON required');
        abort_if(strlen($request->getContent())>16384,413);
        $data=$request->validate(['kind'=>'required|in:regions,cities','code'=>'required|string|max:64','version'=>'required|integer|min:0','names'=>'present|array|max:14']);
        abort_if(array_diff(array_keys($request->except(['user','auth_data'])),array_keys($data)),422);
        $dictionary->save($data,(int)$request->user['id']);
        return response()->json(['data'=>true]);
    }
}
