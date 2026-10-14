<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Coupon;
use App\Services\LanguagePreferenceService;
use Illuminate\Http\Request;

final class CouponPresentationController extends Controller
{
    public function fetch(Request $request)
    {
        $input=$request->validate(['search'=>'nullable|string|max:100','current'=>'nullable|integer|min:1']);
        $query=Coupon::query()->orderByDesc('id');
        if (!empty($input['search'])) $query->where(function($q)use($input){$q->where('name','like','%'.$input['search'].'%');if(ctype_digit($input['search']))$q->orWhere('id',(int)$input['search']);});
        $total=$query->count();
        return response(['data'=>$query->forPage($input['current']??1,20)->get(['id','name','public_claim','activity_title','activity_description','translations']),'total'=>$total])->header('Cache-Control','no-store');
    }

    public function save(Request $request)
    {
        $input=$request->validate([
            'id'=>'required|integer|min:1','activity_title'=>'nullable|string|max:120','activity_description'=>'nullable|string|max:2000',
            'translations'=>'nullable|array:'.implode(',',LanguagePreferenceService::SUPPORTED),
            'translations.*'=>'array:name,activityTitle,activityDescription',
            'translations.*.name'=>'nullable|string|max:100','translations.*.activityTitle'=>'nullable|string|max:120',
            'translations.*.activityDescription'=>'nullable|string|max:2000',
        ]);
        $coupon=Coupon::findOrFail($input['id']);
        $coupon->activity_title=$input['activity_title']??null;
        $coupon->activity_description=$input['activity_description']??null;
        $coupon->translations=$input['translations']??[];
        $coupon->save();
        return response(['data'=>true]);
    }
}
