<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\CouponCampaign;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CouponCampaignController extends Controller
{
    public function preview(Request $request)
    {
        return response(['data'=>CouponCampaign::preview($request)],201)->header('Cache-Control','no-store');
    }

    public function confirm(Request $request)
    {
        $input = $request->validate(['preview_key'=>'required|uuid','confirmed'=>'required|accepted']);
        return response(['data'=>CouponCampaign::confirm($input['preview_key'],(int)$request->user['id'])],202)->header('Cache-Control','no-store');
    }

    public function cancel(Request $request)
    {
        $input = $request->validate(['id'=>'required|integer|min:1']);
        return response(['data'=>CouponCampaign::cancel((int)$input['id'],(int)$request->user['id'])])->header('Cache-Control','no-store');
    }

    public function fetch(Request $request)
    {
        $input = $request->validate(['current'=>'nullable|integer|min:1','pageSize'=>'nullable|integer|min:1|max:100']);
        $query = DB::table('v2_coupon_campaign')->where('status','!=','draft');
        $total = $query->count();
        $rows = $query->orderByDesc('id')->forPage($input['current']??1,$input['pageSize']??20)->pluck('id')->map(fn($id)=>CouponCampaign::present((int)$id));
        return response(['data'=>$rows,'total'=>$total])->header('Cache-Control','no-store');
    }

    public function recipients(Request $request)
    {
        $input = $request->validate(['id'=>'required|integer|min:1','current'=>'nullable|integer|min:1',
            'status'=>'nullable|in:pending,issued,skipped,failed,cancelled']);
        $query = DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$input['id']);
        abort_unless(DB::table('v2_coupon_campaign')->where('id',$input['id'])->exists(),404);
        if (!empty($input['status'])) $query->where('status',$input['status']);
        $total = $query->count();
        return response(['data'=>$query->orderBy('id')->forPage($input['current']??1,50)->get(['user_id','status','reason','wallet_id','attempts','updated_at']),
            'total'=>$total])->header('Cache-Control','no-store');
    }
}
