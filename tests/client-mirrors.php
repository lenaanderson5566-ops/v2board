<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('local'))throw new RuntimeException('Local test only');
use App\Services\ClientMirrorService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Http\Request;
class TestMirrorService extends ClientMirrorService {
 public $dir; public $body='test-package';
 public function directory():string{return $this->dir;}
 protected function httpClient(){return new class($this->body) {
  private $body; function __construct($b){$this->body=$b;}
  function get($url,$options){file_put_contents($options['sink'],$this->body);return new GuzzleHttp\Psr7\Response(200);}
 };}
}
$s=new TestMirrorService;$s->dir=sys_get_temp_dir().'/mirror-test-'.bin2hex(random_bytes(6));mkdir($s->dir);
$old=Cache::get('client-release:cmfa');$n=0;
$assert=function($v)use(&$n){$n++;if(!$v)throw new RuntimeException('Failed '.$n);};
$reject=function($fn)use($assert){try{$fn();$assert(false);}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert(in_array($e->getStatusCode(),[422,404]));}};
Queue::fake();
try {
 $asset=['id'=>1,'name'=>'universal.apk','size'=>12,'digest'=>'sha256:'.hash('sha256','test-package'),'browser_download_url'=>'https://github.com/MetaCubeX/ClashMetaForAndroid/releases/download/test/universal.apk'];
 Cache::put('client-release:cmfa',['version'=>'test','assets'=>[$asset]],60);
 $id=$s->enqueue('cmfa',1,'cmfa_android');
 $assert($s->enqueue('cmfa',1,'cmfa_android')===$id);
 $reject(fn()=>$s->action($id,'publish'));
 $s->download($id);$row=$s->listing()['items'][0];
 $assert($row['status']==='ready' && $row['verified']);
 $assert($row['sha256']===hash('sha256','test-package'));
 $s->action($id,'publish');$assert($s->listing()['published']['cmfa_android:universal']===$id);
 $asset2=$asset;$asset2['id']=2;$asset2['name']='app-arm64.apk';
 Cache::put('client-release:cmfa',['version'=>'test','assets'=>[$asset,$asset2]],60);
 $second=$s->enqueue('cmfa',2,'cmfa_android');$s->download($second);$s->action($second,'publish');
 $assert(count($s->listing()['published'])===2);
 $s->action($second,'unpublish');$s->action($second,'delete');
 $assert($s->listing()['published']['cmfa_android:universal']===$id);
 $reject(fn()=>$s->action($id,'delete'));
 $assert($s->serve($id)->headers->get('X-Content-Type-Options')==='nosniff');
 $s->action($id,'unpublish');$reject(fn()=>$s->serve($id));
 $s->action($id,'delete');$assert(!is_file($s->dir.'/'.$id.'.bin'));
 $reject(fn()=>$s->enqueue('cmfa',1,'singbox_windows'));
 $asset['digest']='sha256:'.str_repeat('0',64);Cache::put('client-release:cmfa',['version'=>'test','assets'=>[$asset]],60);
 $id=$s->enqueue('cmfa',1,'cmfa_android');$s->download($id);
 $assert($s->listing()['items'][0]['status']==='failed' && !is_file($s->dir.'/'.$id.'.bin'));
 $asset['browser_download_url']='http://127.0.0.1/private';Cache::put('client-release:cmfa',['version'=>'test','assets'=>[$asset]],60);
 $reject(fn()=>$s->enqueue('cmfa',1,'cmfa_android'));
 foreach(['http://github.com/a','https://github.com.evil.test/a','https://127.0.0.1/a','https://github.com:8443/a'] as $url)$assert(!ClientMirrorService::allowedDownloadUrl($url));
 $assert(ClientMirrorService::allowedDownloadUrl('https://release-assets.githubusercontent.com/test'));
 foreach(['client/mirrors/fetch','client/mirrors/download','client/mirrors/action'] as $path){
  $r=Request::create('/api/v1/'.config('v2board.ops_api_path','ops').'/'.$path,str_ends_with($path,'fetch')?'GET':'POST');$r->headers->set('Accept','application/json');
  $assert(app(Illuminate\Contracts\Http\Kernel::class)->handle($r)->getStatusCode()===403);
 }
 $assert(config('queue.connections.redis-mirror.retry_after')>config('horizon.environments.*.client-download.timeout'));
}finally{
 if($old===null)Cache::forget('client-release:cmfa');else Cache::forever('client-release:cmfa',$old);
 foreach(glob($s->dir.'/*') as $file)unlink($file);rmdir($s->dir);
}
echo "PASS: {$n} client mirror checks\n";
