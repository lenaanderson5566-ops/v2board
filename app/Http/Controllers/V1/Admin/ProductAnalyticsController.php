<?php
namespace App\Http\Controllers\V1\Admin;

use App\Services\ProductAnalytics;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

final class ProductAnalyticsController extends \App\Http\Controllers\Controller {
    public function report(Request $request, ProductAnalytics $service) {
        $input=$request->validate(['days'=>'sometimes|integer|in:7,30,90','device'=>'sometimes|in:all,desktop,mobile,tablet']);
        $days=(int)($input['days'] ?? 30); $device=$input['device'] ?? 'all';
        $key='PRODUCT_ANALYTICS_REPORT:v2:'.$days.':'.$device.':'.\App\Services\TimeZones::system().':'.$service->settings()['retentionDays'];
        $data=Cache::remember($key,60,fn()=>$service->report($days,$device));
        $data['settings']=$service->settings();
        return response()->json(['data'=>$data])->header('Cache-Control','private, no-store');
    }
    public function settings(Request $request, ProductAnalytics $service) {
        $values=$request->validate(['enabled'=>'required|boolean','retentionDays'=>'required|integer|in:7,30,90']);
        return response()->json(['data'=>$service->save($values)])->header('Cache-Control','private, no-store');
    }
}
