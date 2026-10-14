<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Services\BillingCurrency;
use App\Services\ExchangeRate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
final class BillingCurrencyController extends Controller
{
    public function fetch() {
        $rate=DB::table('v2_exchange_rate')->where('id',1)->first();
        return response(['data'=>['default_currency'=>config('v2board.new_user_currency','CNY'),'rate'=>$rate,
            'plans'=>Plan::orderBy('sort')->get(['id','name','usd_prices']),
            'paid_totals'=>DB::table('v2_order')->whereIn('status',[1,3,4])->select('currency')->selectRaw('SUM(total_amount) as amount')->groupBy('currency')->get(),
        ]])->header('Cache-Control','no-store');
    }
    public function refresh() {
        $ok=ExchangeRate::refresh(true);
        return response(['data'=>['refreshed'=>$ok,'message'=>$ok?'汇率已刷新。':'本分钟已刷新或上游暂不可用，请查看最后成功时间。']]);
    }
    public function prices(Request $request) {
        $rules=['plan_id'=>'required|integer|min:1','prices'=>'required|array:'.implode(',',BillingCurrency::PERIODS)];
        foreach(BillingCurrency::PERIODS as $period) $rules['prices.'.$period]='present|nullable|integer|min:0|max:1000000000';
        $data=$request->validate($rules);
        $plan=Plan::findOrFail($data['plan_id']);$plan->usd_prices=$data['prices'];$plan->save();
        return response(['data'=>true]);
    }
}
