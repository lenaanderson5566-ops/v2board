<?php
require __DIR__.'/../vendor/autoload.php';
use App\Http\Middleware\CORS;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\JsonResponse;

$n=0;
foreach ([['Origin'=>'https://example.com'], ['Referer'=>'https://example.com/app'], []] as $headers) {
    $request=Request::create('/client-mirrors/test');
    foreach ($headers as $key=>$value) $request->headers->set($key,$value);
    $file=new BinaryFileResponse(__FILE__);
    $file->setContentDisposition('attachment','installer.bin');
    foreach ([$file,new StreamedResponse(function(){echo 'stream';}),new Response('page'),new JsonResponse(['ok'=>true])] as $response) {
        $result=(new CORS)->handle($request,fn()=>$response);
        if ($result!==$response || $result->headers->get('Access-Control-Allow-Origin')!==($headers?'https://example.com':'')
            || $result->headers->get('Access-Control-Allow-Methods')!=='GET,POST,OPTIONS,HEAD') throw new RuntimeException('CORS response regression');
        if ($result instanceof BinaryFileResponse && (!str_contains($result->headers->get('Content-Disposition'),'installer.bin') || $result->getFile()->getPathname()!==__FILE__)) throw new RuntimeException('Download changed');
        $n++;
    }
}
echo "PASS: {$n} CORS response checks\n";
