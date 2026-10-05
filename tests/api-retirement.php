<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$checks=0;
$assert=function($ok,$label)use(&$checks){if(!$ok)throw new RuntimeException($label);$checks++;};
$call=function($method,$path,$headers=[])use($app){
    $request=Illuminate\Http\Request::create($path,$method,[],[],[],array_merge(['HTTP_ACCEPT'=>'application/json','HTTP_USER_AGENT'=>'API-retirement-test'],$headers));
    $app->instance('request',$request);
    return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
};
$allow=json_decode(file_get_contents(base_path('docs/api-v10/retained-legacy.json')),true);
$entries=json_decode(file_get_contents(base_path('docs/api-v10/endpoints.json')),true);
foreach($entries as $entry){
    if(isset($entry['key']))continue;
    $old='api/v1/'.$entry['legacy'];
    if(in_array($old,$allow,true))continue;
    $path='/'.preg_replace('/\{[^}]+\}/','1',$old);
    $assert($call($entry['legacyMethod'],$path)->getStatusCode()===404,'Retired route still resolves: '.$path);
}
$assert($call('GET','/api/v1/user/resetSecurity')->getStatusCode()===404,'Retired GET credential rotation remains');
// Retired wrappers must not return as unregistered dead code.
foreach (['User'=>['UserController.php'], 'Passport'=>['AuthController.php','CommController.php'], 'Guest'=>['PaymentController.php','TelegramController.php']] as $area=>$keep) {
    foreach (glob(app_path('Http/Controllers/V1/'.$area.'/*Controller.php')) as $file) {
        $assert(in_array(basename($file),$keep,true),'Unused legacy controller: '.basename($file));
    }
}
foreach ([App\Http\Controllers\V1\User\UserController::class=>['info','update','logout'], App\Http\Controllers\V1\Passport\AuthController::class=>['login','register','forget'], App\Http\Controllers\V1\Passport\CommController::class=>['sendEmailVerify']] as $class=>$keep) {
    foreach ((new ReflectionClass($class))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
        if ($method->getDeclaringClass()->getName()===$class) $assert(in_array($method->getName(),$keep,true),'Unused legacy wrapper: '.$method->getName());
    }
}
$dir=sys_get_temp_dir().'/v10-mirror-'.bin2hex(random_bytes(6));mkdir($dir);
$id=(string)Illuminate\Support\Str::uuid();
$service=new class($dir) extends App\Services\ClientMirrorService {
    private $testDirectory;
    public function __construct($dir){$this->testDirectory=$dir;}
    public function directory():string{return $this->testDirectory;}
};
$app->instance(App\Services\ClientMirrorService::class,$service);
try{
    file_put_contents($dir.'/'.$id.'.bin','installer-fixture');
    $manifest=['items'=>[$id=>['name'=>'client-universal.apk','status'=>'ready']],'published'=>['cmfa_android'=>$id]];
    file_put_contents($dir.'/manifest.json',json_encode($manifest));
    $before=file_get_contents($dir.'/manifest.json');
    $url='/api/v10/public/client-installers/'.$id.'/content';
    $r=$call('GET',$url);
    $assert($r instanceof Symfony\Component\HttpFoundation\BinaryFileResponse && $r->getStatusCode()===200,'Download must be a native file response');
    $assert(str_contains($r->headers->get('Content-Disposition'),'client-universal.apk') && $r->headers->get('X-Content-Type-Options')==='nosniff','Download headers');
    $assert($r->headers->has('X-Request-ID'),'Download request identifier');
    $assert(file_get_contents($dir.'/manifest.json')===$before,'GET download must not write manifest');
    $assert($call('HEAD',$url)->getStatusCode()===200,'HEAD download');
    $assert($call('GET',$url,['HTTP_RANGE'=>'bytes=0-3'])->getStatusCode()===206,'Range download');
    $assert($call('GET','/client-mirrors/'.$id)->getStatusCode()===404,'Old mirror download must be removed');
    $r=$call('GET','/api/v10/public/client-installers/not-a-uuid/content');
    $assert($r->getStatusCode()===404 && str_contains($r->headers->get('Content-Type'),'application/problem+json'),'Invalid installer ID must return problem details');
    $manifest['published']=[];file_put_contents($dir.'/manifest.json',json_encode($manifest));
    $assert($call('GET',$url)->getStatusCode()===404,'Unpublished installer must not download');
}finally{
    $app->forgetInstance(App\Services\ClientMirrorService::class);
    foreach(glob($dir.'/*') as $file)unlink($file);
    rmdir($dir);
}
echo "API retirement/download: {$checks} checks passed\n";
