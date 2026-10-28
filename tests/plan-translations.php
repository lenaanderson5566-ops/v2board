<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\Plan;
use App\Models\PlanTranslation;
use App\Services\PlanTranslationService;
use Illuminate\Support\Facades\DB;
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
try {
    $plan=Plan::create(['name'=>'Source plan','content'=>'Source description','group_id'=>1,'transfer_enable'=>10,'month_price'=>1000,'show'=>1,'renew'=>1]);
    PlanTranslation::where('plan_id',$plan->id)->delete();
    PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'zh-CN','name'=>'简体套餐','content'=>'简体说明']);
    PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'zh-TW','name'=>'繁體套餐','content'=>'繁體說明']);
    $service=new PlanTranslationService;
    foreach (['zh-TW','zh_TW','zh-tw','zh-Hant','zh-HK'] as $locale) {
        $single=$service->translateSingle(Plan::find($plan->id),$locale);
        $assert($single->content==='繁體說明' && $single->name==='繁體套餐','traditional exact/alias '.$locale);
        $list=Plan::where('id',$plan->id)->get();
        $service->translateCollection($list,$locale);
        $assert($list[0]->content==='繁體說明','collection traditional '.$locale);
    }
    $assert($service->translateSingle(Plan::find($plan->id),'zh-CN')->content==='简体说明','simplified still selected');
    $assert($service->translateSingle(Plan::find($plan->id),'en-US')->content===$plan->content,'missing language retains source');
    PlanTranslation::where('plan_id',$plan->id)->where('locale','zh-TW')->update(['name'=>'']);
    $partial=$service->translateSingle(Plan::find($plan->id),'zh-TW');
    $assert($partial->content==='繁體說明' && $partial->name==='简体套餐','field fallback does not replace exact content');
    PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'en-US','name'=>'English plan','content'=>'English description']);
    foreach (['de-DE','de_AT','fr-FR','id-ID','th-TH','xx'] as $locale) {
        $resolved=$service->translateSingle(Plan::find($plan->id),$locale);
        $assert($resolved->name==='English plan' && $resolved->content==='English description','English fallback '.$locale);
    }
    PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'de-DE','name'=>'Deutscher Tarif','content'=>'   ']);
    $resolved=$service->translateSingle(Plan::find($plan->id),'de-DE');
    $assert($resolved->name==='Deutscher Tarif' && $resolved->content==='English description','Partial translation keeps exact name');
    $assert(Plan::find($plan->id)->name===$plan->name,'Rendering persisted fallback');
    $assert(App\Services\ContentTranslation::candidates('zh-Hant')===['zh-TW','zh-CN','en-US'],'Chinese fallback order');
    PlanTranslation::where('plan_id',$plan->id)->where('locale','zh-CN')->delete();
    $assert($service->translateSingle(Plan::find($plan->id),'zh-CN')->name===$plan->name,'Chinese source preserved ahead of English');
    echo "PASS: {$checks} plan locale checks\n";
} finally { DB::rollBack(); }
