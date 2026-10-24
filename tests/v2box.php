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
        $assert(str_contains($node['install_command'],'--install v1.0.6'),'Installer uses published version, not legacy main');
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
response=false
while (($#)); do
  case "$1" in
    -o) out=$2; shift;;
    */enrollments/redeem) response=true;;
  esac
  shift
done
if $response; then echo redeemed >> "$DNS_FIXTURE/redemptions"; cp "$DNS_FIXTURE/response.json" "$out"; else printf '#!/bin/bash\nexit 0\n' > "$out"; fi
SH,
                'v2box'=><<<'SH'
#!/bin/bash
[[ "$1" == restart ]] || exit 1
echo restart >> "$DNS_FIXTURE/events"
SH,
                'python3'=><<<'SH'
#!/bin/bash
set -eu
if [[ "$1" == -m && "$2" == py_compile ]]; then exit 0; fi
if [[ "$1" == */panel-deploy.py ]]; then exec /usr/bin/python3 "$@"; fi
[[ "$1" == */node-network.py && "$2" == report-configure && "$3" == --panel-url && "$4" == https://panel.example.invalid && "$5" == --family && "$6" == ipv4 && "$7" == --token-file ]] || exit 2
[[ "$(stat -c %a "$8")" == 600 && "$(cat "$8")" =~ ^c{64}$ ]] || exit 3
echo report >> "$DNS_FIXTURE/events"
exit "$DNS_REPORT_FAILURE"
SH,
            ];
            foreach ($mocks as $name=>$script) {file_put_contents($fixture.'/bin/'.$name,$script."\n");chmod($fixture.'/bin/'.$name,0700);}
            $script=str_replace('__NODE_DEPLOY_HELPER__',file_get_contents(resource_path('scripts/node-deploy.py')),file_get_contents(resource_path('scripts/node-deploy.sh')));
            $script=str_replace(['__NODE_PREREQUISITES__','/etc/v2box','/usr/local/lib/v2box','/etc/node-network'],['',$fixture.'/config',$fixture.'/lib',$fixture.'/network'],$script);
            file_put_contents($fixture.'/bootstrap.sh',$script);
            $run=function($failure=null,$nodeId=3)use($fixture,$reportFailure,$networkOnly,$serverOnly){
                $pipes=[];$p=proc_open(['bash',$fixture.'/bootstrap.sh',...($networkOnly && !$serverOnly?['--network-only']:[]),'--api-host','https://panel.example.invalid',...($serverOnly?['--server-id','7']:['--node-id',(string)$nodeId]),'--deploy-token',($serverOnly?'ns_':'nd_').str_repeat('d',64)],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes,null,array_merge(getenv(),['PATH'=>$fixture.'/bin:'.getenv('PATH'),'TMPDIR'=>$fixture.'/tmp','DNS_FIXTURE'=>$fixture,'DNS_REPORT_FAILURE'=>(string)($failure??$reportFailure)]));
                fclose($pipes[0]);$output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);return [proc_close($p),$output];
            };
            [$exit,$output]=$run();
            $assert($exit===$reportFailure,'Deployment bootstrap reports address setup result: '.$exit.' '.preg_replace('/(?:nk_|nd_)?[a-f0-9.]{64,}/','[redacted]',$output));
            if ($networkOnly) {
                $assert(file_get_contents($fixture.'/events')==="report\n",'Network-only setup never restarts node');
                $assert($serverOnly ? !file_exists($fixture.'/config/config.json') : hash_file('sha256',$fixture.'/config/config.json')===$originalHash,'Network-only setup preserves node configuration and key');
                $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Network-only setup cleans temporary secrets');
                if ($reportFailure) {
                    $assert(is_file($fixture.'/network/enrollment-state.json') && (fileperms($fixture.'/network/enrollment-state.json')&0777)===0600,'Failure retains private state for resume');
                    [$resumed]=$run(0);
                    $assert($resumed===0 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Resume uses private state without redeeming consumed grant');
                }
                $assert(!file_exists($fixture.'/network/enrollment-state.json'),'Successful reporting removes enrollment secret');
                if ($serverOnly) file_put_contents($fixture.'/network/server-identity',"https://panel.example.invalid/999\n");
                else file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['NodeType'=>'v2box','NodeID'=>999,'ApiHost'=>'https://panel.example.invalid']]]));
                [$wrong]=$run(0);
                $assert($wrong===1 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Wrong node rejected before grant consumption');
                continue;
            }
            $assert(file_get_contents($fixture.'/events')===($reportFailure ? "report\n" : "report\nrestart\n"),'IP reporting must succeed before starting the node');
            if ($reportFailure) {
                $assert(!file_exists($fixture.'/config/config.json'),'Failed reporting must not write live node configuration');
                [$resumed]=$run(0);
                $assert($resumed===0 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Failed reporting resumes without consuming another grant');
            }
            $config=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($config['Nodes'][0]['ApiKey']===$response['data']['apiKey'] && (fileperms($fixture.'/config/config.json')&0777)===0600,'Deployment atomically installs private node configuration');
            $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Deployment removes temporary reporting secrets');
            $before=hash_file('sha256',$fixture.'/config/config.json');[$exit]=$run();
            $assert($exit===1 && hash_file('sha256',$fixture.'/config/config.json')===$before,'Redeployment preserves existing node config');
            file_put_contents($fixture.'/lib/v2box',"#!/bin/sh\nexit 0\n");chmod($fixture.'/lib/v2box',0700);
            $response['data']['nodeId']=4;file_put_contents($fixture.'/response.json',json_encode($response));
            [$added,$addedOutput]=$run(0,4);
            $combined=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($added===0 && array_column($combined['Nodes'],'NodeID')===[3,4],'Existing installation appends another service: '.$addedOutput);
            $assert($combined['Nodes'][0]===$config['Nodes'][0],'Appending preserves existing service configuration');
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
    def test_order_and_private_config(self):
        self.deploy.run()
        self.assertEqual(self.events,['report','dns','port','start','restart','status','certificate','complete'])
        self.assertFalse(self.path.exists());self.assertEqual(self.deploy.config.stat().st_mode&0o777,0o600)
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
        backup=self.path.parent/'config.before-add-4.json'
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
        self.assertIn('restart',self.events)
        self.assertFalse(self.deploy.state['startAttempted'])
    def test_rollback_does_not_overwrite_operator_changes(self):
        self.deploy.prepare_config()
        self.deploy.data['nodeId']=4
        self.deploy.prepare_config()
        changed=json.loads(self.deploy.config.read_text());changed['Log']={'Level':'debug'}
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
    def test_port_conflict_never_starts_certificate_request(self):
        with patch.object(m.socket,'socket',side_effect=OSError(m.errno.EADDRINUSE,'in use')):
            with self.assertRaises(m.DeploymentError):m.Deployment.check_http_port(self.deploy)
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
