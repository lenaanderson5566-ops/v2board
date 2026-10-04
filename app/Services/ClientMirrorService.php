<?php
namespace App\Services;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ClientMirrorService
{
    public const TARGETS = ['cmfa'=>['cmfa_android'], 'clash-verge'=>['clash_windows','clash_macos','clash_linux'],
        'flclash'=>['flclash_android','flclash_windows','flclash_macos','flclash_linux'],
        'sing-box'=>['singbox_android','singbox_windows','singbox_macos','singbox_linux']];
    public const MAX_BYTES = 536870912;
    public function directory(): string {
        $dir=storage_path('app/client-mirrors');
        if (!is_dir($dir) && !mkdir($dir,0750,true) && !is_dir($dir)) throw new \RuntimeException('无法创建镜像目录');
        return $dir;
    }
    public function state(callable $fn) {
        $dir=$this->directory(); $lock=fopen($dir.'/manifest.lock','c');
        if (!$lock || !flock($lock,LOCK_EX)) throw new \RuntimeException('无法锁定镜像目录');
        try {
            $file=$dir.'/manifest.json';
            $state=is_file($file)?json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR):['items'=>[], 'published'=>[]];
            foreach ($state['items'] as &$item) {
                if (in_array($item['status'],['queued','downloading']) && $item['updated_at']<time()-1200) {
                    $item['status']='failed'; $item['error']='任务超时或队列未运行，请检查 client-download 队列后重试';
                }
            } unset($item);
            $result=$fn($state);
            if (file_put_contents($file.'.tmp',json_encode($state,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR))===false || !rename($file.'.tmp',$file)) throw new \RuntimeException('无法保存镜像记录');
            return $result;
        } finally { flock($lock,LOCK_UN); fclose($lock); }
    }
    public function listing(): array {
        return $this->state(function (&$s) {
            return ['items'=>array_values(array_reverse($s['items'],true)), 'published'=>$s['published'], 'targets'=>self::TARGETS];
        });
    }
    public function enqueue(string $client, int $assetId, string $target): string {
        abort_unless(in_array($target,self::TARGETS[$client]??[],true),422,'不支持此客户端或系统');
        $release=Cache::get('client-release:'.$client,[]);
        $asset=collect($release['assets']??[])->firstWhere('id',$assetId);
        abort_unless($asset && !empty($release['version']),422,'请先检查官方版本，再选择安装包');
        $name=(string)$asset['name']; $size=(int)$asset['size'];
        abort_unless($size>0 && $size<=self::MAX_BYTES && preg_match('/\.(apk|exe|msi|dmg|pkg|zip|deb|rpm|AppImage|tar\.gz)$/i',$name),422,'只支持 512 MiB 以内的安装包');
        $platform=substr($target,strrpos($target,'_')+1);
        $extensions=['android'=>'/\.apk$/i','windows'=>'/\.(exe|msi|zip)$/i','macos'=>'/\.(dmg|pkg|zip)$/i','linux'=>'/\.(deb|rpm|AppImage|tar\.gz|zip)$/i'];
        abort_unless(preg_match($extensions[$platform],$name),422,'文件扩展名与目标系统不匹配');
        $url=(string)$asset['browser_download_url'];
        $prefix='https://github.com/'.ClientReleaseService::CLIENTS[$client]['repo'].'/releases/download/';
        abort_unless(str_starts_with($url,$prefix),422,'安装包必须来自对应官方仓库');
        $id=$this->state(function (&$s) use($client,$asset,$target,$release,$name,$size,$url) {
            foreach($s['items'] as $row) if($row['client']===$client && $row['asset_id']===$asset['id'] && $row['target']===$target && in_array($row['status'],['queued','downloading','ready'])) return $row['id'];
            abort_if(count($s['items'])>=100,422,'镜像记录已达 100 条，请清理未发布文件');
            $id=(string)Str::uuid();
            $s['items'][$id]=['id'=>$id,'client'=>$client,'asset_id'=>$asset['id'],'target'=>$target,'version'=>$release['version'],
                'name'=>$name,'size'=>$size,'source'=>$url,'digest'=>$asset['digest']??null,'status'=>'queued','updated_at'=>time(),'created_at'=>time()];
            return $id;
        });
        try { \App\Jobs\DownloadClientMirror::dispatch($id); }
        catch(\Throwable $e) { $this->fail($id,'无法加入下载队列，请检查 Redis / Horizon'); throw $e; }
        return $id;
    }
    public function fail(string $id,string $message): void {
        $this->state(function (&$s) use($id,$message){if(isset($s['items'][$id]) && $s['items'][$id]['status']!=='ready') {$s['items'][$id]['status']='failed';$s['items'][$id]['error']=$message;$s['items'][$id]['updated_at']=time();}});
    }
    public static function allowedDownloadUrl(string $url): bool {
        $p=parse_url($url);
        return ($p['scheme']??'')==='https' && !isset($p['user']) && !isset($p['pass']) && (!isset($p['port']) || $p['port']===443)
            && in_array($p['host']??'', ['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'],true);
    }
    protected function httpClient() { return new \GuzzleHttp\Client(); }
    public function download(string $id): void {
        $row=$this->state(function (&$s) use($id){
            if(!isset($s['items'][$id]) || $s['items'][$id]['status']!=='queued') return null;
            $s['items'][$id]['status']='downloading'; $s['items'][$id]['updated_at']=time(); return $s['items'][$id];
        });
        if(!$row)return;
        $part=$this->directory().'/'.$id.'.part'; $dest=$this->directory().'/'.$id.'.bin';
        try {
            if(disk_free_space($this->directory())<$row['size']+104857600) throw new \RuntimeException('磁盘空间不足，至少保留 100 MiB 可用空间');
            if(!self::allowedDownloadUrl($row['source'])) throw new \RuntimeException('下载来源无效');
            $client=$this->httpClient();
            $response=$client->get($row['source'],['sink'=>$part,'connect_timeout'=>10,'timeout'=>600,
                'headers'=>['User-Agent'=>'Client-Mirror-Downloader'],
                'allow_redirects'=>['max'=>4,'protocols'=>['https'],'on_redirect'=>function($request,$response,$uri){if(!self::allowedDownloadUrl((string)$uri))throw new \RuntimeException('下载重定向不属于 GitHub 官方文件域名');}],
                'progress'=>function($total,$downloaded)use($row){if($total>$row['size'] || $downloaded>$row['size'])throw new \RuntimeException('下载大小超过官方记录');}]);
            clearstatcache(true,$part);
            if($response->getStatusCode()!==200 || filesize($part)!==$row['size'])throw new \RuntimeException('文件大小校验失败');
            $sha=hash_file('sha256',$part);
            $verified=!empty($row['digest']) && preg_match('/^sha256:[a-f0-9]{64}$/i',$row['digest']);
            if($verified && !hash_equals(strtolower(substr($row['digest'],7)),$sha))throw new \RuntimeException('官方 SHA-256 校验失败');
            if(!rename($part,$dest))throw new \RuntimeException('无法保存安装包');
            $this->state(function(&$s)use($id,$sha,$verified){$s['items'][$id]['status']='ready';$s['items'][$id]['sha256']=$sha;$s['items'][$id]['verified']=(bool)$verified;$s['items'][$id]['updated_at']=time();});
        } catch(\Throwable $e) {
            if(is_file($part))unlink($part);
            $this->fail($id,$e instanceof \GuzzleHttp\Exception\GuzzleException ? '官方文件下载失败或超时，请重试' : $e->getMessage());
        }
    }
    public function action(string $id,string $action): void {
        $this->state(function(&$s)use($id,$action){
            abort_unless(isset($s['items'][$id]),404);
            $row=$s['items'][$id];$target=$row['target'];
            if($action==='publish') {
                abort_unless($row['status']==='ready' && is_file($this->directory().'/'.$id.'.bin'),422,'安装包尚未准备好');
                $s['published'][$target]=$id;
            } elseif($action==='unpublish') {
                if(($s['published'][$target]??null)===$id)unset($s['published'][$target]);
            } elseif($action==='delete') {
                abort_if(in_array($id,$s['published'],true) || in_array($row['status'],['queued','downloading']),422,'请先下架或等待任务完成');
                foreach(['bin','part'] as $ext){$path=$this->directory().'/'.$id.'.'.$ext;if(is_file($path) && !unlink($path))throw new \RuntimeException('删除失败');}
                unset($s['items'][$id]);
            }
        });
    }
    public function urls(): array {
        $file=storage_path('app/client-mirrors/manifest.json');
        if(!is_file($file))return [];
        $s=json_decode(file_get_contents($file),true);$out=[];
        foreach(($s['published']??[]) as $target=>$id)if(preg_match('/^[a-f0-9-]{36}$/i',$id) && is_file(dirname($file).'/'.$id.'.bin'))$out[$target]=url('/client-mirrors/'.$id);
        return $out;
    }
    public function serve(string $id) {
        $row=$this->state(function(&$s)use($id){abort_unless(in_array($id,$s['published'],true),404);return $s['items'][$id];});
        $file=$this->directory().'/'.$id.'.bin';abort_unless(is_file($file),404);
        $name=preg_replace('/[^a-zA-Z0-9._-]/','_', $row['name']);
        return response()->download($file,$name,['Content-Type'=>'application/octet-stream','X-Content-Type-Options'=>'nosniff','Cache-Control'=>'private, max-age=0']);
    }
}
