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
// Private worker fixture for the opt-in, two-real-database process smoke below.
if (getenv('V2BOX_INDEPENDENT_PANEL_SEED')==='1') {
    if (getenv('TEST_DISPOSABLE_WORKSPACE')!=='1' || !str_starts_with(DB::getDatabaseName(),'v2box_multi_')) throw new RuntimeException('Independent panel fixture requires its disposable schema');
    $label=getenv('V2BOX_PANEL_LABEL');$port=(int)getenv('V2BOX_PANEL_PORT');
    $group=new App\Models\ServerGroup();$group->name='Independent '.$label;$group->save();
    $admin=App\Models\User::create(['email'=>'admin-'.$label.'@example.test','password'=>password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>1]);
    $user=App\Models\User::create(['email'=>'proxy-'.$label.'@example.test','password'=>password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'group_id'=>$group->id,'transfer_enable'=>1073741824,'expired_at'=>time()+86400]);
    $node=new ServerV2box(['name'=>'Independent '.$label,'group_id'=>[$group->id],'host'=>'node-'.$label.'.example.test','port'=>(string)$port,'server_port'=>$port,'listen_ip'=>'127.0.0.1','protocol'=>'vless','tls'=>$label==='a'?1:0,'network'=>'tcp','rate'=>1,'show'=>1,'disable_sni'=>0,'zero_rtt_handshake'=>0,'up_mbps'=>0,'down_mbps'=>0,'tls_settings'=>$label==='a'?['cert_mode'=>'file','server_name'=>'node-a.example.test','cert_file'=>'/etc/v2box/operator-cert.pem','key_file'=>'/etc/v2box/operator-key.pem']:[]]);
    $node->id=3;$node->save();
    DB::table('v2_network_server')->insert(['id'=>7,'name'=>'Physical '.$label,'family'=>'ipv4','enabled'=>true]);
    $report=App\Services\NetworkServer::credential(7);
    DB::table('v2_node_ddns')->insert(['credential_id'=>0,'node_type'=>'v2box','node_id'=>3,'domain'=>'node-'.$label.'.example.test','family'=>'ipv4','managed'=>false,'enabled'=>true,'server_id'=>7]);
    $key=$label==='a'?App\Services\NodeCredentials::issue('v2box',3,(int)$admin->id):null;
    $grant=$label==='b'?App\Services\NodeDeployment::create(3,(int)$admin->id):null;
    $data=['origin'=>config('v2board.server_api_url'),'uuid'=>$user->uuid,'userId'=>$user->id,'actorId'=>$admin->id,'nodeId'=>3,'serverId'=>7,'nodeKey'=>$key['secret']??null,'command'=>$grant['command']??null,'report'=>$report,'port'=>$port,'database'=>DB::getDatabaseName()];
    file_put_contents(getenv('V2BOX_PANEL_PRIVATE'),json_encode($data));chmod(getenv('V2BOX_PANEL_PRIVATE'),0600);
    echo "Independent panel fixture prepared\n";return;
}
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
        $assert(str_contains($node['install_command'],'--install v1.0.16'),'Installer pins the multi-panel-capable release, not legacy main');
        $assert(str_ends_with($node['upgrade_command'],'--update'),'Upgrade requires existing installation and preserves configuration');
        $assert(strpos($node['install_command'],'--prompt-api-key')!==false,'Installer keeps credential input interactive');
    }
    $admin=new App\Http\Controllers\V1\Admin\Server\V2boxController();
    foreach ([['network'=>'xhttp'], ['network'=>'http'], ['encryption'=>'mlkem768x25519plus'], ['trusted_x_forwarded_for'=>['127.0.0.1']], ['tls_settings'=>['ech'=>'custom']]] as $invalid) {
        try { $admin->save(Request::create('/','POST',array_merge($base,$invalid))); throw new RuntimeException('Invalid config accepted'); }
        catch (Illuminate\Validation\ValidationException $e) { $checks++; }
    }
    $admin->save(Request::create('/','POST',array_merge($base,['id'=>$id,'name'=>'Stale service form','server_port'=>9443,'tls_settings'=>null])));
    $assert(ServerV2box::find($id)->name==='V2Box test' && (int)ServerV2box::find($id)->server_port===9443,'V2Box service update preserves line name');
    $lineAdmin=new App\Http\Controllers\V1\Admin\NodeConnectionController();
    $lineState=$lineAdmin->defaultLine(Request::create('/','GET',['type'=>'v2box','id'=>$id]))['data'];
    $lineAdmin->updateDefaultLine(Request::create('/','PATCH',['type'=>'v2box','id'=>$id,'revision'=>$lineState['revision'],'name'=>'V2Box updated','group_id'=>[999999],'rate'=>1]));
    $assert(ServerV2box::find($id)->name==='V2Box updated','Default line update changes only the selected backend');
    $assert(ServerV2node::find($id)->name==='V2Box test','V2Node untouched');
    $admin->copy(Request::create('/','POST',['id'=>$id]));
    $assert(ServerV2box::where('name','V2Box updated')->count()===2,'V2Box copy');
    $certificateNode=ServerV2box::find($id);$certificateNode->tls=1;$certificateNode->tls_settings=['cert_mode'=>'http','server_name'=>'node.example.test'];
    try { App\Services\NodeDeploymentWorkflow::validate($certificateNode);$assert(false,'Automatic certificate deployment requires managed DNS'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422,'Automatic certificate deployment requires managed DNS'); }
    $credential=App\Services\NodeCredentials::issue('v2box',$id,1);
    $admin->drop(Request::create('/','POST',['id'=>$id]));
    $assert(DB::table('v2_node_credential')->where('id',$credential['id'])->value('revoked_at')!==null,'Deleted node credentials revoked');
    $assert(!ServerV2box::find($id) && ServerV2node::find($id),'V2Box delete isolated');
    $schema=json_decode((new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>'v2box']))->getContent(),true)['data'];
    $assert(isset($schema['protocol'],$schema['region_code']) && $schema['network']==='required|in:tcp,ws,grpc,httpupgrade','Admin schema');
    // Run the shipped bootstrap with fake downloads/services and a private config directory.
    // No installation, external HTTP, system service changes or real credentials are involved.
    // Opt-in: a disposable Linux root container with bash/jq; regular PHP runs need neither.
    foreach (getenv('V2BOX_BOOTSTRAP_TEST')==='1' ? [[0,false,false],[1,false,false],[0,true,false],[1,true,false],[0,true,true],[1,true,true]] : [] as [$reportFailure,$networkOnly,$serverOnly]) {
        $fixture=sys_get_temp_dir().'/v2box-deploy-test-'.bin2hex(random_bytes(8));
        mkdir($fixture,0700);mkdir($fixture.'/bin',0700);mkdir($fixture.'/tmp',0700);mkdir($fixture.'/lib',0700);
        try {
            $response=['data'=>['nodeId'=>3,'nodeType'=>'v2box','apiHost'=>'https://panel.example.invalid','apiKey'=>'nk_'.str_repeat('a',32).'.'.str_repeat('b',64),'networkReport'=>['token'=>str_repeat('c',64),'family'=>'ipv4','serverId'=>7]]];
            $originalKey=$response['data']['apiKey'];
            if ($networkOnly) {
                if (!$serverOnly) {
                mkdir($fixture.'/config',0700);
                file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['NodeType'=>'v2box','NodeID'=>3,'ApiHost'=>'https://panel.example.invalid','ApiKey'=>$originalKey]]]));
                $originalHash=hash_file('sha256',$fixture.'/config/config.json');
                }
                unset($response['data']['apiKey']);$response['data']['purpose']='network';
            }
            if ($serverOnly) { unset($response['data']['nodeType'],$response['data']['nodeId']); $response['data']['purpose']='server'; $response['data']['serverId']=7; }
            file_put_contents($fixture.'/response.json',json_encode($response));
            $mocks=[
                'curl'=><<<'SH'
#!/bin/bash
set -eu
out=''
authorization=''
response=false
while (($#)); do
  case "$1" in
    -o) out=$2; shift;;
    --config) authorization=$2; shift;;
    */enrollments/redeem) response=true;;
  esac
  shift
