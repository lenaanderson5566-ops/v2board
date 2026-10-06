<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;

class V10
{
    public function handle($request, Closure $next)
    {
        $started=microtime(true); $requestId=(string)Str::uuid();
        $request->attributes->set('requestId',$requestId);
        $request->attributes->set('v10.requestedAccept', (string)$request->header('Accept'));
        if (!$request->is('api/v10/webhooks/*')) $request->headers->set('Accept','application/json');
        $language='zh-CN'; $candidates=[];
        foreach (explode(',',(string)$request->header('Accept-Language')) as $index=>$candidate) {
            $parts=explode(';',$candidate); $quality=1.0;
            foreach (array_slice($parts,1) as $parameter) if (preg_match('/^\s*q=([0-9.]+)\s*$/',$parameter,$matches)) $quality=(float)$matches[1];
            $normalized=\App\Services\ProductMail::language(trim($parts[0]));
            if ($normalized && $quality>0 && $quality<=1) $candidates[]=['language'=>$normalized,'quality'=>$quality,'index'=>$index];
        }
        usort($candidates,function($a,$b) { return ($b['quality'] <=> $a['quality']) ?: ($a['index'] <=> $b['index']); });
        if ($candidates) $language=$candidates[0]['language'];
        $request->attributes->set('v10.negotiatedLanguage', $candidates ? $language : null);
        app()->setLocale($language);
        $raw=$request->is('api/v10/webhooks/*');
        try {
            $response=$next($request);
            if (!$raw && $response->getStatusCode() >= 400) {
                $payload=json_decode($response->getContent(),true) ?: [];
                if (!$response->headers->contains('Content-Type','application/problem+json')) {
                    $response=$this->problem($response->getStatusCode(), $response->getStatusCode() >= 500 ? 'The service could not complete the request.' : ($payload['message'] ?? 'The request could not be completed.'), $requestId, $payload['code'] ?? null, $payload['errors'] ?? []);
                }
            }
        } catch (\Throwable $e) {
            $status=$e instanceof \Illuminate\Validation\ValidationException ? 422 : ($e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException ? 404 : (method_exists($e,'getStatusCode') ? $e->getStatusCode() : 500));
            if ($e instanceof \Illuminate\Http\Exceptions\HttpResponseException) {
                $original=$e->getResponse();$status=$original->getStatusCode();$payload=json_decode($original->getContent(),true) ?: [];
            } else $payload=[];
            if ($raw) $response=response('fail',$status);
            else $response=$this->problem($status, $status>=500 ? 'The service could not complete the request.' : ($payload['message'] ?? $e->getMessage()),$requestId,$payload['code'] ?? null,$e instanceof \Illuminate\Validation\ValidationException ? $e->errors() : ($payload['errors'] ?? []));
            if ($status>=500) Log::error('V10 request failed',['requestId'=>$requestId,'exceptionClass'=>get_class($e)]);
        }
        $response->headers->set('X-Request-ID',$requestId);
        $response->headers->set('Content-Language',app()->getLocale());
        if ($request->is('api/v10/auth/*','api/v10/me/*','api/v10/subscriptions/*')) $response->headers->set('Cache-Control','private, no-store');
        $context=['version'=>'v10','requestId'=>$requestId,'route'=>$request->route() ? $request->route()->uri() : 'unmatched','method'=>$request->method(),'status'=>$response->getStatusCode(),'durationMs'=>(int)round((microtime(true)-$started)*1000)];
        if ($request->is('api/v10/me/client-config')) {
            $problem=$response->getStatusCode()>=400 ? json_decode($response->getContent(),true) : [];
            $context+=['userId'=>$request->attributes->get('v10.userId'), 'clientVersion'=>$request->attributes->get('client.version'), 'platform'=>$request->attributes->get('client.platform'), 'outcome'=>$response->getStatusCode()<300 ? 'success' : 'failed', 'code'=>$problem['code'] ?? null];
        }
        Log::info($request->is('api/v10/me/client-config') ? 'Client configuration request' : 'API request',$context);
        return $response;
    }
    public function exceptionResponse($request, \Throwable $e)
    {
        $status=$e instanceof \Illuminate\Validation\ValidationException ? 422 : ($e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException ? 404 : (method_exists($e,'getStatusCode') ? $e->getStatusCode() : 500));
        $payload=[];
        if ($e instanceof \Illuminate\Http\Exceptions\HttpResponseException) {
            $original=$e->getResponse(); $status=$original->getStatusCode();
            $payload=json_decode($original->getContent(),true) ?: [];
        }
        if ($request->is('api/v10/webhooks/*')) return response('fail',$status);
        $errors=$e instanceof \Illuminate\Validation\ValidationException ? $e->errors() : ($payload['errors'] ?? []);
        $contract=$request->attributes->get('v10.contract',[]);
        $names=array_flip($contract['input'] ?? []);
        $publicErrors=[];
        foreach ($errors as $field=>$messages) $publicErrors[$names[$field] ?? $field]=$messages;
        $response=$this->problem($status,$status>=500 ? 'The service could not complete the request.' : ($payload['message'] ?? $e->getMessage()),$request->attributes->get('requestId'),$payload['code'] ?? null,$publicErrors);
        if (method_exists($e,'getHeaders')) foreach ($e->getHeaders() as $name=>$value) $response->headers->set($name,$value);
        return $response;
    }
    private function problem($status,$detail,$requestId,$code=null,$errors=[])
    {
        $names=[401=>'Unauthenticated',403=>'Forbidden',404=>'Not found',409=>'Conflict',410=>'Gone',422=>'Validation failed',429=>'Too many requests',500=>'Internal server error',503=>'Service unavailable'];
        $codes=[401=>'UNAUTHENTICATED',403=>'FORBIDDEN',404=>'NOT_FOUND',409=>'CONFLICT',410=>'GONE',422=>'VALIDATION_FAILED',429=>'RATE_LIMITED',500=>'INTERNAL_ERROR',503=>'UNAVAILABLE'];
        $response=response()->json(['type'=>'about:blank','title'=>$names[$status] ?? 'Request failed','status'=>$status,'detail'=>$detail ?: ($names[$status] ?? 'Request failed'),'code'=>$code ?? ($codes[$status] ?? 'REQUEST_FAILED'),'requestId'=>$requestId,'errors'=>(object)$errors],$status,['Content-Type'=>'application/problem+json']);
        if ($status===401) $response->headers->set('WWW-Authenticate','Bearer');
        return $response;
    }
}
