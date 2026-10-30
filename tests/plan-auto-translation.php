<?php
$app = require __DIR__.'/support/bootstrap.php';
use Illuminate\Support\Facades\Http;
use App\Services\PlanAutoTranslation;
config(['plan-translation.url'=>'https://translator.example.test', 'plan-translation.key'=>'test-key', 'plan-translation.region'=>'test-region']);
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$service = new PlanAutoTranslation;
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'50 GB per month']]], ['translations'=>[['text'=>'Up to 4 devices']]]],200)]);
$input = '[{"feature":"每月 50 GB","support":true,"extra":"keep"},{"feature":"最多 4 台设备","support":false}]';
$output = json_decode($service->generate($input,'zh-CN','en-US'),true);
$assert($output[0]['feature']==='50 GB per month', 'feature translated');
$assert($output[0]['support']===true && $output[1]['support']===false, 'support retained');
$assert($output[0]['extra']==='keep', 'extra retained');
$assert(Http::recorded(function ($request) { return strpos($request->url(),'from=zh-Hans')!==false && strpos($request->url(),'to=en')!==false && $request->hasHeader('Ocp-Apim-Subscription-Key','test-key') && $request[0]['Text']==='每月 50 GB'; })->count() > 0, 'Azure request parameters');
$assert($service->generate('[]','zh-CN','en-US')==='[]', 'empty features retained');
$assert($service->generate('','zh-CN','en-US')==='', 'empty description retained');
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'<p>50 GB 使用量</p>']]]],200)]);
$assert($service->generate('<p>50 GB usage</p>','en-US','zh-TW')==='<p>50 GB 使用量</p>', 'HTML translated');
$assert(Http::recorded(function ($request) { return strpos($request->url(),'to=zh-Hant')!==false && strpos($request->url(),'textType=html')!==false; })->count() > 0, 'Azure request parameters');
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'500 GB']]],['translations'=>[['text'=>'4 devices']]]],200)]);
try { $service->generate($input,'zh-CN','en-US'); throw new RuntimeException('numeric corruption accepted'); } catch (Illuminate\Validation\ValidationException $e) { $checks++; }
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'ماهانه ۵۰ GB']]],['translations'=>[['text'=>'۴ دستگاه']]]],200)]);
$persian = json_decode($service->generate($input,'zh-CN','fa-IR'),true);
$assert($persian[0]['feature']==='ماهانه ۵۰ GB', 'Persian digits are equivalent');
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'５００ GB']]],['translations'=>[['text'=>'４ devices']]]],200)]);
try { $service->generate($input,'zh-CN','ja-JP'); throw new RuntimeException('localized corruption accepted'); } catch (Illuminate\Validation\ValidationException $e) { $checks++; }
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response(['error'=>['message'=>'secret upstream']],429)]);
try { $service->generate('Test','en-US','ja-JP'); throw new RuntimeException('rate limit accepted'); } catch (Illuminate\Validation\ValidationException $e) { $assert(strpos(json_encode($e->errors()),'secret upstream')===false,'upstream details hidden'); }
config(['plan-translation.key'=>'']);
try { $service->generate('Test','en-US','ja-JP'); throw new RuntimeException('missing key accepted'); } catch (Illuminate\Validation\ValidationException $e) { $checks++; }
if (app()->environment('local')) {
    // Exercise the additive migration on a separate in-memory legacy schema, never the configured DB.
    config(['database.connections.plan_translation_migration_test'=>['driver'=>'sqlite','database'=>':memory:','prefix'=>'','foreign_key_constraints'=>true]]);
    $migrationConnection=Illuminate\Support\Facades\DB::connection('plan_translation_migration_test');
    $originalSchema=Illuminate\Support\Facades\Schema::getFacadeRoot();
    Illuminate\Support\Facades\Schema::swap($migrationConnection->getSchemaBuilder());
    try {
        Illuminate\Support\Facades\Schema::create('v2_plan_translation',static function (Illuminate\Database\Schema\Blueprint $table) {
            $table->increments('id'); $table->integer('plan_id'); $table->string('locale',16);
            $table->string('name',255)->nullable(); $table->text('content')->nullable();
            $table->integer('created_at'); $table->integer('updated_at');
            $table->unique(['plan_id','locale']);
        });
        $migrationConnection->table('v2_plan_translation')->insert(['plan_id'=>2,'locale'=>'en-US','name'=>'Existing name','content'=>'Existing description','created_at'=>1,'updated_at'=>1]);
        $migration=require __DIR__.'/../database/migrations/2026_10_30_000001_track_plan_translation_sources.php';
        $migration->up();
        foreach (['name_source_hash','content_source_hash','name_origin','content_origin'] as $column) {
            $assert(Illuminate\Support\Facades\Schema::hasColumn('v2_plan_translation',$column),'upgrade adds source metadata '.$column);
        }
        $row=$migrationConnection->table('v2_plan_translation')->first();
        $assert($row->name==='Existing name' && $row->content==='Existing description' && $row->name_source_hash===null && $row->content_source_hash===null && $row->name_origin===null && $row->content_origin===null,'upgrade preserves historical text without inventing provenance');
        $migration->up();
        $assert($migrationConnection->table('v2_plan_translation')->count()===1,'repeated source metadata migration is idempotent');
    } finally {
        Illuminate\Support\Facades\Schema::swap($originalSchema);
        Illuminate\Support\Facades\DB::purge('plan_translation_migration_test');
    }
    Illuminate\Support\Facades\DB::beginTransaction();
    try {
        $plan = App\Models\Plan::firstOrFail();
        App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->delete();
        $controller = new App\Http\Controllers\V1\Admin\PlanI18nController;
        $body = ['plan_id'=>$plan->id, 'locale'=>'en-US', 'name'=>'Test name', 'content'=>'Test translation', 'only_missing'=>true, 'source_hash'=>hash('sha256',(string)$plan->content)];
        $request = Illuminate\Http\Request::create('/','POST',$body);
        $assert($controller->save($request)->getOriginalContent()['data']===true,'save missing translation');
        $legacyRow = App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->first();
        $assert($legacyRow->content_source_hash===hash('sha256',(string)$plan->content) && $legacyRow->content_origin==='machine','legacy missing save records source provenance');
        $assert($legacyRow->name===null,'legacy automatic save does not duplicate the source name');
        $body['content']='Do not overwrite';
        $assert($controller->save(Illuminate\Http\Request::create('/','POST',$body))->getOriginalContent()['data']===false,'preserve existing translation');
        $assert(App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->first()->content==='Test translation','existing text preserved');
        $body['source_hash']=str_repeat('0',64);
        try { $controller->save(Illuminate\Http\Request::create('/','POST',$body)); throw new RuntimeException('stale source accepted'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,'stale source rejected'); }

        $plan = App\Models\Plan::create(['name'=>'Source plan','content'=>'50 GB source description','group_id'=>1,'transfer_enable'=>50,'month_price'=>1000,'show'=>1,'renew'=>1]);
        $fetch = static fn () => $controller->fetch(Illuminate\Http\Request::create('/','GET',['plan_id'=>$plan->id]))->getOriginalContent()['data'];
        $save = static fn (array $values) => $controller->save(Illuminate\Http\Request::create('/','POST',$values))->getOriginalContent()['data'];
        $generate = static fn (array $values) => $controller->generate(Illuminate\Http\Request::create('/','POST',$values))->getOriginalContent()['data'];
        $expectConflict = static function (callable $operation, string $label) use ($assert) {
            try { $operation(); throw new RuntimeException($label.' accepted'); }
            catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,$label); }
        };
        $expectInvalid = static function (callable $operation, string $label) use ($assert) {
            try { $operation(); throw new RuntimeException($label.' accepted'); }
            catch (Illuminate\Validation\ValidationException $e) { $assert(count($e->errors())>0,$label); }
        };
        $state = $fetch();
        $assert($state['source_language']==='zh-CN' && !isset($state['translations']['zh-CN']),'source locale only exposes the authoritative plan');
        $assert($state['translations']['en-US']['fields']['name']['status']==='inherited' && $state['translations']['en-US']['fields']['content']['status']==='missing','missing name inherits and missing content is actionable');
        $assert(strlen($state['translations']['en-US']['version'])===64 && $state['source_hashes']['name']===hash('sha256','Source plan'),'fetch includes source and target versions');
        App\Models\PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'zh-CN','name'=>'Old shadow','content'=>'Old shadow content']);
        $assert(!isset($fetch()['translations']['zh-CN']),'historical source shadow is not editable');
        $expectInvalid(fn () => $save(['plan_id'=>$plan->id,'locale'=>'zh-CN','only_missing'=>true,'content'=>'Shadow','source_hash'=>$state['source_hashes']['content']]),'source language cannot be saved as translation');
        $expectInvalid(fn () => $generate(['plan_id'=>$plan->id,'source'=>'zh-CN','locale'=>'zh-CN']),'source language does not consume translator requests');
        $expectInvalid(fn () => $generate(['plan_id'=>$plan->id,'source'=>'en-US','locale'=>'ja-JP']),'translation source is fixed to the authoritative language');
        $expectInvalid(fn () => $save(['plan_id'=>$plan->id,'locale'=>'en-US','content'=>'Unguarded']),'manual saves require version guards');

        $legacy = App\Models\PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'en-US','name'=>'Human brand','content'=>'Historical description']);
        $state = $fetch();
        $assert($state['translations']['en-US']['fields']['content']===['status'=>'unverified','origin'=>'unknown'],'legacy translations are not silently endorsed');
        $legacy->content_source_hash=$state['source_hashes']['content'];
        $legacy->save();
        $assert($fetch()['translations']['en-US']['fields']['content']['status']==='unverified','fingerprint without provenance is still unverified');
        $legacy->content_origin='manual';
        $legacy->name_source_hash=$state['source_hashes']['name'];
        $legacy->name_origin='manual';
        $legacy->save();
        $state=$fetch();
        $assert($state['translations']['en-US']['fields']['content']===['status'=>'current','origin'=>'manual'],'reviewed manual translation is current');
        $beforeNameVersion=$state['translations']['en-US']['version'];
        $values=['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['content'],'content'=>'Updated 50 GB description','source_hashes'=>$state['source_hashes'],'translation_version'=>$beforeNameVersion,'origins'=>['content'=>'machine']];
        $assert($save($values)===true,'guarded content update accepted');
        $updated=$legacy->fresh();
        $assert($updated->name==='Human brand' && $updated->name_origin==='manual' && $updated->name_source_hash===$state['source_hashes']['name'],'description update preserves independent manual name');
        $assert($updated->content_origin==='machine' && $fetch()['translations']['en-US']['fields']['content']['status']==='current','saved machine candidate tracks source');
        $expectConflict(fn () => $save($values),'stale target version rejected even within one timestamp second');

        $state=$fetch();
        $values['translation_version']=$state['translations']['en-US']['version'];
        $values['source_hashes']=$state['source_hashes'];
        $plan->name='Changed source brand';
        $plan->save();
        $assert($save($values)===true,'unrelated source name change does not invalidate a description-only draft');
        $assert($fetch()['translations']['en-US']['fields']['name']['status']==='outdated','name freshness changes independently');
        $state=$fetch();
        $values['translation_version']=$state['translations']['en-US']['version'];
        $values['source_hashes']=$state['source_hashes'];
        $plan->content='100 GB changed source';
        $plan->save();
        $expectConflict(fn () => $save($values),'changed source description rejects stale candidate');
        $assert($fetch()['translations']['en-US']['fields']['content']['status']==='outdated','source change marks existing machine translation outdated');
        $state=$fetch();
        $both=['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['name','content'],'name'=>'New name','content'=>'New content','source_hashes'=>$state['source_hashes'],'translation_version'=>$state['translations']['en-US']['version']];
        $both['source_hashes']['name']=str_repeat('0',64);
        $expectConflict(fn () => $save($both),'multi-field save is atomic on a stale source');
        $assert($legacy->fresh()->name==='Human brand' && $legacy->fresh()->content==='Updated 50 GB description','failed multi-field save preserves both fields');
        $expectInvalid(fn () => $save(['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['content'],'content'=>'Missing hash','source_hashes'=>['name'=>$state['source_hashes']['name']],'translation_version'=>$state['translations']['en-US']['version']]),'selected field requires its own fingerprint');

        config(['plan-translation.key'=>'test-key']);
        Http::swap(new Illuminate\Http\Client\Factory);
        Http::fake(['*'=>Http::response([['translations'=>[['text'=>'100 GB translated description']]]],200)]);
        $draft=$generate(['plan_id'=>$plan->id,'source'=>'zh-CN','locale'=>'en-US']);
        $assert($draft['fields']===['content'] && !array_key_exists('name',$draft),'automatic generation only translates description by default');
        $assert($draft['content']==='100 GB translated description' && $draft['translation_version']===$state['translations']['en-US']['version'] && $draft['source_hashes']['content']===hash('sha256','100 GB changed source'),'generated draft binds to source and existing translation snapshots');
        Http::swap(new Illuminate\Http\Client\Factory);
        Http::fake(['*'=>Http::response([['translations'=>[['text'=>'Translated brand']]]],200)]);
        $nameDraft=$generate(['plan_id'=>$plan->id,'source'=>'zh-CN','locale'=>'ja-JP','fields'=>['name']]);
        $assert($nameDraft['name']==='Translated brand' && !array_key_exists('content',$nameDraft),'name is translated only on explicit request');
        $assert(Http::recorded(static fn ($request) => strpos($request->url(),'textType=plain')!==false)->count()===1,'name uses plain-text translation');
        Http::swap(new Illuminate\Http\Client\Factory);
        Http::fake(['*'=>static function () use ($plan) {
            App\Models\Plan::where('id',$plan->id)->update(['content'=>'200 GB newest source']);
            return Http::response([['translations'=>[['text'=>'100 GB translated description']]]],200);
        }]);
        $racing=$generate(['plan_id'=>$plan->id,'source'=>'zh-CN','locale'=>'en-US']);
        $racing['plan_id']=$plan->id;
        $racing['locale']='en-US';
        $expectConflict(fn () => $save($racing),'source changed during external translation cannot be published');

        $state=$fetch();
        $clear=['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['content'],'content'=>'','source_hashes'=>$state['source_hashes'],'translation_version'=>$state['translations']['en-US']['version']];
        $assert($save($clear)===true && $legacy->fresh()->content_source_hash===null && $legacy->fresh()->content_origin===null && $legacy->fresh()->name==='Human brand','clearing one field clears only its provenance');
        $state=$fetch();
        $clear=['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['name'],'name'=>null,'source_hashes'=>$state['source_hashes'],'translation_version'=>$state['translations']['en-US']['version']];
        $assert($save($clear)===true && !App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->exists(),'clearing final field removes the empty translation record');

        $plan->refresh();
        $legacy=App\Models\PlanTranslation::create(['plan_id'=>$plan->id,'locale'=>'en-US','name'=>'Legacy human brand','content'=>'Legacy human description']);
        $state=$fetch();
        $beforeEdit=['plan_id'=>$plan->id,'locale'=>'en-US','fields'=>['content'],'content'=>'Reviewed prior description','source_hashes'=>$state['source_hashes'],'translation_version'=>$state['translations']['en-US']['version']];
        $planSave=static function (array $values) {
            $request=App\Http\Requests\Admin\PlanSave::create('/','POST',$values);
            $request->setContainer(app())->setRedirector(app('redirect'));
            $request->validateResolved();
            return (new App\Http\Controllers\V1\Admin\PlanController)->save($request)->getOriginalContent();
        };
        $sourceValues=['id'=>$plan->id,'name'=>$plan->name,'content'=>'300 GB revised source','group_id'=>1,'transfer_enable'=>300,'month_price'=>1000];
        $savedSource=$planSave($sourceValues);
        $assert($savedSource['data']===true && $savedSource['meta']['plan_id']===$plan->id && $savedSource['meta']['translation_source_changed']===true,'real plan save reports changed translation source');
        $legacy->refresh();
        $assert($legacy->content_source_hash===$state['source_hashes']['content'] && $legacy->name_source_hash===null && $legacy->content_origin===null,'real source edit captures only the changed legacy field and retains unknown provenance');
        $assert($fetch()['translations']['en-US']['fields']['content']['status']==='outdated' && $fetch()['translations']['en-US']['fields']['name']['status']==='unverified','first source edit reliably invalidates only matching legacy field');
        $expectConflict(fn () => $save($beforeEdit),'real source edit rejects an earlier manual editor snapshot');
        $oldContentHash=$legacy->content_source_hash;
        $sourceValues['name']='Renamed source plan';
        $planSave($sourceValues);
        $legacy->refresh();
        $assert($legacy->name_source_hash===$state['source_hashes']['name'] && $legacy->content_source_hash===$oldContentHash,'source name edit independently captures old name without rebasing outdated description');
        $beforePriceVersion=App\Services\PlanTranslationState::version($legacy);
        $sourceValues['month_price']=2000;
        $priceOnly=$planSave($sourceValues);
        $assert($priceOnly['meta']['translation_source_changed']===false && App\Services\PlanTranslationState::version($legacy->fresh())===$beforePriceVersion,'price-only update does not invalidate or rewrite translations');
    } finally { Illuminate\Support\Facades\DB::rollBack(); }
}
echo "PASS: {$checks} translation checks\n";
