<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\Http;
use App\Services\PlanAutoTranslation;
config(['plan-translation.url'=>'https://translator.example.test', 'plan-translation.key'=>'test-key', 'plan-translation.region'=>'test-region']);
$checks = 0;
$assert = function ($ok, $message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
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
    Illuminate\Support\Facades\DB::beginTransaction();
    try {
        $plan = App\Models\Plan::firstOrFail();
        App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->delete();
        $controller = new App\Http\Controllers\V1\Admin\PlanI18nController;
        $body = ['plan_id'=>$plan->id, 'locale'=>'en-US', 'name'=>'Test name', 'content'=>'Test translation', 'only_missing'=>true, 'source_hash'=>hash('sha256',(string)$plan->content)];
        $request = Illuminate\Http\Request::create('/','POST',$body);
        $assert($controller->save($request)->getOriginalContent()['data']===true,'save missing translation');
        $body['content']='Do not overwrite';
        $assert($controller->save(Illuminate\Http\Request::create('/','POST',$body))->getOriginalContent()['data']===false,'preserve existing translation');
        $assert(App\Models\PlanTranslation::where('plan_id',$plan->id)->where('locale','en-US')->first()->content==='Test translation','existing text preserved');
        $body['source_hash']=str_repeat('0',64);
        try { $controller->save(Illuminate\Http\Request::create('/','POST',$body)); throw new RuntimeException('stale source accepted'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,'stale source rejected'); }
    } finally { Illuminate\Support\Facades\DB::rollBack(); }
}
echo "PASS: {$checks} translation checks\n";
