<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use App\Http\Controllers\V1\Admin\ContentTranslationController;
use App\Services\ProductMail;
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
$checks=0;
$assert=function($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
config(['plan-translation.url'=>'https://translator.example.test','plan-translation.key'=>'fake-key','v2board.app_url'=>'https://app.example.test']);
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'維護通知']]],['translations'=>[['text'=>'<p>10 分鐘，<a href="https://example.test">詳情</a></p>']]]],200)]);
$request=Illuminate\Http\Request::create('/', 'POST', ['source'=>'zh-CN','locale'=>'zh-TW','subject'=>'维护通知','content'=>'<p>10 分钟，<a href="https://example.test">详情</a></p>','format'=>'html']);
$result=(new ContentTranslationController)->generate($request)->getOriginalContent()['data'];
$assert($result['subject']==='維護通知','Traditional subject missing');
$assert(strpos($result['content'],'詳情')!==false,'Traditional body missing');
$assert(Http::recorded(function($r) { return strpos($r->url(),'to=zh-Hant')!==false && count($r->data())===2; })->count()===1,'Title/body must share one bounded request');
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(['*'=>Http::response([['translations'=>[['text'=>'Maintenance']]],['translations'=>[['text'=>'<p>10 min https://evil.test</p>']]]],200)]);
try { (new ContentTranslationController)->generate($request); throw new RuntimeException('Altered link accepted'); } catch (Illuminate\Validation\ValidationException $e) { $checks++; }
$rules=(new App\Http\Requests\Admin\NoticeSave)->rules();
$assert(validator(['title'=>'Title','content'=>'Body','translations'=>['xx'=>['subject'=>'x','content'=>'y']]],$rules)->fails(),'Unknown notice locale accepted');
$assert(validator(['title'=>'Title','content'=>'Body','translations'=>['en-US'=>['subject'=>'x']]],$rules)->fails(),'Partial notice accepted');
DB::beginTransaction();
try {
    $notice=App\Models\Notice::create(['title'=>'原文','content'=>'正文','show'=>1,'translations'=>['zh-TW'=>['subject'=>'繁體標題','content'=>'繁體正文']]]);
    $controller=new App\Http\Controllers\V1\User\NoticeController;
    foreach (['zh-TW','zh_Hant','en-US'] as $locale) {
        $req=Illuminate\Http\Request::create('/', 'GET', ['id'=>$notice->id]); $req->headers->set('Content-Language',$locale);
        $data=json_decode($controller->fetch($req)->getContent(),true)['data'];
        $assert($data['title']===($locale==='en-US'?'原文':'繁體標題'),'Notice locale selection failed');
        $assert(!isset($data['translations']),'All variants exposed to user');
    }
    $mail=new ProductMail;
    $base=['template_name'=>'notify','language'=>'ja-JP','source_language'=>'en-US','subject'=>'Update','template_value'=>['content'=>'<p>Maintenance details</p>']];
    $data=$mail->data($base);
    $assert($data['language']==='en-US' && $data['body']==='' && strpos($data['preheader'],'Maintenance')!==false,'Fallback language/duplicate boilerplate incorrect');
    $data=$mail->data($base+['translations'=>['ja-JP'=>['subject'=>'お知らせ','content'=>'詳細']]]);
    $assert($data['language']==='ja-JP' && $data['subject']==='お知らせ','Stored language variant ignored');
} finally { DB::rollBack(); }
echo "PASS: $checks content translation checks\n";
