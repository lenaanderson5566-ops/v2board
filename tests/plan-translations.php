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
    foreach (['zh-CN','zh_CN','zh-Hans','zh-SG'] as $locale) {
        $source=$service->translateSingle(Plan::find($plan->id),$locale);
        $assert($source->content===$plan->content && $source->name===$plan->name,'base source ignores historical duplicate '.$locale);
    }
    $assert($service->translateSingle(Plan::find($plan->id),'en-US')->content===$plan->content,'missing language retains source');
    PlanTranslation::where('plan_id',$plan->id)->where('locale','zh-TW')->update(['name'=>'']);
    $partial=$service->translateSingle(Plan::find($plan->id),'zh-TW');
    $assert($partial->content==='繁體說明' && $partial->name===$plan->name,'field fallback uses source ahead of historical base copy');
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

    $hashes=['name'=>hash('sha256',(string)$plan->name),'content'=>hash('sha256',(string)$plan->content)];
    PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->update([
        'name_source_hash'=>$hashes['name'],'content_source_hash'=>$hashes['content'],
        'name_origin'=>'manual','content_origin'=>'machine',
    ]);
    PlanTranslation::where('plan_id',$plan->id)->where('locale','de-DE')->update([
        'name'=>'Aktueller Tarif','content'=>'Obsolete description',
        'name_source_hash'=>$hashes['name'],'content_source_hash'=>hash('sha256','Old source description'),
        'name_origin'=>'manual','content_origin'=>'machine',
    ]);
    $resolved=$service->translateSingle(Plan::find($plan->id),'de-DE');
    $assert($resolved->name==='Aktueller Tarif' && $resolved->content==='English description','Outdated description uses current English without replacing current exact name');

    PlanTranslation::where('plan_id',$plan->id)->where('locale','de-DE')->update([
        'name_source_hash'=>hash('sha256','Old source name'),
        'content'=>'Aktuelle Beschreibung','content_source_hash'=>$hashes['content'],
    ]);
    $resolved=$service->translateSingle(Plan::find($plan->id),'de-DE');
    $assert($resolved->name==='English plan' && $resolved->content==='Aktuelle Beschreibung','Outdated name does not invalidate current exact description');
    $list=Plan::where('id',$plan->id)->get();
    $service->translateCollection($list,'de-DE');
    $assert($list[0]->name==='English plan' && $list[0]->content==='Aktuelle Beschreibung','Collection hashes use original fields before localization');

    PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->update([
        'name_source_hash'=>hash('sha256','Old source name'),
        'content_source_hash'=>hash('sha256','Old source description'),
    ]);
    $resolved=$service->translateSingle(Plan::find($plan->id),'ja-JP');
    $assert($resolved->name===$plan->name && $resolved->content===$plan->content,'Outdated English fallback uses current source');
    PlanTranslation::where('plan_id',$plan->id)->where('locale','de-DE')->update([
        'content_source_hash'=>hash('sha256','Old source description'),
    ]);
    $resolved=$service->translateSingle(Plan::find($plan->id),'de-DE');
    $assert($resolved->name===$plan->name && $resolved->content===$plan->content,'All known outdated variants use current source');
    $traditional=$service->translateSingle(Plan::find($plan->id),'zh-TW');
    $assert($traditional->name===$plan->name && $traditional->content==='繁體說明','Legacy hashless content stays compatible and base copy remains ignored');

    $before=PlanTranslation::where('plan_id',$plan->id)->orderBy('locale')->get()->toArray();
    DB::enableQueryLog();
    DB::flushQueryLog();
    foreach (['de-DE','ja-JP','zh-CN','zh-TW'] as $locale) {
        $service->translateSingle(Plan::find($plan->id),$locale);
    }
    $queries=DB::getQueryLog();
    DB::disableQueryLog();
    $writes=array_filter($queries,fn($query)=>preg_match('/^\s*(?:insert|update|delete|replace)\b/i',$query['query']));
    $assert(count($writes)===0,'Locale resolution never writes or backfills records');
    $assert(PlanTranslation::where('plan_id',$plan->id)->orderBy('locale')->get()->toArray()===$before,'Locale resolution preserves all stored translations and metadata');
    $assert(Plan::find($plan->id)->name===$plan->name && Plan::find($plan->id)->content===$plan->content,'Locale resolution never persists translated source fields');
    PlanTranslation::where('plan_id',$plan->id)->where('locale','zh-CN')->delete();
    $assert($service->translateSingle(Plan::find($plan->id),'zh-CN')->name===$plan->name,'Chinese source preserved ahead of English');
    echo "PASS: {$checks} plan locale checks\n";
} finally { DB::rollBack(); }