done
if $response; then
  fingerprint=$(sha256sum "$authorization" | cut -d ' ' -f 1)
  if [[ -f "$DNS_FIXTURE/consumed" ]] && grep -Fxq "$fingerprint" "$DNS_FIXTURE/consumed"; then exit 22; fi
  echo "$fingerprint" >> "$DNS_FIXTURE/consumed"
  echo redeemed >> "$DNS_FIXTURE/redemptions"; cp "$DNS_FIXTURE/response.json" "$out"
else cat > "$out" <<'INSTALL'
#!/bin/bash
set -eu
mkdir -p "$DNS_FIXTURE/lib"
for file in v2box manager.sh install.sh node-network.py node-credentials.py; do
  cat > "$DNS_FIXTURE/lib/$file" <<'PROGRAM'
#!/bin/sh
echo '{"features":["multi-panel-v1","reload-signal-v1"]}'
PROGRAM
  chmod 700 "$DNS_FIXTURE/lib/$file"
done
INSTALL
fi
SH,
                'v2box'=><<<'SH'
#!/bin/bash
[[ "$1" != stop ]] || exit 0
[[ "$1" != check-runtime ]] || exit 0
[[ "$1" == start || "$1" == reload ]] || exit 1
echo "$1" >> "$DNS_FIXTURE/events"
SH,
                'systemctl'=>"#!/bin/sh\necho active\n",
                'python3'=><<<'SH'
