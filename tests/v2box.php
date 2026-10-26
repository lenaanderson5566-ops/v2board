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
        $assert(str_contains($node['install_command'],'--install v1.0.12'),'Installer pins the multi-panel-capable release, not legacy main');
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
        $python=<<<'PY'
import importlib.util, io, json, os, sys, tempfile, unittest, subprocess
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deploy',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'deployment-state.json'
        self.data={'nodeId':3,'apiHost':'https://panel.example.invalid','apiKey':'test-only','networkReport':{'token':'c'*64,'family':'ipv4'},'deployment':{'token':'dp_'+'d'*64,'domain':'node.example.test','tls':1,'certificateMode':'http','certificateDomain':'node.example.test','certificateFile':'','protocol':'vless','listenAddress':'0.0.0.0','listenPort':443}}
        m.write_private(self.path,{'data':self.data});self.deploy=m.Deployment(self.path);self.events=[]
        self.deploy.report=lambda:self.events.append('report')
        self.deploy.wait_dns=lambda:self.events.append('dns') or False
        self.deploy.check_http_port=lambda:self.events.append('port')
        self.deploy.command=lambda args:self.events.append(args[-1])
        self.deploy.service_state=lambda:'active'
        self.deploy.verify_certificate=lambda:self.events.append('certificate')
        self.deploy.progress=lambda action='status':self.events.append(action) or {'applicationState':'applied','completed':action=='complete'}
    def tearDown(self): self.tmp.cleanup()
    def test_nonobject_response_is_rejected_safely(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'[]'
        with patch.object(m.urllib.request,'build_opener') as opener:
            opener.return_value.open.return_value=Response()
            with self.assertRaisesRegex(OSError,'JSON object'):
                m.json_request('https://panel.example.test')

    def test_expired_authorization_guides_new_command_not_resume(self):
        with patch.object(m,'Deployment',side_effect=m.DeploymentError('Deployment authorization expired. Generate a new deployment task in the panel.')), patch.object(m.sys,'argv',['deploy',str(self.path)]), patch.object(m.sys,'stderr',io.StringIO()) as output:
            self.assertEqual(m.main(),1)
            self.assertIn('generate a new deployment command',output.getvalue())
            self.assertNotIn('run: sh install-v2box.sh --resume',output.getvalue())
            self.assertTrue(self.path.exists())

    def test_invalid_saved_state_is_actionable_and_retained(self):
        for value in ('{', '[]', '{"data":null}', '{"data":{"apiHost":3}}'):
            self.path.write_text(value);self.path.chmod(0o600)
            with self.assertRaises(m.DeploymentError): m.Deployment(self.path)
            self.assertEqual(self.path.read_text(),value)
    def test_corrupt_existing_config_is_not_overwritten(self):
        self.deploy.config.write_text('[]')
        with self.assertRaisesRegex(m.DeploymentError,'Existing node configuration'):
            self.deploy.run()
        self.assertEqual(self.deploy.config.read_text(),'[]')
        self.assertTrue(self.path.exists())
    def test_service_command_timeout_is_actionable(self):
        with patch.object(m.subprocess,'run',side_effect=m.subprocess.TimeoutExpired(['v2box','restart'],180)):
            with self.assertRaisesRegex(m.DeploymentError,'timed out after 180'):
                m.Deployment.command(self.deploy,['v2box','restart'])
    def test_default_certificate_check_uses_panel_namespace(self):
        import hashlib
        self.deploy.flow.update(protocol='hysteria2')
        expected='/etc/v2box/panels/'+hashlib.sha256(self.deploy.host.encode()).hexdigest()[:16]+'/v2box-3/hysteria2.cer'
        with patch.object(m.Path,'exists',return_value=False),patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0)) as run:
            m.Deployment.verify_certificate(self.deploy)
        self.assertEqual(run.call_args_list[0].args[0][3],expected)
    def test_certificate_check_respects_operator_directory(self):
        self.deploy.prepare_config()
        document=json.loads(self.deploy.config.read_text())
        document['Nodes'][0]['CertificateDirectory']=str(self.path.parent/'operator-certs')
        m.write_private(self.deploy.config,document)
        self.deploy.flow.update(protocol='hysteria2')
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0)) as run:
            m.Deployment.verify_certificate(self.deploy)
        self.assertEqual(run.call_args_list[0].args[0][3],str(self.path.parent/'operator-certs'/'hysteria2.cer'))
    def second_panel(self):
        document=json.loads(json.dumps({'data':self.data}))
        document['data']['apiHost']='https://other.example.invalid'
        document['data']['apiKey']='other-scoped-key'
        path=self.path.parent/'deployment-state-other.json';m.write_private(path,document)
        return m.Deployment(path)
    def test_cross_panel_same_node_id_preserves_settings_and_files(self):
        self.deploy.prepare_config()
        document=json.loads(self.deploy.config.read_text());document['OutboundAllowCIDRs']=['10.20.30.40/32']
        document['Nodes'][0].update(Timeout=42,CertificateDirectory='/operator/certs')
        m.write_private(self.deploy.config,document)
        cert=self.path.parent/'saved.cer';cert.write_text('keep certificate')
        second=self.second_panel();second.prepare_config()
        result=json.loads(self.deploy.config.read_text())
        self.assertEqual(result['Nodes'][0],document['Nodes'][0]);self.assertEqual(result['OutboundAllowCIDRs'],document['OutboundAllowCIDRs'])
        self.assertEqual([item['NodeID'] for item in result['Nodes']],[3,3]);self.assertNotEqual(result['Nodes'][0]['ApiHost'],result['Nodes'][1]['ApiHost'])
        self.assertEqual(cert.read_text(),'keep certificate')
        before=self.deploy.config.stat().st_mtime_ns;second.prepare_config();self.assertEqual(before,self.deploy.config.stat().st_mtime_ns)
    def test_cross_panel_credential_replacement_is_scoped(self):
        self.deploy.prepare_config();second=self.second_panel();second.prepare_config()
        before=json.loads(self.deploy.config.read_text());second.data['apiKey']='rotated-key';second.save(replaceCredential=True);second.prepare_config()
        after=json.loads(self.deploy.config.read_text());self.assertEqual(after['Nodes'][0],before['Nodes'][0]);self.assertEqual(after['Nodes'][1]['ApiKey'],'rotated-key')
    def test_duplicate_alias_identity_is_refused(self):
        self.deploy.prepare_config();document=json.loads(self.deploy.config.read_text())
        document['Nodes'].append(dict(document['Nodes'][0],ApiHost=self.deploy.host.upper().replace('HTTPS:','https:')+'/'))
        m.write_private(self.deploy.config,document);before=self.deploy.config.read_bytes()
        with self.assertRaises(m.DeploymentError):self.deploy.prepare_config()
        self.assertEqual(before,self.deploy.config.read_bytes())
    def test_activation_is_authorized_before_writing_live_node(self):
        self.deploy.prepare_config();self.deploy.data['nodeId']=4
        def progress(action='status'):
            if action=='start':self.assertEqual(len(json.loads(self.deploy.config.read_text())['Nodes']),1)
            return {'applicationState':'applied','completed':action=='complete'}
        self.deploy.progress=progress;self.deploy.run()
        self.assertIn('reload',self.events);self.assertNotIn('restart',self.events)
    @unittest.skipUnless(os.environ.get('V2BOX_NETWORK_SCRIPT'),'network helper fixture required')
    def test_reporting_merge_preserves_other_panel_dns_and_backoff(self):
        spec=importlib.util.spec_from_file_location('network_fixture',os.environ['V2BOX_NETWORK_SCRIPT']);network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
        root=self.path.parent/'network';root.mkdir();network.CONFIG=root/'config.json';network.STATE=root/'state.json'
        dns={'zone_id':'a'*32,'token':'dns-key','domain':'saved.example.test','family':'ipv4'};network.write_private(network.CONFIG,dns)
        network.write_private(network.STATE,{'paused':True,'next_run':1234})
        def mapped(value):
            text=str(value)
            return root/text[len('/etc/node-network/'): ] if text.startswith('/etc/node-network/') else (root if text=='/etc/node-network' else Path(value))
        def command(args):
            token=Path(args[args.index('--token-file')+1]);self.assertEqual(token.stat().st_mode&0o777,0o600)
            network.save_target({'mode':'panel','panel_url':args[args.index('--panel-url')+1],'token':token.read_text(),'family':'ipv4','server_id':int(args[args.index('--server-id')+1])})
        with patch.object(m,'Path',side_effect=mapped):
            for host,token in [('https://a.example.test','b'*64),('https://b.example.test','c'*64)]:
                m.configure_reporting(host,{'token':token,'family':'ipv4','serverId':7},self.path.parent,command)
            before=network.CONFIG.read_bytes()
            with self.assertRaises(m.DeploymentError):m.configure_reporting('https://a.example.test',{'token':'d'*64,'family':'ipv4','serverId':8},self.path.parent,command)
        self.assertEqual(network.CONFIG.read_bytes(),before)
        self.assertEqual(len(network.targets(json.loads(before))),3)
        state=json.loads(network.STATE.read_text())['targets'][network.target_key(dns)];self.assertTrue(state['paused']);self.assertEqual(state['next_run'],1234)
        self.assertEqual(len(list((root/'identities').glob('*.json'))),2);self.assertFalse(list(self.path.parent.glob('.report-*')))
    def test_completed_command_receipt_is_private_scoped_and_has_no_key(self):
        self.deploy.save(grantHash='a'*64);self.deploy.prepare_config();self.deploy.finish()
        receipt=self.path.with_name('deployment-completed.json')
        self.assertEqual(receipt.stat().st_mode&0o777,0o600);self.assertNotIn(self.data['apiKey'],receipt.read_text())
        self.assertTrue(m.completed_enrollment(receipt,self.deploy.config,self.deploy.host,3,'a'*64))
        self.assertFalse(m.completed_enrollment(receipt,self.deploy.config,'https://other.example.test',3,'a'*64))
        document=json.loads(self.deploy.config.read_text());document['Nodes'][0]['ApiKey']='rotated';m.write_private(self.deploy.config,document)
        self.assertFalse(m.completed_enrollment(receipt,self.deploy.config,self.deploy.host,3,'a'*64))
    def test_order_and_private_config(self):
        self.deploy.run()
        self.assertEqual(self.events,['report','dns','port','start','reload','status','certificate','complete'])
        self.assertFalse(self.path.exists());self.assertEqual(self.deploy.config.stat().st_mode&0o777,0o600)
    def test_placeholder_retained_until_dns_ready(self):
        placeholder={'Nodes':[{'ApiHost':'https://panel.example.com','ApiKey':'REPLACE_ME'}]}
        m.write_private(self.deploy.config,placeholder)
        def fail_dns():
            self.assertEqual(json.loads(self.deploy.config.read_text()),placeholder)
            self.assertEqual(self.deploy.data['apiKey'],self.data['apiKey'])
            raise m.DeploymentError('dns unavailable')
        self.deploy.wait_dns=fail_dns
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertEqual(json.loads(self.deploy.config.read_text()),placeholder)
        self.assertIn('stop',self.events);self.assertNotIn('reload',self.events);self.assertTrue(self.path.exists())
    def test_completed_panel_repairs_local_placeholder(self):
        m.write_private(self.deploy.config,{'Nodes':[{'ApiHost':'https://panel.example.com','ApiKey':'REPLACE_ME'}]})
        self.deploy.save(startAttempted=True)
        self.deploy.wait_dns=lambda:True
        self.deploy.run()
        self.assertEqual(json.loads(self.deploy.config.read_text())['Nodes'][0]['ApiHost'],self.data['apiHost'])
        self.assertIn('reload',self.events)
        self.assertFalse(self.path.exists())
    def test_uninstalled_resume_restores_programs_and_preserves_files(self):
        root=Path(self.tmp.name);binpath=root/'bin';binpath.mkdir()
        cert=root/'saved.cer';cert.write_text('existing certificate')
        self.deploy.prepare_config();before=self.deploy.config.read_bytes()
        curl=binpath/'curl'
        curl.write_text("#!/bin/bash\nwhile (($#)); do if [[ \"$1\" == -o ]]; then shift; out=$1; fi; shift; done\nprintf '#!/bin/bash\\necho restored > PLACEHOLDER\\nmkdir -p RESTORE_LIB\\nfor file in v2box manager.sh install.sh node-network.py node-credentials.py; do echo repaired > RESTORE_LIB/$file; chmod 700 RESTORE_LIB/$file; done\\necho repaired > RESTORE_MANAGER\\nchmod 700 RESTORE_MANAGER\\n' > \"$out\"\n".replace("PLACEHOLDER",str(root/"restored")).replace("RESTORE_LIB",str(root/"lib")).replace("RESTORE_MANAGER",str(root/"manager")))
        curl.chmod(0o700)
        script=Path(sys.argv[1]).with_suffix('.sh').read_text()
        function=script.split('restore_programs() {',1)[1].split('\nif [[ "${1:-}" == --resume ]]',1)[0]
        programs='programs_ready() {'+script.split('programs_ready() {',1)[1].split('\n# Resume can follow uninstall:',1)[0]
        function=(programs+'\nrestore_programs() {'+function).replace('/etc/v2box',str(root)).replace('/usr/local/lib/v2box',str(root/'lib')).replace('/usr/local/bin/v2box',str(root/'manager'))
        result=subprocess.run(['bash','-c',function+'\nrestore_programs'],env=dict(os.environ,PATH=str(binpath)+':'+os.environ['PATH']),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue((root/'restored').exists())
        self.assertEqual(self.deploy.config.read_bytes(),before)
        self.assertEqual(cert.read_text(),'existing certificate')
        self.assertTrue(self.path.exists())
        for missing in ['manager.sh','install.sh','node-network.py','node-credentials.py','wrapper']:
            path=root/'manager' if missing=='wrapper' else root/'lib'/missing
            path.unlink();(root/'restored').unlink()
            result=subprocess.run(['bash','-c',function+'\nrestore_programs'],env=dict(os.environ,PATH=str(binpath)+':'+os.environ['PATH']),capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue(path.exists());self.assertTrue((root/'restored').exists())
            self.assertEqual(self.deploy.config.read_bytes(),before);self.assertEqual(cert.read_text(),'existing certificate')
    def test_fresh_authorization_replaces_only_target_credential(self):
        self.deploy.prepare_config()
        original=json.loads(self.deploy.config.read_text())
        original['Nodes'][0]['Timeout']=42
        original['Nodes'].append(dict(original['Nodes'][0],NodeID=4))
        m.write_private(self.deploy.config,original)
        self.deploy.data['apiKey']='new-scoped-key'
        with self.assertRaises(m.DeploymentError): self.deploy.prepare_config()
        self.deploy.save(replaceCredential=True)
        self.deploy.prepare_config()
        current=json.loads(self.deploy.config.read_text())
        self.assertEqual(current['Nodes'][0]['ApiKey'],'new-scoped-key')
        self.assertEqual(current['Nodes'][0]['Timeout'],42)
        self.assertEqual(current['Nodes'][1],original['Nodes'][1])
        self.assertEqual(json.loads(self.deploy.backup_path('redeploy').read_text()),original)
    @unittest.skipUnless(__import__('shutil').which('jq'),'jq required')
    def test_fresh_grant_replaces_stale_state_and_same_grant_resumes(self):
        root=Path(self.tmp.name);binpath=root/'bin';binpath.mkdir();lib=root/'lib';lib.mkdir()
        for name in ('v2box','manager.sh','install.sh','node-network.py','node-credentials.py'):
            (lib/name).write_text('#!/bin/sh\nexit 0\n');(lib/name).chmod(0o700)
        manager=root/'manager';manager.write_text('#!/bin/sh\nexit 0\n');manager.chmod(0o700)
        (lib/'v2box').write_text("#!/bin/sh\necho '{\"features\":[\"multi-panel-v1\",\"reload-signal-v1\"]}'\n")
        for name,body in {'python3':"if [[ \"${2:-}\" == --completed ]]; then exit 1; fi\necho '{\"features\":[\"report-multi-target-v1\"]}'",'curl':'while (($#)); do if [[ "$1" == -o ]]; then shift; out=$1; fi; shift; done\n[ ! -f "'+str(root/'fail')+'" ] || exit 22\necho redeemed >> "'+str(root/'redeemed')+'"\ncp "'+str(root/'response.json')+'" "$out"'}.items():
            f=binpath/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o700)
        self.deploy.prepare_config()
        response={'data':dict(self.data,nodeType='v2box',apiKey='nk_'+'a'*32+'.'+'b'*64)}
        (root/'response.json').write_text(json.dumps(response))
        script=Path(sys.argv[1]).with_suffix('.sh').read_text().replace('__NODE_PREREQUISITES__','').replace('__NODE_DEPLOY_HELPER__','pass')
        script=script.replace('/etc/v2box',str(root)).replace('/usr/local/lib/v2box',str(lib)).replace('/usr/local/bin/v2box',str(manager)).replace('/etc/node-network',str(root/'network'))
        bootstrap=root/'bootstrap.sh';bootstrap.write_text(script)
        def run(grant,legacy=False):
            arguments=['bash',str(bootstrap)] if legacy else ['bash',str(bootstrap),'--api-host',self.data['apiHost'],'--node-id','3','--deploy-token',grant]
            return subprocess.run(arguments,input=(self.data['apiHost']+'\n'+grant+'\n') if legacy else None,env=dict(os.environ,PATH=str(binpath)+':'+os.environ['PATH']),capture_output=True,text=True)
        grant='nd_'+'d'*64
        result=run(grant);self.assertEqual(result.returncode,0,result.stderr)
        saved=self.path.read_bytes();self.assertTrue(json.loads(saved)['replaceCredential'])
        result=run(grant);self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((root/'redeemed').read_text(),'redeemed\n')
        (root/'fail').touch()
        result=run('nd_'+'e'*64);self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.path.read_bytes(),saved)
        self.assertIn('Authorization redemption failed',result.stderr)
        (root/'fail').unlink()
        result=run('nd_'+'f'*64,legacy=True);self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads(self.path.read_text())['replaceCredential'])
    def test_missing_program_has_actionable_error(self):
        with patch.object(m.subprocess,'run',side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(m.DeploymentError,'program is missing'):
                m.Deployment.command(self.deploy,['v2box','restart'])
    def test_reported_state_restores_reporting_schedule(self):
        self.deploy.save(reported=True)
        m.Deployment.report(self.deploy)
        self.assertTrue(self.deploy.state['reported'])
        self.assertEqual(len(self.events),1)
    def test_report_failure_never_starts(self):
        self.deploy.report=lambda:(_ for _ in ()).throw(m.DeploymentError('report'))
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertNotIn('restart',self.events);self.assertTrue(self.path.exists())
    def test_dns_timeout_never_starts(self):
        self.deploy.wait_dns=lambda:m.Deployment.wait_dns(self.deploy)
        with patch.object(m.time,'monotonic',side_effect=[0,1000]):
            with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertNotIn('restart',self.events);self.assertFalse(self.deploy.state.get('startAttempted'))
    def test_resume_does_not_repeat_acme_start(self):
        self.deploy.prepare_config()
        self.deploy.save(startAttempted=True);self.deploy.run()
        self.assertNotIn('restart',self.events);self.assertIn('complete',self.events)
    def test_resume_starts_stopped_service_once(self):
        for state in ('inactive','failed'):
            with self.subTest(state=state):
                self.events.clear();self.deploy.save(startAttempted=True)
                self.deploy.service_state=lambda:state
                self.deploy.ensure_started()
                self.assertEqual(self.events,['port','start','start'])
    def test_failed_start_is_recoverable_without_manual_restart(self):
        self.deploy.command=lambda args:(_ for _ in ()).throw(m.DeploymentError('start failed'))
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertTrue(self.deploy.state['startAttempted'])
        self.events.clear();states=iter(['inactive','active']);commands=[]
        self.deploy.service_state=lambda:next(states)
        self.deploy.command=lambda args:commands.append(args)
        self.deploy.run()
        self.assertEqual(commands,[['v2box','start']])
        self.assertIn('complete',self.events);self.assertFalse(self.path.exists())
    def test_starting_service_is_not_restarted_on_resume(self):
        self.deploy.save(startAttempted=True);self.deploy.service_state=lambda:'activating'
        self.deploy.ensure_started()
        self.assertEqual(self.events,[])
    def test_stopped_service_is_reported_without_waiting_five_minutes(self):
        self.deploy.service_state=lambda:'failed'
        with self.assertRaisesRegex(m.DeploymentError,'V2Box stopped'):
            self.deploy.wait_ready()
        self.assertNotIn('complete',self.events);self.assertTrue(self.path.exists())
    def test_unchanged_config_does_not_trigger_file_watcher(self):
        self.deploy.prepare_config()
        original=json.loads(self.deploy.config.read_text());original['Log']={'Level':'warn'}
        m.write_private(self.deploy.config,original)
        before=self.deploy.config.stat().st_ino,self.deploy.config.stat().st_mtime_ns
        self.deploy.prepare_config()
        self.assertEqual(before,(self.deploy.config.stat().st_ino,self.deploy.config.stat().st_mtime_ns))
        self.assertEqual(json.loads(self.deploy.config.read_text())['Log'],{'Level':'warn'})
    def test_append_preserves_services_and_settings_and_resume(self):
        self.deploy.prepare_config()
        original=json.loads(self.deploy.config.read_text())
        original['Log']={'Level':'warn'}
        original['Nodes'][0]['Timeout']=42
        m.write_private(self.deploy.config,original)
        self.deploy.data['nodeId']=4
        self.deploy.prepare_config()
        result=json.loads(self.deploy.config.read_text())
        self.assertEqual(result['Log'],original['Log'])
        self.assertEqual(result['Nodes'][0],original['Nodes'][0])
        self.assertEqual([n['NodeID'] for n in result['Nodes']],[3,4])
        backup=self.deploy.backup_path('add')
        self.assertEqual(json.loads(backup.read_text()),original)
        self.assertEqual(backup.stat().st_mode&0o777,0o600)
        before=self.deploy.config.stat().st_mtime_ns
        self.deploy.prepare_config()
        self.assertEqual(before,self.deploy.config.stat().st_mtime_ns)
    def test_failed_addition_restores_previous_services(self):
        self.deploy.prepare_config()
        original=json.loads(self.deploy.config.read_text())
        self.deploy.data['nodeId']=4
        self.deploy.prepare_config()
        self.deploy.progress=lambda action='status':{'applicationState':'failed','errorCode':'core'}
        with self.assertRaises(m.DeploymentError):self.deploy.wait_ready()
        self.assertEqual(json.loads(self.deploy.config.read_text()),original)
        self.assertIn('reload',self.events)
        self.assertFalse(self.deploy.state['startAttempted'])
    def test_rollback_preserves_other_nodes_and_operator_changes(self):
        self.deploy.prepare_config()
        self.deploy.data['nodeId']=4
        self.deploy.prepare_config()
        changed=json.loads(self.deploy.config.read_text());changed['Log']={'Level':'debug'}
        another=dict(changed['Nodes'][0],ApiHost='https://another.example.test')
        changed['Nodes'].append(another)
        m.write_private(self.deploy.config,changed)
        self.deploy.rollback_addition()
        result=json.loads(self.deploy.config.read_text())
        self.assertEqual(result['Log'],changed['Log'])
        self.assertEqual(result['Nodes'],[changed['Nodes'][0],another])
    def test_rollback_refuses_edits_to_the_added_node(self):
        self.deploy.prepare_config();self.deploy.data['nodeId']=4;self.deploy.prepare_config()
        changed=json.loads(self.deploy.config.read_text());changed['Nodes'][1]['Timeout']=77
        m.write_private(self.deploy.config,changed)
        with self.assertRaises(m.DeploymentError):self.deploy.rollback_addition()
        self.assertEqual(json.loads(self.deploy.config.read_text()),changed)
    def test_same_identity_different_key_is_not_overwritten(self):
        self.deploy.prepare_config()
        before=self.deploy.config.read_bytes()
        self.deploy.data['apiKey']='different'
        with self.assertRaises(m.DeploymentError):self.deploy.prepare_config()
        self.assertEqual(before,self.deploy.config.read_bytes())
    def test_dns_failure_does_not_change_live_config(self):
        self.deploy.prepare_config()
        before=self.deploy.config.read_bytes()
        self.deploy.data['nodeId']=4
        self.deploy.wait_dns=lambda:(_ for _ in ()).throw(m.DeploymentError('DNS not ready'))
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertEqual(before,self.deploy.config.read_bytes())
    def test_service_state_handles_systemd_and_openrc(self):
        for state in ('active','activating','inactive','failed'):
            with patch.object(m.shutil,'which',return_value='/bin/systemctl'), patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,state+'\n')):
                self.assertEqual(m.Deployment.service_state(self.deploy),state)
        with patch.object(m.shutil,'which',side_effect=lambda name:'/bin/rc-service' if name=='rc-service' else None), patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],3)):
            self.assertEqual(m.Deployment.service_state(self.deploy),'inactive')
        with patch.object(m.shutil,'which',return_value='/bin/systemctl'), patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'unknown')):
            with self.assertRaisesRegex(m.DeploymentError,'Cannot determine'):
                m.Deployment.service_state(self.deploy)
    def test_certificate_failure_never_publishes(self):
        self.deploy.verify_certificate=lambda:(_ for _ in ()).throw(m.DeploymentError('certificate'))
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertNotIn('complete',self.events);self.assertTrue(self.path.exists());self.assertTrue(self.deploy.state['startAttempted'])
    def test_failed_node_never_publishes(self):
        self.deploy.progress=lambda action='status':{'applicationState':'failed','errorCode':'certificate'}
        with self.assertRaises(m.DeploymentError):self.deploy.run()
        self.assertNotIn('certificate',self.events)
    def test_missing_receipt_times_out(self):
        with patch.object(m.time,'monotonic',side_effect=[0,1000]):
            with self.assertRaises(m.DeploymentError):self.deploy.wait_ready()
        self.assertNotIn('complete',self.events)
    def test_certificate_path_uses_independent_acme_contact(self):
        self.deploy.flow.update(certificateFile='/tmp/{email}/{domain}.cer',protocol='hysteria2')
        with patch.object(m.subprocess,'run') as run:
            run.return_value.returncode=0
            m.Deployment.verify_certificate(self.deploy)
            expected='/tmp/fastdog.ltd@gmail.com/node.example.test.cer'
            self.assertEqual(run.call_args_list[0].args[0][3],expected)
            self.assertEqual(run.call_args_list[1].args[0][-1],expected)
    def test_relay_checks_origin_and_entry_separately(self):
        self.deploy.flow.update(accessMode='relay',connectionDomain='entry.example.test',certificateMode='dns',certificateDomain='entry.example.test')
        self.deploy.progress=lambda action='status':{'dnsReady':True,'addresses':{'ipv4':'8.8.8.8'},'entryAddresses':{'ipv4':'1.1.1.1'}}
        with patch.object(m,'dns_matches',return_value=True) as check:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual(check.call_args_list[0].args,('node.example.test',{'ipv4':'8.8.8.8'}))
            self.assertEqual(check.call_args_list[1].args,('entry.example.test',{'ipv4':'1.1.1.1'}))
    def test_relay_entry_dns_wait_keeps_polling_interval(self):
        self.deploy.flow.update(accessMode='relay',connectionDomain='entry.example.test',certificateMode='dns')
        self.deploy.progress=lambda action='status':{'dnsReady':True,'addresses':{'ipv4':'8.8.8.8'},'entryAddresses':{'ipv4':'1.1.1.1'}}
        with patch.object(m,'dns_matches',side_effect=[True,False]), patch.object(m.time,'monotonic',side_effect=[0,0,1000]), patch.object(m.time,'sleep') as sleep:
            with self.assertRaises(m.DeploymentError): m.Deployment.wait_dns(self.deploy)
            sleep.assert_called_once_with(15)
    def test_http_relay_checks_independent_certificate_domain_before_start(self):
        self.deploy.flow.update(accessMode='relay',connectionDomain='entry.example.test',certificateMode='http',certificateDomain='cert.example.test')
        self.deploy.progress=lambda action='status':{'dnsReady':True,'addresses':{'ipv4':'8.8.8.8'},'entryAddresses':{'ipv4':'1.1.1.1'}}
        with patch.object(m,'dns_matches',return_value=True) as check:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual([call.args for call in check.call_args_list],[('node.example.test',{'ipv4':'8.8.8.8'}),('cert.example.test',{'ipv4':'8.8.8.8'}),('entry.example.test',{'ipv4':'1.1.1.1'})])
        with patch.object(m,'dns_matches',side_effect=[True,False]), patch.object(m.time,'monotonic',side_effect=[0,0,1000]), patch.object(m.time,'sleep'):
            with self.assertRaisesRegex(m.DeploymentError,'point directly to the origin'):m.Deployment.wait_dns(self.deploy)
        self.assertNotIn('restart',self.events);self.assertNotIn('certificate',self.events)
    def test_dual_entry_ipv4_origin_http_flow_never_requires_origin_ipv6(self):
        self.deploy.flow.update(accessMode='relay',connectionDomain='entry.example.test',certificateMode='http',certificateDomain='node.example.test')
        self.deploy.progress=lambda action='status':{'dnsReady':True,'addresses':{'ipv4':'8.8.8.8'},'entryAddresses':{'ipv4':'1.1.1.1','ipv6':'2606:4700:4700::1111'}}
        def answers(domain,endpoint):
            return {'ipv4':{'8.8.8.8'},'ipv6':set()} if domain=='node.example.test' else {'ipv4':{'1.1.1.1'},'ipv6':{'2606:4700:4700::1111'}}
        with patch.object(m,'dns_answers',side_effect=answers) as resolver:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual(resolver.call_count,4)
        self.assertNotIn('certificate',self.events)
    def test_dns_wait_reports_missing_family_and_preserves_state(self):
        self.deploy.progress=lambda action='status':{'dnsReady':False,'dnsChecks':[{'role':'entry','reason':'awaiting_report','missingFamilies':['ipv6']}]}
        with patch.object(m.time,'monotonic',side_effect=[0,0,1000]), patch.object(m.time,'sleep'), patch('sys.stdout',new_callable=io.StringIO) as out:
            with self.assertRaisesRegex(m.DeploymentError,'Entry: missing or stale ipv6'):m.Deployment.wait_dns(self.deploy)
            self.assertIn('Entry: missing or stale ipv6',out.getvalue())
        self.assertTrue(self.path.exists());self.assertNotIn('restart',self.events)
    def test_entry_credential_pause_fails_without_certificate_request(self):
        self.deploy.progress=lambda action='status':{'dnsReady':False,'dnsChecks':[{'role':'entry','reason':'sync_blocked','missingFamilies':[]}]}
        with self.assertRaisesRegex(m.DeploymentError,'Entry: DNS synchronization paused'):m.Deployment.wait_dns(self.deploy)
        self.assertNotIn('certificate',self.events)
    def test_known_conflict_is_actionable_without_echoing_unknown_secrets(self):
        for detail,expected in [('节点或域名配置已变化，请核对后重新部署','Deployment configuration changed'),('secret-token','Deployment request rejected')]:
            error=m.urllib.error.HTTPError('https://panel.example.test',409,'Conflict',{},io.BytesIO(json.dumps({'detail':detail}).encode()))
            with patch.object(m.urllib.request,'build_opener') as build:
                build.return_value.open.side_effect=error
                with self.assertRaisesRegex(m.DeploymentError,expected) as caught:m.json_request('https://panel.example.test',body={'action':'status'})
                self.assertNotIn('secret-token',str(caught.exception))
    def test_relay_finish_does_not_claim_entry_connectivity(self):
        self.deploy.flow['accessMode']='relay'
        with patch('sys.stdout',new_callable=io.StringIO) as out:
            self.deploy.finish()
            self.assertIn('test a client connection',out.getvalue())
            self.assertNotIn('connection domain is active',out.getvalue())
    def test_dns_stale_ipv6_rejected(self):
        with patch.object(m,'dns_answers',return_value={'ipv4':{'8.8.8.8'},'ipv6':{'2606:4700:4700::1111'}}):
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}))
    def test_dns_does_not_ignore_a_resolver_mismatch(self):
        with patch.object(m,'dns_answers',side_effect=[{'ipv4':{'8.8.8.8'},'ipv6':set()},{'ipv4':{'1.1.1.1'},'ipv6':set()}]) as resolver:
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}));self.assertEqual(resolver.call_count,2)
    def test_dns_unavailable_provider_falls_back(self):
        good={'ipv4':{'8.8.8.8'},'ipv6':set()}
        for responses in ([OSError('offline'),good],[good,OSError('offline')]):
            with patch.object(m,'dns_answers',side_effect=responses):
                self.assertTrue(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}))
        with patch.object(m,'dns_answers',side_effect=OSError('offline')):
            with self.assertRaises(OSError):m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'})
        with patch.object(m,'dns_answers',side_effect=[OSError('offline'),{'ipv4':set(),'ipv6':set()}]):
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}))
    def test_dns_nxdomain_is_mismatch_not_service_outage(self):
        with patch.object(m,'json_request',return_value={'Status':3}):
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}))
    def test_dns_observation_identifies_role_and_never_claims_certificate_success(self):
        with patch.object(m,'dns_matches',return_value=False):
            self.assertFalse(self.deploy.verify_dns('certificate','cert.example.test',{'ipv4':'8.8.8.8'}))
        self.assertEqual(self.deploy.dns_observation,{'dnsState':'mismatch','dnsRole':'certificate'})
        with patch.object(m,'json_request',return_value={'data':{}}) as request:
            m.Deployment.progress(self.deploy)
        self.assertEqual(request.call_args.args[2],{'action':'status','dnsState':'mismatch','dnsRole':'certificate'})
    def test_unchanged_config_only(self):
        m.write_private(self.deploy.config,{'Nodes':[{'ApiKey':'someone-else'}]})
        before=self.deploy.config.read_bytes()
        with self.assertRaises(m.DeploymentError):self.deploy.prepare_config()
        self.assertEqual(before,self.deploy.config.read_bytes())
    def test_private_state_required(self):
        os.chmod(self.path,0o644)
        with self.assertRaises(m.DeploymentError):m.Deployment(self.path)
    def test_report_secret_removed_on_failure(self):
        def fail(args):
            token=Path(args[-1]);self.assertEqual(token.stat().st_mode&0o777,0o600);self.assertEqual(token.read_text(),'c'*64)
            raise m.DeploymentError('failed')
        self.deploy.command=fail
        with self.assertRaises(m.DeploymentError):m.Deployment.report(self.deploy)
        self.assertFalse(list(self.path.parent.glob('.report-*')));self.assertFalse(self.deploy.state.get('reported'))
    def test_lost_completion_response_resumes_without_restart(self):
        self.deploy.prepare_config();self.deploy.save(startAttempted=True)
        self.deploy.wait_dns=lambda:True;self.deploy.run()
        self.assertNotIn('restart',self.events);self.assertFalse(self.path.exists())
    def test_real_certificate_trust_and_name_verification(self):
        root=Path(self.tmp.name);ca=root/'ca.pem';key=root/'ca.key';cert=root/'leaf.pem';leafkey=root/'leaf.key';csr=root/'leaf.csr';ext=root/'extensions'
        ext.write_text('subjectAltName=DNS:node.example.test\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n')
        commands=[['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(ca),'-days','2','-subj','/CN=Test CA','-addext','basicConstraints=critical,CA:TRUE'],['openssl','req','-new','-newkey','rsa:2048','-nodes','-keyout',str(leafkey),'-out',str(csr),'-subj','/CN=node.example.test'],['openssl','x509','-req','-in',str(csr),'-CA',str(ca),'-CAkey',str(key),'-CAcreateserial','-out',str(cert),'-days','1','-extfile',str(ext)]]
        for command in commands:subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self.deploy.flow.update(certificateFile=str(cert),protocol='hysteria2')
        with patch.dict(os.environ,{'SSL_CERT_FILE':str(ca)}):
            m.Deployment.verify_certificate(self.deploy)
            self.deploy.flow['certificateDomain']='wrong.example.test'
            with self.assertRaises(m.DeploymentError):m.Deployment.verify_certificate(self.deploy)
        self.deploy.flow['certificateDomain']='node.example.test'
        with self.assertRaises(m.DeploymentError):m.Deployment.verify_certificate(self.deploy)
    def test_progress_retries_transient_failures_only(self):
        with patch.object(m,'json_request',side_effect=[OSError(),{'data':{'dnsReady':True}}]) as request, patch.object(m.time,'sleep'):
            self.assertTrue(m.Deployment.progress(self.deploy)['dnsReady']);self.assertEqual(request.call_count,2)
        with patch.object(m,'json_request',side_effect=m.DeploymentError('revoked')) as request:
            with self.assertRaises(m.DeploymentError):m.Deployment.progress(self.deploy)
            self.assertEqual(request.call_count,1)
    def test_machine_request_identifies_itself_without_url_secrets(self):
        class Response(io.BytesIO):
            pass
        token='dp_'+'f'*64
        with patch.object(m.urllib.request,'build_opener') as build:
            build.return_value.open.return_value=Response(b'{"data":{"dnsReady":true}}')
            self.assertTrue(m.json_request('https://panel.example.test/api/v10/server/enrollments/progress',token,{'action':'status'})['data']['dnsReady'])
            request=build.return_value.open.call_args.args[0]
            self.assertTrue(request.get_header('User-agent').startswith('v2box-deployment/'))
            self.assertEqual(request.get_header('Authorization'),'Bearer '+token)
            self.assertNotIn(token,request.full_url)
            self.assertEqual(json.loads(request.data),{'action':'status'})
            self.assertIsInstance(build.call_args.args[0],m.NoRedirect)
    def test_browser_signature_block_is_not_revocation(self):
        for body,headers in [
            ({'detail':"The site owner has blocked access based on your browser's signature.",'reflected':'dp_'+'f'*64},{'cf-ray':'test-NRT'}),
            ({'error_code':1010},{'cf-ray':'test-NRT'}),
            (None,{'cf-mitigated':'challenge','cf-ray':'invalid\nsecret'}),
        ]:
            stream=io.BytesIO(json.dumps(body).encode() if body is not None else b'<html>challenge</html>')
            error=m.urllib.error.HTTPError('https://panel.example.test',403,'Forbidden',headers,stream)
            with patch.object(m.urllib.request,'build_opener') as build:
                build.return_value.open.side_effect=error
                with self.assertRaisesRegex(m.DeploymentError,'Browser protection blocked') as caught:
                    m.json_request('https://panel.example.test',body={'action':'status'})
                self.assertNotIn('dp_',str(caught.exception));self.assertNotIn('invalid\nsecret',str(caught.exception))
                self.assertNotIn('Panel rejected',str(caught.exception))
                self.assertTrue(stream.closed)
    def test_application_403_and_other_json_errors_remain_rejected(self):
        for body in [{'code':'FORBIDDEN','detail':'revoked'},[],None,'not json']:
            stream=io.BytesIO(json.dumps(body).encode())
            error=m.urllib.error.HTTPError('https://panel.example.test',403,'Forbidden',{'cf-ray':'test-NRT'},stream)
            with patch.object(m.urllib.request,'build_opener') as build:
                build.return_value.open.side_effect=error
                with self.assertRaisesRegex(m.DeploymentError,'Deployment request rejected'):
                    m.json_request('https://panel.example.test',body={'action':'status'})
                self.assertTrue(stream.closed)
    def test_inactive_tls_ignores_leftover_http_certificate_settings(self):
        for tls in (0,2):
            self.deploy.flow['tls']=tls
            self.deploy.flow['certificateDomain']='stale.example.test'
            with patch.object(m.socket,'socket',side_effect=AssertionError('HTTP port must not be probed')):
                m.Deployment.check_http_port(self.deploy)
            self.deploy.progress=lambda action='status':{'dnsReady':True,'addresses':{'ipv4':'8.8.8.8'}}
            with patch.object(m,'dns_matches',return_value=True) as dns:
                self.assertFalse(m.Deployment.wait_dns(self.deploy))
                dns.assert_called_once_with('node.example.test',{'ipv4':'8.8.8.8'})
    def test_port_conflict_never_starts_certificate_request(self):
        with patch.object(m.socket,'socket',side_effect=OSError(m.errno.EADDRINUSE,'in use')):
            with self.assertRaises(m.DeploymentError):m.Deployment.check_http_port(self.deploy)
class ApiOriginMigrationTest(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('api_migration',Path(sys.argv[1]).with_name('node-api-migrate.py'))
        self.a=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.a)
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.a.ROOT=self.root/'v2box';self.a.NETWORK=self.root/'network';self.a.NETWORK_STATE=self.root/'network-state';self.a.JOURNAL=self.a.ROOT/'api-migration.json'
        for d in (self.a.ROOT,self.a.NETWORK,self.a.NETWORK_STATE):d.mkdir()
        self.old='https://old.example.test';self.new='https://new.example.test:8443'
        self.document={'OperatorSetting':{'keep':True},'Nodes':[{'ApiHost':self.old,'ApiKey':'existing-node-key','NodeID':3,'NodeType':'v2box','ApiVersion':'v10','CertificateDirectory':'/existing/certificates','TrafficSpoolDirectory':str(self.root/'traffic')},{'ApiHost':'https://another.example.test','ApiKey':'another-key','NodeID':3,'NodeType':'v2box','CertificateDirectory':'/another/certificates'}]}
        self.a.private(self.a.ROOT/'config.json',json.dumps(self.document).encode())
        self.before=(self.a.ROOT/'config.json').read_bytes()
        self.old_spool=self.root/'traffic'/self.a.hashlib.sha256((self.old+':3').encode()).hexdigest();self.old_spool.mkdir(parents=True)
        (self.old_spool/'pending.json').write_text('pending-traffic-batch')
        self.requests=[]
        def request(url,token,body=None,node_id=None):
            self.requests.append((url,token,body,node_id))
            if node_id is not None:return {'protocol':'vless','listenPort':443}
            if body['action']=='probe':return {'fromApiHost':self.old,'toApiHost':self.new,'nodeIds':[3],'proof':'same-backend-proof'}
            return {'ready':body['action']=='status','failed':False}
        self.request=patch.object(self.a,'request',side_effect=request);self.request.start();self.addCleanup(self.request.stop)
        self.state=patch.object(self.a,'service_state',return_value=False);self.state_mock=self.state.start();self.addCleanup(self.state.stop)
        self.reload=patch.object(self.a,'reload_service');self.reload_mock=self.reload.start();self.addCleanup(self.reload.stop)
        self.addCleanup(self.temp.cleanup)
    def migration(self):return self.a.Migration(self.old,self.new,'am_'+'a'*64,3)
    def test_stopped_migration_preserves_key_certificate_other_panel_and_pending_traffic(self):
        self.migration().run()
        after=json.loads((self.a.ROOT/'config.json').read_text())
        self.assertEqual(after['Nodes'][0],dict(self.document['Nodes'][0],ApiHost=self.new))
        self.assertEqual(after['Nodes'][1],self.document['Nodes'][1]);self.assertEqual(after['OperatorSetting'],self.document['OperatorSetting'])
        new_spool=self.root/'traffic'/self.a.hashlib.sha256((self.new+':3').encode()).hexdigest()
        self.assertEqual((new_spool/'pending.json').read_text(),'pending-traffic-batch')
        self.reload_mock.assert_not_called();self.assertEqual(self.a.JOURNAL.stat().st_mode&0o777,0o600)
        self.a.rollback(self.a.read(self.a.JOURNAL))
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
        self.assertFalse(new_spool.is_symlink());self.assertTrue((self.old_spool/'pending.json').exists())
    def test_default_certificate_namespace_is_pinned_to_old_origin(self):
        self.document['Nodes'][0].pop('CertificateDirectory')
        self.a.private(self.a.ROOT/'config.json',json.dumps(self.document).encode());self.migration().run()
        node=self.a.read(self.a.ROOT/'config.json')['Nodes'][0]
        self.assertIn(self.a.hashlib.sha256(self.old.encode()).hexdigest()[:16],node['CertificateDirectory'])
    def test_completed_command_is_idempotent_without_reusing_authority(self):
        self.migration().run();calls=len(self.requests);before=(self.a.ROOT/'config.json').read_bytes()
        self.migration().run()
        self.assertEqual(len(self.requests),calls);self.assertEqual((self.a.ROOT/'config.json').read_bytes(),before)
    def test_default_https_port_and_unrelated_panel_path_are_preserved(self):
        self.assertEqual(self.a.origin('https://OLD.example.test:443/'),self.old)
        self.document['Nodes'][1]['ApiHost']='https://another.example.test/panel'
        self.a.private(self.a.ROOT/'config.json',json.dumps(self.document).encode());self.migration().run()
        self.assertEqual(self.a.read(self.a.ROOT/'config.json')['Nodes'][1],self.document['Nodes'][1])
    def test_wrong_backend_proof_never_receives_existing_node_key(self):
        original=self.a.request
        def wrong(url,*args,**kwargs):
            result=original(url,*args,**kwargs)
            return dict(result,proof='wrong-backend') if url.startswith(self.new) else result
        with patch.object(self.a,'request',side_effect=wrong):
            with self.assertRaises(self.a.MigrationError):self.migration().run()
        self.assertFalse(any(item[3] is not None for item in self.requests))
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
    def test_duplicate_destination_preserves_both_panels(self):
        self.document['Nodes'].append(dict(self.document['Nodes'][0],ApiHost=self.new))
        self.a.private(self.a.ROOT/'config.json',json.dumps(self.document).encode());before=(self.a.ROOT/'config.json').read_bytes()
        with self.assertRaises(self.a.MigrationError):self.migration().run()
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),before)
    def test_interrupted_partial_write_rolls_back_from_private_journal(self):
        migration=self.migration();migration.prepare()
        journal={'files':migration.files,'active':False,'nodeIds':[3],'status':'prepared'}
        self.a.private(self.a.JOURNAL,json.dumps(journal).encode())
        self.a.install(migration.files[0],'after')
        self.a.rollback(self.a.read(self.a.JOURNAL))
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
    def test_rollback_conflict_preserves_later_operator_edit(self):
        self.migration().run();journal=self.a.read(self.a.JOURNAL)
        changed=json.loads((self.a.ROOT/'config.json').read_text());changed['operator']='later-edit'
        self.a.private(self.a.ROOT/'config.json',json.dumps(changed).encode())
        with self.assertRaisesRegex(self.a.MigrationError,'Rollback conflict'):self.a.rollback(journal)
        self.assertEqual(self.a.read(self.a.ROOT/'config.json'),changed)
    @unittest.skipUnless(os.environ.get('V2BOX_NETWORK_SCRIPT'),'real network helper required')
    def test_reporting_targets_tokens_backoff_and_identity_migrate_and_rollback(self):
        spec=importlib.util.spec_from_file_location('migration_network',os.environ['V2BOX_NETWORK_SCRIPT']);network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
        old={'mode':'panel','panel_url':self.old,'token':'c'*64,'family':'ipv4','server_id':7}
        other={'mode':'panel','panel_url':'https://another.example.test','token':'d'*64,'family':'dual','server_id':7}
        dns={'zone_id':'a'*32,'domain':'direct.example.test','token':'dns-token','family':'ipv4'}
        config={'mode':'multi','targets':[old,other,dns]};state={'targets':{network.target_key(old):{'paused':True,'next_run':123},network.target_key(other):{'paused':True,'next_run':456}}}
        self.a.private(self.a.NETWORK/'cloudflare.json',json.dumps(config).encode());self.a.private(self.a.NETWORK_STATE/'state.json',json.dumps(state).encode())
        old_identity=self.a.NETWORK/'identities'/(self.a.hashlib.sha256(self.old.encode()).hexdigest()[:24]+'.json')
        self.a.private(old_identity,json.dumps({'panelUrl':self.old,'serverId':7}).encode())
        self.a.private(self.a.NETWORK/'server-identity',(self.old+'/7\n').encode())
        before={p:p.read_bytes() for p in (self.a.NETWORK/'cloudflare.json',self.a.NETWORK_STATE/'state.json',old_identity,self.a.NETWORK/'server-identity')}
        migration=self.migration();migration.network=network
        with patch.object(network,'report') as report:
            migration.run()
            migrated=self.a.read(self.a.NETWORK/'cloudflare.json')['targets']
            self.assertEqual(migrated,[dict(old,panel_url=self.new),other,dns]);report.assert_called_once()
            migrated_state=self.a.read(self.a.NETWORK_STATE/'state.json')['targets']
            self.assertEqual(migrated_state[network.target_key(other)],state['targets'][network.target_key(other)])
            self.assertNotIn('next_run',migrated_state[network.target_key(migrated[0])])
            self.assertNotIn('paused',migrated_state[network.target_key(migrated[0])])
            self.assertEqual((self.a.NETWORK/'server-identity').read_text(),self.new+'/7\n')
            self.a.rollback(self.a.read(self.a.JOURNAL))
        for path,raw in before.items():self.assertEqual(path.read_bytes(),raw)
    @unittest.skipUnless(os.environ.get('V2BOX_NETWORK_SCRIPT'),'real network helper required')
    def test_independent_report_server_migrates_without_node_configuration_or_service(self):
        spec=importlib.util.spec_from_file_location('report_only_network',os.environ['V2BOX_NETWORK_SCRIPT']);network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
        (self.a.ROOT/'config.json').unlink()
        old={'mode':'panel','panel_url':self.old,'token':'c'*64,'family':'ipv4','server_id':7}
        self.a.private(self.a.NETWORK/'cloudflare.json',json.dumps(old).encode())
        migration=self.a.Migration(self.old,self.new,'am_'+'a'*64,None,7);migration.network=network
        def probe(url,token,body=None,**kwargs):return {'fromApiHost':self.old,'toApiHost':self.new,'nodeIds':[],'serverId':7,'proof':'same-backend-proof'}
        with patch.object(self.a,'request',side_effect=probe),patch.object(network,'report') as report:
            migration.run()
        self.assertEqual(self.a.read(self.a.NETWORK/'cloudflare.json'),dict(old,panel_url=self.new))
        self.assertFalse((self.a.ROOT/'config.json').exists());report.assert_called_once();self.state_mock.assert_not_called()
        self.reload_mock.assert_not_called()
    @unittest.skipUnless(os.environ.get('V2BOX_NETWORK_SCRIPT'),'real network helper required')
    def test_ip_report_failure_restores_nodes_reporting_token_and_address(self):
        spec=importlib.util.spec_from_file_location('failed_report_network',os.environ['V2BOX_NETWORK_SCRIPT']);network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
        old={'mode':'panel','panel_url':self.old,'token':'c'*64,'family':'ipv4','server_id':7}
        self.a.private(self.a.NETWORK/'cloudflare.json',json.dumps(old).encode());before=(self.a.NETWORK/'cloudflare.json').read_bytes()
        migration=self.migration();migration.network=network
        with patch.object(network,'report',side_effect=network.NetworkError('report rejected')):
            with self.assertRaises(network.NetworkError):migration.run()
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
        self.assertEqual((self.a.NETWORK/'cloudflare.json').read_bytes(),before)
        self.assertEqual(self.a.read(self.a.JOURNAL)['status'],'rolledBack')
    def test_reload_failure_automatically_restores_original_configuration(self):
        with patch.object(self.a,'service_state',return_value=True),patch.object(self.a.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'{"features":["multi-panel-v1","reload-signal-v1"]}','')),patch.object(self.a,'reload_service',side_effect=[self.a.MigrationError('reload failed'),None]):
            with self.assertRaisesRegex(self.a.MigrationError,'reload failed'):self.migration().run()
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
        self.assertEqual(self.a.read(self.a.JOURNAL)['status'],'rolledBack')
    def test_failed_new_origin_receipt_rolls_back_without_restart(self):
        original=self.a.request
        def failed(url,token,body=None,**kwargs):
            return {'ready':False,'failed':True} if body and body['action']=='status' else original(url,token,body,**kwargs)
        with patch.object(self.a,'service_state',return_value=True),patch.object(self.a.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'{"features":["multi-panel-v1","reload-signal-v1"]}','')),patch.object(self.a,'request',side_effect=failed):
            with self.assertRaisesRegex(self.a.MigrationError,'rejected'):self.migration().run()
        self.assertEqual(self.reload_mock.call_count,2);self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
    def test_missing_new_origin_receipt_times_out_and_restores_original_files(self):
        with patch.object(self.a,'service_state',return_value=True),patch.object(self.a.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'{"features":["multi-panel-v1","reload-signal-v1"]}','')),patch.object(self.a.time,'monotonic',side_effect=[0,181]):
            with self.assertRaisesRegex(self.a.MigrationError,'timed out'):self.migration().run()
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before);self.assertEqual(self.reload_mock.call_count,2)
    def test_rollback_reload_failure_is_retained_as_needing_recovery(self):
        self.migration().run();journal=self.a.read(self.a.JOURNAL);journal['active']=True
        with patch.object(self.a,'reload_service',side_effect=subprocess.CalledProcessError(1,['v2box','reload'])):
            with self.assertRaisesRegex(self.a.MigrationError,'Original files restored'):self.a.rollback(journal)
        self.assertEqual((self.a.ROOT/'config.json').read_bytes(),self.before)
        self.assertEqual(self.a.read(self.a.JOURNAL)['status'],'rollbackNeedsReload')
    def test_symlinked_node_configuration_is_rejected_without_mutation(self):
        config=self.a.ROOT/'config.json';target=self.root/'original-config';config.rename(target);config.symlink_to(target)
        with self.assertRaises(self.a.MigrationError):self.migration().run()
        self.assertEqual(target.read_bytes(),self.before)

unittest.main(argv=['deployment-tests'])
PY;
        $pipes=[];$process=proc_open(['python3','-',resource_path('scripts/node-deploy.py')],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
        fwrite($pipes[0],$python);fclose($pipes[0]);$output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$exit=proc_close($process);
        $assert($exit===0,'Deployment workflow tests: '.$output);
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
