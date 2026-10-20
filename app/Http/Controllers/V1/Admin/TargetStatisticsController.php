<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\TargetStatistics;
use Illuminate\Http\Request;

final class TargetStatisticsController extends Controller
{
    public function report(Request $request, TargetStatistics $statistics)
    {
        $input=$request->validate(['nodeId'=>'sometimes|integer|min:0','userId'=>'sometimes|integer|min:0','page'=>'sometimes|integer|min:1|max:240']);
        return response()->json(['data'=>$statistics->report((int)($input['nodeId']??0),(int)($input['userId']??0),(int)($input['page']??1))])->header('Cache-Control','no-store');
    }
    public function settings(Request $request, TargetStatistics $statistics)
    {
        abort_unless($request->isJson(),415);
        $input=$request->validate(['enabled'=>'required|boolean']);
        return response()->json(['data'=>$statistics->configure((bool)$input['enabled'])]);
    }
}
