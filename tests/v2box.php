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
        $assert(str_contains($node['install_command'],'--install v1.0.5'),'Installer uses published version, not legacy main');
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
    foreach (getenv('V2BOX_BOOTSTRAP_TEST')==='1' ? [[0,false],[1,false],[0,true],[1,true]] : [] as [$reportFailure,$networkOnly]) {
        $fixture=sys_get_temp_dir().'/v2box-deploy-test-'.bin2hex(random_bytes(8));
        mkdir($fixture,0700);mkdir($fixture.'/bin',0700);mkdir($fixture.'/tmp',0700);mkdir($fixture.'/lib',0700);
        try {
            $response=['data'=>['nodeId'=>3,'nodeType'=>'v2box','apiHost'=>'https://panel.example.invalid','apiKey'=>'nk_'.str_repeat('a',32).'.'.str_repeat('b',64),'networkReport'=>['token'=>str_repeat('c',64),'family'=>'ipv4']]];
            $originalKey=$response['data']['apiKey'];
            if ($networkOnly) {
                mkdir($fixture.'/config',0700);
                file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['NodeType'=>'v2box','NodeID'=>3,'ApiHost'=>'https://panel.example.invalid','ApiKey'=>$originalKey]]]));
                $originalHash=hash_file('sha256',$fixture.'/config/config.json');
                unset($response['data']['apiKey']);$response['data']['purpose']='network';
            }
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
            $run=function($failure=null)use($fixture,$reportFailure,$networkOnly){
                $pipes=[];$p=proc_open(['bash',$fixture.'/bootstrap.sh',...($networkOnly?['--network-only']:[]),'--api-host','https://panel.example.invalid','--node-id','3','--deploy-token','nd_'.str_repeat('d',64)],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes,null,array_merge(getenv(),['PATH'=>$fixture.'/bin:'.getenv('PATH'),'TMPDIR'=>$fixture.'/tmp','DNS_FIXTURE'=>$fixture,'DNS_REPORT_FAILURE'=>(string)($failure??$reportFailure)]));
                fclose($pipes[0]);$output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);return [proc_close($p),$output];
            };
            [$exit,$output]=$run();
            $assert($exit===$reportFailure,'Deployment bootstrap reports address setup result: '.$exit.' '.preg_replace('/(?:nk_|nd_)?[a-f0-9.]{64,}/','[redacted]',$output));
            if ($networkOnly) {
                $assert(file_get_contents($fixture.'/events')==="report\n",'Network-only setup never restarts node');
                $assert(hash_file('sha256',$fixture.'/config/config.json')===$originalHash,'Network-only setup preserves node configuration and key');
                $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Network-only setup cleans temporary secrets');
                if ($reportFailure) {
                    $assert(is_file($fixture.'/network/enrollment-state.json') && (fileperms($fixture.'/network/enrollment-state.json')&0777)===0600,'Failure retains private state for resume');
                    [$resumed]=$run(0);
                    $assert($resumed===0 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Resume uses private state without redeeming consumed grant');
                }
                $assert(!file_exists($fixture.'/network/enrollment-state.json'),'Successful reporting removes enrollment secret');
                file_put_contents($fixture.'/config/config.json',json_encode(['Nodes'=>[['NodeType'=>'v2box','NodeID'=>999,'ApiHost'=>'https://panel.example.invalid']]]));
                [$wrong]=$run(0);
                $assert($wrong===1 && file_get_contents($fixture.'/redemptions')==="redeemed\n",'Wrong node rejected before grant consumption');
                continue;
            }
            $assert(file_get_contents($fixture.'/events')===($reportFailure ? "report\n" : "report\nrestart\n"),'IP reporting must succeed before starting the node');
            $config=json_decode(file_get_contents($fixture.'/config/config.json'),true);
            $assert($config['Nodes'][0]['ApiKey']===$response['data']['apiKey'] && (fileperms($fixture.'/config/config.json')&0777)===0600,'Deployment atomically installs private node configuration');
            $assert(!str_contains($output,$response['data']['networkReport']['token']) && count(glob($fixture.'/tmp/*'))===0,'Deployment removes temporary reporting secrets');
            $before=hash_file('sha256',$fixture.'/config/config.json');[$exit]=$run();
            $assert($exit===1 && hash_file('sha256',$fixture.'/config/config.json')===$before,'Redeployment preserves existing node config');
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
import importlib.util, json, os, sys, tempfile, unittest, subprocess
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
        self.deploy.command=lambda args:self.events.append('restart')
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
    def test_dns_stale_ipv6_rejected(self):
        with patch.object(m,'dns_answers',return_value={'ipv4':{'8.8.8.8'},'ipv6':{'2606:4700:4700::1111'}}):
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}))
    def test_dns_requires_both_resolvers(self):
        with patch.object(m,'dns_answers',side_effect=[{'ipv4':{'8.8.8.8'},'ipv6':set()},{'ipv4':{'1.1.1.1'},'ipv6':set()}]) as resolver:
            self.assertFalse(m.dns_matches('node.example.test',{'ipv4':'8.8.8.8'}));self.assertEqual(resolver.call_count,2)
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
