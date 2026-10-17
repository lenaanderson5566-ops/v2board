<?php
namespace App\Http\Controllers\V10;

use App\Services\ProductAnalytics;
use App\Http\Middleware\BrowserOrigins;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

final class ProductAnalyticsController extends \App\Http\Controllers\Controller {
    public function configuration(ProductAnalytics $service) {
        $settings=$service->settings();
        return response()->json(['data'=>['enabled'=>$settings['enabled'] && $service->ready(),'retentionDays'=>$settings['retentionDays']]])->header('Cache-Control','no-store');
    }
    public function store(Request $request, ProductAnalytics $service) {
        abort_unless(app(BrowserOrigins::class)->allows($request,$request->header('Origin')),403,'Origin is not allowed.');
        abort_if(strlen($request->getContent())>1024,413,'Event is too large.');
        abort_unless($request->isJson(),415,'JSON is required.');
        abort_if($request->query->count()>0,422,'Query parameters are not accepted.');
        abort_if(array_diff(array_keys($request->all()),['sessionId','page','device','language','consent','attributionVersion','sourceDomain']),422,'Unknown event field.');
        $event=$request->validate(['sessionId'=>'required|uuid','page'=>'required|in:'.implode(',',ProductAnalytics::PAGES),
            'device'=>'required|in:desktop,mobile,tablet','language'=>'required|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR,es-ES,pt-BR,fr-FR,de-DE,id-ID,th-TH', 'consent'=>'required|accepted',
            'attributionVersion'=>'sometimes|integer|in:1',
            'sourceDomain'=>['sometimes','string','max:253','regex:/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D', function ($attribute, $value, $fail) { if (preg_match('/\.(local|localhost|internal|test|invalid)$/D', $value)) $fail('Public domain required.'); }]]);
        if ($request->header('Sec-GPC')==='1' || $request->header('DNT')==='1' || !$service->settings()['enabled']) return response('',204);
        abort_unless($service->ready(),503,'Analytics migration is required.');
        abort_if(RateLimiter::tooManyAttempts('product-analytics-global',30000),429,'Collection is temporarily limited.');
        RateLimiter::hit('product-analytics-global',3600);
        $service->record($event);
        return response('',204)->header('Cache-Control','no-store');
    }
}