#!/bin/bash
set -eu
if [[ "$1" == -m && "$2" == py_compile ]]; then exit 0; fi
if [[ "${2:-}" == capabilities ]]; then echo '{"features":["report-multi-target-v1"]}'; exit 0; fi
if [[ "$1" == */panel-deploy.py ]]; then exec /usr/bin/python3 "$@"; fi
[[ "$1" == */node-network.py && "$2" == report-configure && "$3" == --panel-url && ( "$4" == https://panel.example.invalid || "$4" == https://another.example.invalid ) && "$5" == --family && "$6" == ipv4 && "$7" == --token-file ]] || exit 2
[[ "$(stat -c %a "$8")" == 600 && "$(cat "$8")" =~ ^c{64}$ ]] || exit 3
echo report >> "$DNS_FIXTURE/events"
exit "$DNS_REPORT_FAILURE"
SH,
            ];
            foreach ($mocks as $name=>$script) {file_put_contents($fixture.'/bin/'.$name,$script."\n");chmod($fixture.'/bin/'.$name,0700);}
            $script=str_replace('__NODE_DEPLOY_HELPER__',file_get_contents(resource_path('scripts/node-deploy.py')),file_get_contents(resource_path('scripts/node-deploy.sh')));
            $script=str_replace(['__NODE_PREREQUISITES__','/etc/v2box','/usr/local/lib/v2box','/etc/node-network','/usr/local/bin/v2box'],['',$fixture.'/config',$fixture.'/lib',$fixture.'/network',$fixture.'/bin/v2box'],$script);
            file_put_contents($fixture.'/bootstrap.sh',$script);
            $run=function($failure=null,$nodeId=3,$panelHost='https://panel.example.invalid')use($fixture,$reportFailure,$networkOnly,$serverOnly){
                $pipes=[];$p=proc_open(['bash',$fixture.'/bootstrap.sh',...($networkOnly && !$serverOnly?['--network-only']:[]),'--api-host',$panelHost,...($serverOnly?['--server-id','7']:['--node-id',(string)$nodeId]),'--deploy-token',($serverOnly?'ns_':'nd_').hash('sha256',$panelHost.'|'.$nodeId)],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes,null,array_merge(getenv(),['PATH'=>$fixture.'/bin:'.getenv('PATH'),'TMPDIR'=>$fixture.'/tmp','DNS_FIXTURE'=>$fixture,'DNS_REPORT_FAILURE'=>(string)($failure??$reportFailure)]));
                fclose($pipes[0]);$output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);return [proc_close($p),$output];
            };
            if (!$networkOnly && !$reportFailure) {
                mkdir($fixture.'/config',0700);
                file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['ApiHost'=>'https://panel.example.com','ApiKey'=>'REPLACE_ME']]]));
            }
            [$exit,$output]=$run();
            $assert($exit===$reportFailure,'Deployment bootstrap reports address setup result: '.$exit.' '.preg_replace('/(?:nk_|nd_)?[a-f0-9.]{64,}/','[redacted]',$output));
            if ($networkOnly) {
                $assert(file_get_contents($fixture.'/events')==="report\n",'Network-only setup never restarts node');
                $assert($serverOnly ? !file_exists($fixture.'/config/config.json') : hash_file('sha256',$fixture.'/config/config.json')===$originalHash,'Network-only setup preserves node configuration and key');
                $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Network-only setup cleans temporary secrets');
                if ($reportFailure) {
                    $assert(count(glob($fixture.'/network/enrollment-state*.json'))===1 && (fileperms(glob($fixture.'/network/enrollment-state*.json')[0])&0777)===0600,'Failure retains private state for resume');
                    [$resumed]=$run(0);
                    $assert($resumed===0 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Resume uses private state without redeeming consumed grant');
                }
                $assert(count(glob($fixture.'/network/enrollment-state*.json'))===0,'Successful reporting removes enrollment secret');
                if ($serverOnly) file_put_contents($fixture.'/network/server-identity',"https://panel.example.invalid/999\n");
                else file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['NodeType'=>'v2box','NodeID'=>999,'ApiHost'=>'https://panel.example.invalid']]]));
                [$wrong]=$run(0);
                $assert($wrong===1 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Wrong node rejected before grant consumption');
                if ($serverOnly) {
                    $legacy=file_get_contents($fixture.'/network/server-identity');
                    $response['data']['apiHost']='https://another.example.invalid';
                    file_put_contents($fixture.'/response.json',json_encode($response));
                    [$other,$otherOutput]=$run(0,3,'https://another.example.invalid');
                    $assert($other===0,'Another panel may bind the same machine: '.$otherOutput);
                    $assert(file_get_contents($fixture.'/network/server-identity')===$legacy,'Another panel never overwrites legacy binding');
                    $assert(count(glob($fixture.'/network/identities/*.json'))===2,'Reporting identities scoped by panel');
                }
                continue;
            }
            $assert(file_get_contents($fixture.'/events')===($reportFailure ? "report\n" : "report\nreload\n"),'IP reporting must succeed before starting the node');
            if ($reportFailure) {
                $assert(count(glob($fixture.'/config/deployment-state*.json'))===1,'Failed reporting retains scoped private enrollment without activating the node');
                [$resumed]=$run(0);
                $assert($resumed===0 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Failed reporting resumes without consuming another grant');
            }
            $config=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($config['Nodes'][0]['ApiKey']===$response['data']['apiKey'] && (fileperms($fixture.'/config/config.json')&0777)===0600,'Deployment atomically installs private node configuration');
            $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Deployment removes temporary reporting secrets');
            $before=hash_file('sha256',$fixture.'/config/config.json');[$exit]=$run(0);
            $assert($exit===0 && hash_file('sha256',$fixture.'/config/config.json')===$before,'Redeployment preserves existing node config');
            file_put_contents($fixture.'/lib/v2box',"#!/bin/sh\necho '{\"features\":[\"multi-panel-v1\",\"reload-signal-v1\"]}'\n");chmod($fixture.'/lib/v2box',0700);
            $response['data']['nodeId']=4;file_put_contents($fixture.'/response.json',json_encode($response));
            [$added,$addedOutput]=$run(0,4);
            $combined=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($added===0 && array_column($combined['Nodes'],'NodeID')===[3,4],'Existing installation appends another service: '.$addedOutput);
            $assert($combined['Nodes'][0]===$config['Nodes'][0],'Appending preserves existing service configuration');
            $certificate=$fixture.'/saved.cer';file_put_contents($certificate,'existing-certificate');
            $response['data']['apiHost']='https://another.example.invalid';$response['data']['nodeId']=3;
            file_put_contents($fixture.'/response.json',json_encode($response));
            [$other,$otherOutput]=$run(0,3,'https://another.example.invalid');
            $multi=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($other===0 && count($multi['Nodes'])===3,'Different panel with same node ID appends: '.$otherOutput);
            $assert(array_slice($multi['Nodes'],0,2)===$combined['Nodes'] && file_get_contents($certificate)==='existing-certificate','Cross-panel deployment preserves nodes and certificates');
            $before=hash_file('sha256',$fixture.'/config/config.json');[$again]=$run(0,3,'https://another.example.invalid');
            $assert($again===0 && hash_file('sha256',$fixture.'/config/config.json')===$before,'Cross-panel repeat is idempotent');
            $assert(!str_contains(file_get_contents($fixture.'/events'),'restart'),'Adding panels never restarts existing nodes');
            $redemptions=file_get_contents($fixture.'/redemptions');
            file_put_contents($fixture.'/lib/v2box',"#!/bin/sh\necho old-version\n");chmod($fixture.'/lib/v2box',0700);
            [$unsupported,$message]=$run(0,3,'https://another.example.invalid');
            $assert($unsupported!==0 && str_contains($message,'does not support') && file_get_contents($fixture.'/redemptions')===$redemptions,'Unsupported binary refused before grant consumption');
            $assert(hash_file('sha256',$fixture.'/config/config.json')===$before,'Unsupported binary preserves config');
            $lock=fopen($fixture.'/config/.bootstrap.lock','c');flock($lock,LOCK_EX);
            [$exit,$output]=$run();flock($lock,LOCK_UN);fclose($lock);
            $assert($exit===1 && str_contains($output,'Another deployment is running'),'Concurrent installer exits before consuming authorization');
        } finally {
            $files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($fixture,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
            foreach($files as $file) {if($file->isDir())rmdir($file->getPathname());else unlink($file->getPathname());}rmdir($fixture);
        }
    }
    if (getenv('V2BOX_BOOTSTRAP_TEST')==='1') {
        $pipes = [];
        $process = proc_open(
            ['python3', base_path('tests/support/v2box-deployment.py'), resource_path('scripts/node-deploy.py')],
            [['file', '/dev/null', 'r'], ['pipe', 'w'], ['redirect', 1]],
            $pipes
        );
        $output = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        $exit = proc_close($process);
        $assert($exit === 0, 'Deployment workflow tests: '.$output);
        echo $output;
    }
    echo "PASS: $checks V2Box integration checks\n";
} finally {
    DB::rollBack();
    foreach ($cacheKeys as $key) Cache::forget($key);
}
if (getenv('V2BOX_INDEPENDENT_DATABASE_SMOKE')==='1') {
    if (PHP_OS_FAMILY!=='Linux' || getenv('TEST_DISPOSABLE_WORKSPACE')!=='1' || !str_starts_with(DB::getDatabaseName(),'commerce_test_')) throw new RuntimeException('Real multi-panel smoke requires the disposable Linux runner');
    $fixture='/tmp/v2box-independent-'.bin2hex(random_bytes(6));mkdir($fixture,0700);
    $schemas=[];$panels=[];$source=DB::getDatabaseName();
    try {
        foreach(['a','b'] as $offset=>$label) {
            $database='v2box_multi_'.$label.'_'.bin2hex(random_bytes(4));$schemas[]=$database;
            DB::statement('CREATE DATABASE `'.$database.'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            foreach(DB::select('SHOW TABLES') as $table) {$name=array_values((array)$table)[0];if(!preg_match('/^[a-zA-Z0-9_]+$/',$name))throw new RuntimeException('Unexpected fixture table');DB::statement('CREATE TABLE `'.$database.'`.`'.$name.'` LIKE `'.$source.'`.`'.$name.'`');}
            $directory=$fixture.'/panel-'.$label;mkdir($directory,0700);
            $copy='tar --exclude=vendor --exclude=frontend/node_modules --exclude=bootstrap/cache --exclude=storage -cf - . | tar -xf - -C '.escapeshellarg($directory);
            $p=proc_open(['bash','-o','pipefail','-c',$copy],[['file','/dev/null','r'],['file','/dev/null','w'],['file','/dev/null','w']],$pipes,base_path());
            if(proc_close($p)!==0)throw new RuntimeException('Could not copy independent panel fixture');
            symlink(base_path('vendor'),$directory.'/vendor');
            foreach(['storage/app','storage/logs','storage/framework/cache/data','storage/framework/views','storage/framework/sessions','bootstrap/cache'] as $sub)mkdir($directory.'/'.$sub,0700,true);
            $origin='https://panel-'.$label.'.test:'.(9443+$offset);$port=38081+$offset;
            $config=['app_url'=>$origin,'server_api_url'=>$origin,'server_token'=>bin2hex(random_bytes(32)),'secure_path'=>'admin','server_pull_interval'=>1,'server_push_interval'=>1];
            file_put_contents($directory.'/config/v2board.php','<?php return '.var_export($config,true).';');
            $environment=array_merge(getenv(),['DB_DATABASE'=>$database,'APP_KEY'=>'base64:'.base64_encode(random_bytes(32)),'APP_CONFIG_CACHE'=>$directory.'/bootstrap/cache/independent.php','CACHE_PREFIX'=>'independent_'.$label,'REDIS_PREFIX'=>'independent_'.$label.':','REDIS_DB'=>'8','REDIS_CACHE_DB'=>'9','V2BOX_INDEPENDENT_PANEL_SEED'=>'1','V2BOX_PANEL_LABEL'=>$label,'V2BOX_PANEL_PORT'=>(string)$port,'V2BOX_PANEL_PRIVATE'=>$directory.'/private.json']);
            $p=proc_open([PHP_BINARY,'tests/support/run-script.php','tests/v2box.php'],[['file','/dev/null','r'],['pipe','w'],['redirect',1]],$pipes,$directory,$environment);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);if(proc_close($p)!==0 || !is_file($directory.'/private.json'))throw new RuntimeException('Independent panel seed failed: '.explode('(Connection:',strtok($output,"\n"))[0]);
            $panels[]=array_merge(json_decode(file_get_contents($directory.'/private.json'),true),['root'=>$directory,'environment'=>$environment,'httpPort'=>8081+$offset]);
        }
        $manifest=$fixture.'/private.json';file_put_contents($manifest,json_encode(['panels'=>$panels,'root'=>$fixture]));chmod($manifest,0600);
        $p=proc_open(['python3',base_path('tests/support/v2box-panels.py'),$manifest],[['file','/dev/null','r'],['pipe','w'],['redirect',1]],$pipes,base_path());$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$exit=proc_close($p);
        $assert($exit===0,'Independent-database V2Box process smoke: '.$output);echo $output;
    } finally {foreach($schemas as $database)DB::statement('DROP DATABASE IF EXISTS `'.$database.'`');}
}
