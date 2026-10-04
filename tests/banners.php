<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use App\Models\Banner;
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
$checks=0;$assert=function($ok,$msg)use(&$checks){if(!$ok)throw new RuntimeException($msg);$checks++;};
$admin=new App\Http\Controllers\V1\Admin\BannerController;
$guest=new App\Services\Actions\Guest\BannerActions;
$base=['title'=>'测试','image_url'=>'/banners/fastdog-3-launch.png','placements'=>['dashboard'],'languages'=>[],'sort'=>0,'show'=>true];
DB::beginTransaction();
try {
 Banner::query()->delete();
 foreach(['javascript:alert(1)','//evil.test/a','/%2Fevil.test','https://user:pass@example.test/a','/foo%0abar','https://example.test/\\x'] as $url){
  try{$admin->save(Request::create('/','POST',array_replace($base,['target_url'=>$url])));throw new RuntimeException('Unsafe URL accepted: '.$url);}catch(Illuminate\Validation\ValidationException $e){$checks++;}
 }
 foreach([['placements'=>[]],['languages'=>['xx']],['starts_at'=>100,'ends_at'=>99]] as $bad){try{$admin->save(Request::create('/','POST',array_replace($base,$bad)));throw new RuntimeException('Invalid settings accepted');}catch(Illuminate\Validation\ValidationException $e){$checks++;}}
 $id=$admin->save(Request::create('/','POST',$base))->getOriginalContent()['data']->id;
 foreach([['title'=>'hidden','show'=>false],['title'=>'future','starts_at'=>time()+3600],['title'=>'expired','ends_at'=>time()-1],['title'=>'landing','placements'=>['landing']],['title'=>'English','languages'=>['en-US']]] as $extra){$admin->save(Request::create('/','POST',array_replace($base,$extra)));}
 $fetch=function($lang='zh-CN')use($guest){$r=Request::create('/','GET',['placement'=>'dashboard']);$r->headers->set('Content-Language',$lang);return json_decode($guest->fetch($r)->getContent(),true)['data'];};
 $assert(count($fetch())===1,'Schedule, language or placement filtering failed');
 $assert(count($fetch('en-US'))===2,'English filter failed');
 $assert(!isset($fetch()[0]['languages']),'Admin metadata exposed');
 $admin->show(Request::create('/','POST',['id'=>$id,'show'=>false]));$assert(count($fetch())===0,'Disable failed');
 $admin->show(Request::create('/','POST',['id'=>$id,'show'=>true]));
 for($i=1;$i<=8;$i++)$admin->save(Request::create('/','POST',array_replace($base,['title'=>'row'.$i,'sort'=>$i])));
 $assert(count($fetch())===6 && $fetch()[0]['id']===$id,'Limit or sorting failed');
 $admin->drop(Request::create('/','POST',['id'=>$id]));$assert(!Banner::find($id),'Delete failed');
 $before=Banner::count();(require __DIR__.'/../database/migrations/2026_10_03_000002_create_banners.php')->up();$assert(Banner::count()===$before,'Repeated migration reseeded banners');
} finally {DB::rollBack();}
Storage::fake('local');
$file=new Illuminate\Http\UploadedFile(public_path('banners/fastdog-3-launch.png'),'banner.png','image/png',null,true);
$r=Request::create('/','POST');$r->files->set('image',$file);
$url=$admin->upload($r)->getOriginalContent()['data']['url'];$name=basename($url);
$assert(Storage::disk('local')->exists('banners/'.$name),'Uploaded image missing');
$assert($guest->image($name)->headers->get('X-Content-Type-Options')==='nosniff','Image response missing nosniff');
try{$guest->image('../.env');throw new RuntimeException('Traversal accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===404,'Traversal wrong status');}
Storage::disk('local')->delete('banners/'.$name);
$route=app('router')->getRoutes()->match(Request::create('/api/v10/public/banner-images/'.$name));
$assert(strpos($route->getActionName(),'GuestBannerController@getPublicBannerImagesName')!==false,'Image route does not match');
$oldImage=new Banner(['image_url'=>'/api/v1/guest/banner/image/'.$name]);
$assert($oldImage->image_url==='/api/v10/public/banner-images/'.$name,'Existing banner image URL must follow the new route');
$assert(in_array('admin',app('router')->getRoutes()->match(Request::create('/api/v1/'.config('v2board.secure_path','admin').'/banner/fetch'))->gatherMiddleware()),'Banner management lacks admin authorization');
echo "PASS: $checks banner checks\n";
