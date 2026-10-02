<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\Plan;
use App\Models\PlanTranslation;
use App\Services\PlanTranslationService;
use Illuminate\Support\Facades\DB;
$checks=0;
$assert=function($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
DB::beginTransaction();
try {
    $plan=Plan::firstOrFail();
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
    echo "PASS: {$checks} plan locale checks\n";
} finally { DB::rollBack(); }
