<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use App\Models\ServerV2box;
use App\Models\ServerV2node;
use App\Services\ServerService;
use App\Utils\CacheKey;
config(['v2board.server_token'=>'v2box-local-test']);
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
$cacheKeys=[];
try {
    $id=max((int) ServerV2node::max('id'), (int) ServerV2box::max('id'))+100;
    $base=['group_id'=>[999999], 'name'=>'V2Box test', 'host'=>'example.test', 'port'=>'443', 'server_port'=>443, 'listen_ip'=>'0.0.0.0', 'protocol'=>'vless', 'tls'=>0, 'network'=>'tcp', 'disable_sni'=>0, 'zero_rtt_handshake'=>0, 'rate'=>'1', 'show'=>1, 'up_mbps'=>0, 'down_mbps'=>0, 'tls_settings'=>['private_key'=>'secret','ech_key'=>'secret','tls_key'=>'secret']];
    foreach ([ServerV2node::class, ServerV2box::class] as $class) {
        $node=new $class($base); $node->id=$id; $node->save();
    }
    $svc=new ServerService();
    $assert($svc->getServer($id,'v2box') instanceof ServerV2box, 'V2Box lookup');
    $assert(get_class($svc->getServer($id,'v2node'))===ServerV2node::class, 'V2Node lookup isolated');
    $user=new App\Models\User(['group_id'=>999999]);
    foreach (['v2node','v2box'] as $type) {
        $nodes=$svc->getAvailableV2node($user,$type);
        $node=array_values(array_filter($nodes,fn($n)=>$n['id']==$id))[0];
        $assert($node['type']===$type, 'Subscription type preserved');
        $assert(!isset($node['tls_settings']['private_key'],$node['tls_settings']['ech_key'],$node['tls_settings']['tls_key']), 'Secrets stripped');
        $assert(strpos(App\Utils\Helper::buildUri('00000000-0000-4000-8000-000000000001',$node),'vless://')===0,'Subscription URI');
        $request=Request::create('/api/v2/server/config','GET',['token'=>config('v2board.server_token'),'node_type'=>$type,'node_id'=>$id]);
        $controller=new App\Http\Controllers\V2\Server\ServerController($request);
        $config=json_decode($controller->config($request)->getContent(),true);
        $assert($config['protocol']==='vless','Node config');
        $request=Request::create('/api/v1/server/UniProxy/user','GET',['token'=>config('v2board.server_token'),'node_type'=>$type,'node_id'=>$id]);
        $controller=new App\Http\Controllers\V1\Server\UniProxyController($request);
        $controller->user($request);
        $key=CacheKey::get('SERVER_'.strtoupper($type).'_LAST_CHECK_AT',$id); $cacheKeys[]=$key;
        $assert(Cache::has($key),'Independent heartbeat');
    }
    $legacy=Request::create('/api/v2/server/config','GET',['token'=>config('v2board.server_token'),'node_id'=>$id]);
    $assert(json_decode((new App\Http\Controllers\V2\Server\ServerController($legacy))->config($legacy)->getContent(),true)['protocol']==='vless','Legacy config without node_type');
    Illuminate\Support\Facades\Queue::fake();
    $push=Request::create('/api/v1/server/UniProxy/push?'.http_build_query(['token'=>config('v2board.server_token'),'node_type'=>'v2box','node_id'=>$id]),'POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode([123=>[1024,2048]]));
    (new App\Http\Controllers\V1\Server\UniProxyController($push))->push($push);
    $assert(Illuminate\Support\Facades\Queue::pushed(App\Jobs\TrafficFetchJob::class)->count()===1, 'Traffic job queued');
    foreach (['ONLINE_USER','LAST_PUSH_AT'] as $suffix) $cacheKeys[]=CacheKey::get('SERVER_V2BOX_'.$suffix,$id);
    $assert((int) Cache::get(CacheKey::get('SERVER_V2BOX_ONLINE_USER',$id))===1,'Traffic report updates V2Box status');
    $assert(!Cache::has(CacheKey::get('SERVER_V2NODE_ONLINE_USER',$id)),'Traffic report leaves V2Node status unchanged');
    $all=$svc->getAllServers();
    $nodes=array_values(array_filter($all,fn($n)=>$n['id']==$id && in_array($n['type'],['v2node','v2box'])));
    $assert(count($nodes)===2,'Both types listed with same id');
    foreach ($nodes as $node) if ($node['type']==='v2box') {
        $assert(strpos($node['install_command'],'--node-type v2box')!==false,'Installer selects V2Box');
        $assert(str_contains($node['install_command'],'--install v1.0.3'),'Installer uses published version, not legacy main');
        $assert(strpos($node['install_command'],'--prompt-api-key')!==false,'Installer keeps credential input interactive');
    }
    $admin=new App\Http\Controllers\V1\Admin\Server\V2boxController();
    foreach ([['network'=>'xhttp'], ['network'=>'http'], ['encryption'=>'mlkem768x25519plus'], ['trusted_x_forwarded_for'=>['127.0.0.1']], ['tls_settings'=>['ech'=>'custom']]] as $invalid) {
        try { $admin->save(Request::create('/','POST',array_merge($base,$invalid))); throw new RuntimeException('Invalid config accepted'); }
        catch (Illuminate\Validation\ValidationException $e) { $checks++; }
    }
    $admin->save(Request::create('/','POST',array_merge($base,['id'=>$id,'name'=>'V2Box updated','tls_settings'=>null])));
    $assert(ServerV2box::find($id)->name==='V2Box updated','V2Box update');
    $assert(ServerV2node::find($id)->name==='V2Box test','V2Node untouched');
    $admin->copy(Request::create('/','POST',['id'=>$id]));
    $assert(ServerV2box::where('name','V2Box updated')->count()===2,'V2Box copy');
    $credential=App\Services\NodeCredentials::issue('v2box',$id,1);
    $admin->drop(Request::create('/','POST',['id'=>$id]));
    $assert(DB::table('v2_node_credential')->where('id',$credential['id'])->value('revoked_at')!==null,'Deleted node credentials revoked');
    $assert(!ServerV2box::find($id) && ServerV2node::find($id),'V2Box delete isolated');
    $schema=json_decode((new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>'v2box']))->getContent(),true)['data'];
    $assert(isset($schema['protocol'],$schema['region_code']) && $schema['network']==='required|in:tcp,ws,grpc,httpupgrade','Admin schema');
    // Run the shipped bootstrap with fake downloads/services and a private config directory.
    // No installation, external HTTP, system service changes or real credentials are involved.
    // Opt-in: a disposable Linux root container with bash/jq; regular PHP runs need neither.
    foreach (getenv('V2BOX_BOOTSTRAP_TEST')==='1' ? [0,1] : [] as $reportFailure) {
        $fixture=sys_get_temp_dir().'/v2box-deploy-test-'.bin2hex(random_bytes(8));
        mkdir($fixture,0700);mkdir($fixture.'/bin',0700);mkdir($fixture.'/tmp',0700);
        try {
            $response=['data'=>['nodeId'=>3,'nodeType'=>'v2box','apiHost'=>'https://panel.example.invalid','apiKey'=>'nk_'.str_repeat('a',32).'.'.str_repeat('b',64),'networkReport'=>['token'=>str_repeat('c',64),'family'=>'ipv4']]];
            file_put_contents($fixture.'/response.json',json_encode($response));
            $mocks=[
                'curl'=><<<'SH'
#!/bin/bash
set -eu
out=''
response=false
while (($#)); do
  case "$1" in
    -o) out=$2; shift;;
    */enrollments/redeem) response=true;;
  esac
  shift
done
if $response; then cp "$DNS_FIXTURE/response.json" "$out"; else printf '#!/bin/bash\nexit 0\n' > "$out"; fi
SH,
                'v2box'=><<<'SH'
#!/bin/bash
[[ "$1" == restart ]] || exit 1
echo restart >> "$DNS_FIXTURE/events"
SH,
                'python3'=><<<'SH'
#!/bin/bash
set -eu
[[ "$1" == */node-network.py && "$2" == report-configure && "$3" == --panel-url && "$4" == https://panel.example.invalid && "$5" == --family && "$6" == ipv4 && "$7" == --token-file ]] || exit 2
[[ "$(stat -c %a "$8")" == 600 && "$(cat "$8")" =~ ^c{64}$ ]] || exit 3
echo report >> "$DNS_FIXTURE/events"
exit "$DNS_REPORT_FAILURE"
SH,
            ];
            foreach ($mocks as $name=>$script) {file_put_contents($fixture.'/bin/'.$name,$script."\n");chmod($fixture.'/bin/'.$name,0700);}
            $script=str_replace(['__NODE_PREREQUISITES__','/etc/v2box'],['',$fixture.'/config'],file_get_contents(resource_path('scripts/node-deploy.sh')));
            file_put_contents($fixture.'/bootstrap.sh',$script);
            $run=function()use($fixture,$reportFailure){
                $pipes=[];$p=proc_open(['bash',$fixture.'/bootstrap.sh','--api-host','https://panel.example.invalid','--node-id','3','--deploy-token','nd_'.str_repeat('d',64)],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes,null,array_merge(getenv(),['PATH'=>$fixture.'/bin:'.getenv('PATH'),'TMPDIR'=>$fixture.'/tmp','DNS_FIXTURE'=>$fixture,'DNS_REPORT_FAILURE'=>(string)$reportFailure]));
                fclose($pipes[0]);$output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);return [proc_close($p),$output];
            };
            [$exit,$output]=$run();
            $assert($exit===$reportFailure,'Deployment bootstrap reports address setup result: '.$exit.' '.preg_replace('/(?:nk_|nd_)?[a-f0-9.]{64,}/','[redacted]',$output));
            $assert(file_get_contents($fixture.'/events')==="restart\nreport\n",'Node starts even if address reporting fails');
            $config=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($config['Nodes'][0]['ApiKey']===$response['data']['apiKey'] && (fileperms($fixture.'/config/config.json')&0777)===0600,'Deployment atomically installs private node configuration');
            $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Deployment removes temporary reporting secrets');
            $before=hash_file('sha256',$fixture.'/config/config.json');[$exit]=$run();
            $assert($exit===1 && hash_file('sha256',$fixture.'/config/config.json')===$before,'Redeployment preserves existing node config');
        } finally {
            $files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($fixture,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
            foreach($files as $file) {if($file->isDir())rmdir($file->getPathname());else unlink($file->getPathname());}rmdir($fixture);
        }
    }
    echo "PASS: $checks V2Box integration checks\n";
} finally {
    DB::rollBack();
    foreach ($cacheKeys as $key) Cache::forget($key);
}
