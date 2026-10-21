<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\TargetStatistics;
use Illuminate\Http\Request;

final class TargetStatisticsController extends Controller
{
    public function report(Request $request, TargetStatistics $statistics)
    {
        $input=$request->validate(['nodeId'=>'sometimes|integer|min:0','userId'=>'sometimes|integer|min:0','page'=>'sometimes|integer|min:1|max:40000','view'=>'sometimes|in:recent,daily']);
        abort_if(($input['view']??'recent')==='daily' && (int)($input['userId']??0)>0,422,'Daily aggregates do not contain user identities');
        return response()->json(['data'=>$statistics->report((int)($input['nodeId']??0),(int)($input['userId']??0),(int)($input['page']??1),$input['view']??'recent')])->header('Cache-Control','no-store');
    }
    public function settings(Request $request, TargetStatistics $statistics)
    {
        abort_unless($request->isJson(),415);
        $input=$request->validate(['enabled'=>'required_without_all:reportIntervalSeconds,retentionHours,dailyRetentionDays|boolean','reportIntervalSeconds'=>'required_without_all:enabled,retentionHours,dailyRetentionDays|integer|in:30,60,120,300','retentionHours'=>'required_without_all:enabled,reportIntervalSeconds,dailyRetentionDays|integer|in:1,6,12,24','dailyRetentionDays'=>'required_without_all:enabled,reportIntervalSeconds,retentionHours|integer|in:0,7,30']);
        return response()->json(['data'=>$statistics->configure(array_key_exists('enabled',$input) ? (bool)$input['enabled'] : null, isset($input['reportIntervalSeconds']) ? (int)$input['reportIntervalSeconds'] : null, isset($input['retentionHours']) ? (int)$input['retentionHours'] : null, isset($input['dailyRetentionDays']) ? (int)$input['dailyRetentionDays'] : null)]);
    }
}
