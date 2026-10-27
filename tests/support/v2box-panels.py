#!/usr/bin/env python3
"""Private workers for tests/v2box.php: real independent panels and one V2Box process."""
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile

def wait(check, label, seconds=35):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        try:
            if check(): return
        except (OSError,ValueError,KeyError): pass
        time.sleep(.1)
    raise AssertionError(label)

def listening(port):
    try:
        with socket.create_connection(('127.0.0.1',port),.2): return True
    except OSError: return False

def php(panel, code):
    program='require "tests/support/autoload.php"; $app=require "bootstrap/app.php"; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); '+code
    p=subprocess.run(['php','-r',program],cwd=panel['root'],env=panel['environment'],capture_output=True,text=True,timeout=30)
    if p.returncode: raise AssertionError('Independent panel control failed: '+re.sub(r'(?:nk_|nd_|am_)[a-f0-9.]+','[redacted]',(p.stderr or p.stdout)[-1000:]))
    return json.loads(p.stdout)

def exact(stream,length):
    result=b''
    while len(result)<length:
        piece=stream.recv(length-len(result))
        if not piece: raise AssertionError('Proxy stream closed unexpectedly')
        result+=piece
    return result

def connect(panel, port, echo, context):
    stream=socket.create_connection(('127.0.0.1',port),5)
    if panel.get('proxyTls', panel['origin'].startswith('https://panel-a.')):
        stream=context.wrap_socket(stream,server_hostname='node-a.example.test')
    stream.settimeout(5)
    stream.sendall(b'\x00'+uuid.UUID(panel['uuid']).bytes+bytes([0,1])+echo.to_bytes(2,'big')+bytes([1,127,0,0,1])+b'x')
    assert exact(stream,3)==b'\x00\x00x','VLESS proxy handshake failed'
    return stream

def ping(stream, payload=b'independent-panel-still-active'):
    stream.sendall(payload);assert exact(stream,len(payload))==payload,'Independent proxy payload corrupted'

def run(manifest):
    assert os.environ.get('TEST_DISPOSABLE_WORKSPACE')=='1' and Path('/.dockerenv').exists(),'Only run through the disposable PHP test module'
    fixture=json.loads(Path(manifest).read_text());root=Path(fixture['root']);panels=fixture['panels'];a,b=panels
    assert a['database']!=b['database'] and all(p['database'].startswith('v2box_multi_') for p in panels)
    assert a['userId']==b['userId'] and a['nodeId']==b['nodeId']==3 and a['serverId']==b['serverId']==7,'Fixture IDs must collide across independent databases'
    assert a['environment']['APP_KEY']!=b['environment']['APP_KEY'],'Independent panels must not share application keys'
    assert not Path('/etc/v2box/config.json').exists(),'Fixture refuses an existing node configuration'
    assert not Path('/etc/node-network/cloudflare.json').exists(),'Fixture refuses existing IP reporting configuration'
    assert not Path('/etc/systemd/system/v2box.service').exists() and not Path('/etc/systemd/system/v2box.service').is_symlink(),'Fixture refuses an existing service unit'
    workers=[];servers=[];streams=[];logs=[];node=None
    env=dict(os.environ)
    env['NO_PROXY']=env['no_proxy']='127.0.0.1,localhost,panel-a.test,panel-b.test,panel-a-new.test'
    os.environ['NO_PROXY']=os.environ['no_proxy']=env['NO_PROXY']
    try:
        # Use the published program/scripts, checking the release digest before execution.
        asset=root/'v2box-linux-amd64.zip'
        subprocess.run(['curl','-fsSL','--max-time','120','https://github.com/lenaanderson5566-ops/v2box/releases/download/v1.0.14/v2box-linux-amd64.zip','-o',str(asset)],check=True,timeout=130)
        assert hashlib.sha256(asset.read_bytes()).hexdigest()=='fb5353695e84952af1d8bad9ad221d6f3e9b14ef3c48b4ee2cb45450df828c7c','Published release digest changed'
        program=Path('/usr/local/lib/v2box');program.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(asset) as archive:
            for name in ['v2box','v2box.sh','install.sh','node-network.py','node-credentials.py']:
                member=[n for n in archive.namelist() if Path(n).name==name]
                assert len(member)==1,'Release helper missing or ambiguous'
                target=program/('manager.sh' if name=='v2box.sh' else name)
                target.write_bytes(archive.read(member[0]));target.chmod(0o755)
        shutil.copy2(program/'manager.sh','/usr/local/bin/v2box')
        # Both real HTTPS panels and the proxy certificate use a private fixture CA.
        ca=root/'ca.pem';key=root/'ca.key';leaf=root/'leaf.pem';leaf_key=root/'leaf.key';csr=root/'leaf.csr';ext=root/'leaf.ext'
        ext.write_text('subjectAltName=DNS:panel-a.test,DNS:panel-b.test,DNS:panel-a-new.test,DNS:node-a.example.test\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
        commands=[['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(ca),'-days','1','-subj','/CN=Independent panel fixture CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'],['openssl','req','-newkey','rsa:2048','-nodes','-keyout',str(leaf_key),'-out',str(csr),'-subj','/CN=panel-a.test'],['openssl','x509','-req','-in',str(csr),'-CA',str(ca),'-CAkey',str(key),'-CAcreateserial','-out',str(leaf),'-days','1','-extfile',str(ext)]]
        for command in commands:subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
        bundle=root/'ca-bundle.pem';bundle.write_bytes(Path('/etc/ssl/certs/ca-certificates.crt').read_bytes()+ca.read_bytes())
        context=ssl.create_default_context(cafile=str(bundle))
        os.environ['SSL_CERT_FILE']=str(bundle);env['SSL_CERT_FILE']=str(bundle);env['CURL_CA_BUNDLE']=str(bundle)
        wgetrc=root/'wgetrc';wgetrc.write_text('ca_certificate = '+str(bundle)+'\n');env['WGETRC']=str(wgetrc)
        with open('/etc/hosts','a') as hosts:hosts.write('\n127.0.0.1 panel-a.test panel-b.test panel-a-new.test\n')
        for p in panels:
            log=open(root/(p['database']+'.log'),'wb');logs.append(log)
            worker=subprocess.Popen(['php','artisan','serve','--no-reload','--host=127.0.0.1','--port='+str(p['httpPort'])],cwd=p['root'],env=p['environment'],stdout=log,stderr=log,start_new_session=True)
            workers.append(worker);wait(lambda:listening(p['httpPort']),'Real panel HTTP worker did not start')
            p['online']=True
            class Proxy(BaseHTTPRequestHandler):
                panel=p
                def log_message(self,*args):pass
                def do_GET(self):self.relay()
                def do_POST(self):self.relay()
                def relay(self):
                    if self.path=='/fixture-ip':data=b'8.8.8.8';status=200;headers={'Content-Type':'text/plain'}
                    elif not self.panel['online'] or (self.panel.get('redeemUnavailable') and self.path=='/api/v10/server/enrollments/redeem'):data=b'{}';status=503;headers={'Content-Type':'application/json'}
                    else:
                        connection=http.client.HTTPConnection('127.0.0.1',self.panel['httpPort'],timeout=20)
                        try:
                            body=self.rfile.read(int(self.headers.get('Content-Length','0')))
                            headers={k:v for k,v in self.headers.items() if k.lower() not in ('connection','accept-encoding')}
                            connection.request(self.command,self.path,body=body,headers=headers);response=connection.getresponse();data=response.read();status=response.status
                            headers={k:v for k,v in response.getheaders() if k.lower() not in ('transfer-encoding','connection','content-length')}
                        finally:connection.close()
                    self.send_response(status)
                    for k,v in headers.items():self.send_header(k,v)
                    self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            server=ThreadingHTTPServer(('127.0.0.1',int(p['origin'].rsplit(':',1)[1])),Proxy)
            tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(leaf,leaf_key);server.socket=tls.wrap_socket(server.socket,server_side=True)
            servers.append(server);threading.Thread(target=server.serve_forever,daemon=True).start()
        # Only the service manager and public-IP discovery source are test doubles.
        # Node binary, both Laravel APIs, databases, keys and report endpoints are real.
        bin_dir=root/'bin';bin_dir.mkdir();pid_file=root/'node.pid';events=root/'service-events.jsonl'
        systemctl=bin_dir/'systemctl'
        systemctl.write_text('#!/usr/bin/env python3\nimport os,sys,signal,json\nfrom pathlib import Path\np=Path('+repr(str(pid_file))+')\npid=int(p.read_text()) if p.exists() else 0\na=sys.argv[1:]\nif a and a[0]=="show": print(pid if any("MainPID" in x for x in a) else ("active" if pid else "inactive"))\nelif a and a[0]=="is-active": sys.exit(0 if pid else 3)\nelif a and a[0]=="kill": os.kill(pid,signal.SIGHUP)\nelif "v2box" in a and a and a[0] in ("restart","stop","start"):\n with open('+repr(str(events))+',"a") as f:f.write(json.dumps(a)+"\\n")\n sys.exit(1)\n')
        systemctl.chmod(0o755);env['PATH']=str(bin_dir)+':'+env['PATH'];os.environ['PATH']=env['PATH']
        Path('/run/systemd/system').mkdir(parents=True,exist_ok=True)
        real_network=program/'node-network-real.py';shutil.copy2(program/'node-network.py',real_network)
        (program/'node-network.py').write_text('#!/usr/bin/env python3\nimport importlib.util,sys\ns=importlib.util.spec_from_file_location("network",'+repr(str(real_network))+');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.IP_SERVICES={"A":['+repr(a['origin']+'/fixture-ip')+'],"AAAA":[]}\ntry:m.main()\nexcept m.NetworkError:sys.exit(1)\n')
        (program/'node-network.py').chmod(0o755)
        node_root=Path('/etc/v2box');node_root.mkdir(parents=True,exist_ok=True)
        shutil.copy2(leaf,node_root/'operator-cert.pem');shutil.copy2(leaf_key,node_root/'operator-key.pem')
        cert_before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in node_root.glob('operator-*.pem')}
        entry={'ApiHost':a['origin'],'ApiKey':a['nodeKey'],'NodeID':3,'NodeType':'v2box','ApiVersion':'v10','CertificateDirectory':'/etc/v2box/operator-cert-directory'}
        configuration={'OutboundAllowCIDRs':['127.0.0.0/8'],'OperatorSetting':'retained','Nodes':[entry]}
        config=node_root/'config.json';config.write_text(json.dumps(configuration));config.chmod(0o600)
        report_root=Path('/etc/node-network');report_root.mkdir(parents=True,exist_ok=True)
        report_a={'mode':'panel','panel_url':a['origin'],'token':a['report']['token'],'family':'ipv4','server_id':7}
        direct={'zone_id':'a'*32,'domain':'retained.example.test','token':'retained-direct-dns-fixture','family':'ipv4'}
        spec=importlib.util.spec_from_file_location('fixture_network',real_network);network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
        network.write_private(network.CONFIG,{'mode':'multi','targets':[report_a,direct]})
        direct_state={'paused':True,'next_run':time.time()+86400,'fingerprint':network.fingerprint(direct)}
        network.write_private(network.STATE,{'targets':{network.target_key(direct):direct_state}})
        identities=report_root/'identities';identities.mkdir(exist_ok=True)
        network.write_private(identities/(hashlib.sha256(a['origin'].encode()).hexdigest()[:24]+'.json'),{'panelUrl':a['origin'],'serverId':7})
        (report_root/'server-identity').write_text(a['origin']+'/7\n');(report_root/'server-identity').chmod(0o600)
        log=open(root/'node.log','wb');logs.append(log)
        node=subprocess.Popen([str(program/'v2box'),'server','--config',str(config),'--watch=false'],env=env,stdout=log,stderr=log,start_new_session=True);pid_file.write_text(str(node.pid))
        wait(lambda:listening(a['port']),'Existing independent panel A node did not start')
        class Echo(socketserver.BaseRequestHandler):
            def handle(self):
                try:
                    while True:
                        data=self.request.recv(65536)
                        if not data:return
                        self.request.sendall(data)
                except ConnectionError:pass
        echo=socketserver.ThreadingTCPServer(('127.0.0.1',0),Echo);echo.daemon_threads=True;servers.append(echo);threading.Thread(target=echo.serve_forever,daemon=True).start()
        stream_a=connect(a,a['port'],echo.server_address[1],context);streams.append(stream_a)
        # A port collision must fail readiness and remove only the newly added panel.
        php(b,'Illuminate\\Support\\Facades\\DB::table("v2_server_v2box")->where("id",3)->update(["server_port"=>'+str(a['port'])+']); echo "true";')
        bad_grant=php(b,'echo json_encode(App\\Services\\NodeDeployment::create(3,'+str(b['actorId'])+'));')
        rejected=subprocess.run(bad_grant['command'],shell=True,cwd=root,env=env,capture_output=True,text=True,timeout=100)
        assert rejected.returncode!=0 and json.loads(config.read_text())==configuration,'Port collision was reported as a successful deployment or changed another panel'
        ping(stream_a)
        php(b,'Illuminate\\Support\\Facades\\DB::table("v2_server_v2box")->where("id",3)->update(["server_port"=>'+str(b['port'])+']); echo "true";')
        b['command']=php(b,'echo json_encode(App\\Services\\NodeDeployment::create(3,'+str(b['actorId'])+'));')['command']
        # Bootstrap and redemption outages must not consume the grant or touch panel A.
        saved_reports=network.CONFIG.read_bytes();saved_config=config.read_bytes()
        b['online']=False
        offline=subprocess.run(b['command'],shell=True,cwd=root,env=env,capture_output=True,timeout=35)
        b['online']=True
        assert offline.returncode!=0 and config.read_bytes()==saved_config and network.CONFIG.read_bytes()==saved_reports,'Bootstrap outage changed an existing deployment'
        ping(stream_a)
        b['redeemUnavailable']=True
        unavailable=subprocess.run(b['command'],shell=True,cwd=root,env=env,capture_output=True,timeout=45)
        b['redeemUnavailable']=False
        assert unavailable.returncode!=0 and config.read_bytes()==saved_config and network.CONFIG.read_bytes()==saved_reports,'Redemption outage changed an existing deployment'
        assert cert_before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in node_root.glob('operator-*.pem')}
        ping(stream_a)
        # The normal panel-B command must append even though its database/key differ.
        command=subprocess.run(b['command'],shell=True,cwd=root,env=env,capture_output=True,text=True,timeout=100)
        if command.returncode:raise AssertionError('Second independent panel deployment failed: '+re.sub(r'(?:nk_|nd_|am_)[a-f0-9.]+','[redacted]',(command.stdout+command.stderr)[-2400:]))
        wait(lambda:listening(b['port']),'Panel B node did not become active')
        after=json.loads(config.read_text());assert after['Nodes'][0]==entry and len(after['Nodes'])==2 and after['OperatorSetting']=='retained'
        b_entry=after['Nodes'][1];assert b_entry['ApiHost']==b['origin'] and b_entry['NodeID']==3 and b_entry['ApiKey']!=entry['ApiKey']
        ping(stream_a);assert node.poll() is None and not events.exists(),'Adding another panel restarted the service'
        assert cert_before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in node_root.glob('operator-*.pem')}
        targets=network.targets(json.loads(network.CONFIG.read_text()));assert report_a in targets and direct in targets
        target_b=[t for t in targets if t.get('panel_url')==b['origin']][0];assert target_b['server_id']==7 and target_b['token']!=report_a['token']
        assert json.loads(network.STATE.read_text())['targets'][network.target_key(direct)]==direct_state
        assert (report_root/'server-identity').read_text()==a['origin']+'/7\n'
        # Wrong-panel keys must not authenticate, even with equal node/user/server IDs.
        for p,wrong in [(a,b_entry['ApiKey']),(b,entry['ApiKey'])]:
            req=urllib.request.Request(p['origin']+'/api/v10/server/configuration',headers={'Authorization':'Bearer '+wrong,'X-Node-Type':'v2box','X-Node-ID':'3'})
            try:urllib.request.urlopen(req,context=context,timeout=10);raise AssertionError('Independent panel accepted another database key')
            except urllib.error.HTTPError as error:assert error.code in (401,403)
        # Panel B config changes and an outage of A must preserve A/B isolation.
        old_b=b['port'];new_b=old_b+10
        php(b,'Illuminate\\Support\\Facades\\DB::table("v2_server_v2box")->where("id",3)->update(["server_port"=>'+str(new_b)+']); echo "true";')
        wait(lambda:listening(new_b) and not listening(old_b),'Panel B configuration did not apply independently')
        ping(stream_a)
        stream_b=connect(b,new_b,echo.server_address[1],context);streams.append(stream_b)
        a['online']=False;time.sleep(2);ping(stream_b);ping(stream_a)
        before_b=php(b,'echo json_encode(Illuminate\\Support\\Facades\\DB::table("v2_network_server")->where("id",7)->value("ipv4_seen_at"));')
        time.sleep(1.1)
        report=subprocess.run(['python3',str(program/'node-network.py'),'run'],env=env,capture_output=True,timeout=35)
        assert report.returncode!=0,'Offline panel report unexpectedly succeeded'
        after_b=php(b,'echo json_encode(Illuminate\\Support\\Facades\\DB::table("v2_network_server")->where("id",7)->value("ipv4_seen_at"));')
        assert after_b>before_b,'Offline panel blocked another panel IP report'
        a['online']=True
        php(a,'Illuminate\\Support\\Facades\\DB::table("v2_user")->where("id",'+str(a['userId'])+')->update(["banned"=>1]); echo "true";')
        def a_denied():
            try:
                check=connect(a,a['port'],echo.server_address[1],context);check.close();return False
            except (OSError,AssertionError):return True
        wait(a_denied,'Panel A did not apply its own user ban');ping(stream_b,b'B'*32768)
        assert php(b,'echo json_encode(Illuminate\\Support\\Facades\\DB::table("v2_user")->where("id",'+str(b['userId'])+')->value("banned"));')==0
        repeat=subprocess.run(b['command'],shell=True,cwd=root,env=env,capture_output=True,timeout=40);assert repeat.returncode==0,'Completed independent deployment was not idempotent'
        assert json.loads(config.read_text())==after and node.poll() is None
        assert not events.exists(),'Independent panel operations restarted or stopped the shared service'
        # Validate the real panel-generated upgrade command against an existing v1.0.13 binary.
        # Stop the fixture first so the installer must preserve the stopped service state.
        for stream in streams:stream.close()
        os.killpg(node.pid,signal.SIGTERM);node.wait(timeout=15);pid_file.unlink()
        preserved={path:path.read_bytes() for path in [config,network.CONFIG,network.STATE,*node_root.glob('operator-*.pem')]}
        new_binary_hash=hashlib.sha256((program/'v2box').read_bytes()).hexdigest()
        old_asset=root/'v2box-v1.0.13-linux-amd64.zip'
        subprocess.run(['curl','-fsSL','--max-time','120','https://github.com/lenaanderson5566-ops/v2box/releases/download/v1.0.13/v2box-linux-amd64.zip','-o',str(old_asset)],check=True,capture_output=True,timeout=130)
        assert hashlib.sha256(old_asset.read_bytes()).hexdigest()=='66e201f14e22babe6584956716d722dea17de757b95a5a060197e29208ee1008','Previous release digest changed'
        with zipfile.ZipFile(old_asset) as archive:
            binary=[name for name in archive.namelist() if Path(name).name=='v2box'];assert len(binary)==1
            (program/'v2box').write_bytes(archive.read(binary[0]));(program/'v2box').chmod(0o755)
        previous_hash=hashlib.sha256((program/'v2box').read_bytes()).hexdigest()
        version=subprocess.run([str(program/'v2box'),'version'],capture_output=True,text=True,check=True,timeout=10)
        assert 'v1.0.13' in version.stdout,'Upgrade fixture is not the real previous release'
        upgrade_command=php(b,'echo json_encode((new App\\Services\\ServerService())->getAllV2node("v2box")[0]["upgrade_command"]);')
        assert '--install v1.0.14' in upgrade_command and upgrade_command.endswith('--update')
        upgraded=subprocess.run(upgrade_command,shell=True,cwd=root,env=env,capture_output=True,text=True,timeout=220)
        if upgraded.returncode:raise AssertionError('Published release upgrade failed: '+re.sub(r'(?:nk_|nd_|ns_)[a-f0-9.]+','[redacted]',(upgraded.stdout+upgraded.stderr)[-1600:]))
        version=subprocess.run([str(program/'v2box'),'version'],capture_output=True,text=True,check=True,timeout=10)
        assert 'v1.0.14' in version.stdout and hashlib.sha256((program/'v2box').read_bytes()).hexdigest()==new_binary_hash,'Upgraded binary does not match the published release'
        assert hashlib.sha256((program/'v2box.previous').read_bytes()).hexdigest()==previous_hash,'Upgrade did not preserve the previous binary'
        assert not pid_file.exists() and not events.exists(),'Upgrade started the previously stopped shared service'
        for path,content in preserved.items():assert path.read_bytes()==content,'Upgrade changed retained node/certificate/reporting files'
        log=open(root/'upgraded-node.log','wb');logs.append(log)
        node=subprocess.Popen([str(program/'v2box'),'server','--config',str(config),'--watch=false'],env=env,stdout=log,stderr=log,start_new_session=True);pid_file.write_text(str(node.pid))
        wait(lambda:listening(new_b),'Upgraded program did not serve the retained panel configuration')
        upgraded_stream=connect(b,new_b,echo.server_address[1],context);streams.append(upgraded_stream);ping(upgraded_stream)
        # Exercise the ordinary panel command converting an ungrouped listener,
        # using the published binary and the two real independent databases.
        upgraded_stream.close()
        os.killpg(node.pid,signal.SIGTERM);node.wait(timeout=15);pid_file.unlink()
        php(a,'Illuminate\\Support\\Facades\\DB::table("v2_user")->where("id",'+str(a['userId'])+')->update(["banned"=>0]); echo "true";')
        shared_fields=php(a,'echo json_encode(App\\Models\\ServerV2box::findOrFail(3)->only(["server_port","listen_ip","protocol","tls","network","tls_settings"]));')
        php(b,'$node=App\\Models\\ServerV2box::findOrFail(3); $node->fill(json_decode('+json.dumps(json.dumps(shared_fields))+',true)); $node->save(); echo "true";')
        config.write_text(json.dumps(configuration));config.chmod(0o600)
        log=open(root/'before-shared-node.log','wb');logs.append(log)
        node=subprocess.Popen([str(program/'v2box'),'server','--config',str(config),'--watch=false'],env=env,stdout=log,stderr=log,start_new_session=True);pid_file.write_text(str(node.pid))
        wait(lambda:listening(a['port']),'Ungrouped node did not restart for automatic sharing fixture')
        # Only this disposable service fixture may perform a real process restart.
        service_source=systemctl.read_text()
        restart_handler="elif a and a[0]==\"restart\":\n import subprocess,time,socket\n os.killpg(pid,signal.SIGTERM)\n time.sleep(.5)\n with open("+repr(str(events))+",\"a\") as f:f.write(json.dumps(a)+\"\\n\")\n log=open("+repr(str(root/'shared-node.log'))+",\"ab\")\n child=subprocess.Popen(["+repr(str(program/'v2box'))+",\"server\",\"--config\","+repr(str(config))+",\"--watch=false\"],stdout=log,stderr=log,start_new_session=True)\n p.write_text(str(child.pid))\n"
        systemctl.write_text(service_source.replace('elif "v2box" in a',restart_handler+'elif "v2box" in a'))
        # The real upgrade restores the shipped helper; reinstate controlled IP discovery.
        (program/'node-network.py').write_text('#!/usr/bin/env python3\nimport importlib.util,sys\ns=importlib.util.spec_from_file_location("network",'+repr(str(real_network))+');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.IP_SERVICES={"A":['+repr(a['origin']+'/fixture-ip')+'],"AAAA":[]}\ntry:m.main()\nexcept m.NetworkError:sys.exit(1)\n')
        (program/'node-network.py').chmod(0o755)
        # Complete the earlier fixture's credential rotation before a new enrollment.
        php(b,'foreach (Illuminate\\Support\\Facades\\DB::table("v2_node_credential")->where("node_type","v2box")->where("node_id",3)->whereNotNull("expires_at")->whereNull("revoked_at")->pluck("id") as $key) App\\Services\\NodeCredentials::revoke("v2box",3,$key,'+str(b['actorId'])+'); echo "true";')
        command_shared=php(b,'echo json_encode(App\\Services\\NodeDeployment::create(3,'+str(b['actorId'])+'));')['command']
        assert '--shared-listener' not in command_shared,'Ordinary panel command required a sharing suffix'
        shared_reports=network.CONFIG.read_bytes()
        applied=subprocess.run(command_shared,shell=True,cwd=root,env=env,capture_output=True,text=True,timeout=110)
        if applied.returncode:raise AssertionError('Automatic same-port deployment failed: '+re.sub(r'(?:nk_|nd_|am_)[a-f0-9.]+','[redacted]',(applied.stdout+applied.stderr)[-2400:]))
        shared_nodes=json.loads(config.read_text())['Nodes']
        assert len(shared_nodes)==2 and shared_nodes[0]['SharedListener']==shared_nodes[1]['SharedListener'],'Automatic deployment did not select one shared group'
        assert shared_nodes[0]['ApiKey']==entry['ApiKey'] and shared_nodes[0]['CertificateDirectory']==entry['CertificateDirectory']
        assert cert_before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in node_root.glob('operator-*.pem')}
        assert network.CONFIG.read_bytes()==shared_reports,'Shared conversion changed existing reporting settings'
        b['proxyTls']=True
        shared_a=connect(a,a['port'],echo.server_address[1],context);streams.append(shared_a)
        shared_b=connect(b,a['port'],echo.server_address[1],context);streams.append(shared_b)
        ping(shared_a,b'A'*65536);ping(shared_b,b'B'*131072)
        assert len(events.read_text().splitlines())==1,'Initial shared conversion did not restart exactly once'
        shared_before=config.read_bytes()
        repeated_shared=subprocess.run(command_shared,shell=True,cwd=root,env=env,capture_output=True,timeout=40)
        assert repeated_shared.returncode==0 and config.read_bytes()==shared_before and len(events.read_text().splitlines())==1,'Repeated shared deployment changed configuration or restarted again'
        result={'independent_databases':2,'different_application_keys':True,'published_program':'v1.0.14','same_node_id':3,'same_server_id':7,'same_user_id':True,'one_click_append':True,'cross_panel_credentials_rejected':True,'existing_tls_stream_and_certificate_preserved':True,'configuration_change_isolated':True,'backend_outage_isolated':True,'ip_reporting_isolated':True,'other_database_user_ban_isolated':True,'direct_dns_and_legacy_reporting_preserved':True,'repeat_command_idempotent':True,'service_restarts':1,'service_manager':'fixture; real V2Box process and HTTPS Laravel backends'}
        result.update({'automatic_same_port_without_suffix':True,'automatic_group_selection':True,'automatic_conversion_restarts_once':True,'shared_two_panel_tls_connections':True,'port_conflict_rejected_and_scoped_rollback':True,'runtime_readiness_confirmed_without_managed_dns':True,'bootstrap_outage_preserves_existing_services':True,'redemption_outage_then_same_grant_retry':True,'real_previous_release_upgrade':True,'stopped_upgrade_stays_stopped':True,'upgrade_preserves_nodes_certificates_and_reporting':True,'previous_binary_backup_preserved':True,'upgraded_binary_serves_retained_nodes':True})
        Path('/tmp/v2box-independent-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
    finally:
        for stream in streams:
            try:stream.close()
            except OSError:pass
        if node and node.poll() is None:os.killpg(node.pid,signal.SIGTERM);node.wait(timeout=15)
        if 'pid_file' in locals() and pid_file.exists():
            remaining=int(pid_file.read_text())
            if not node or remaining!=node.pid:
                try:os.killpg(remaining,signal.SIGTERM)
                except ProcessLookupError:pass
        for server in servers:server.shutdown();server.server_close()
        for process in workers:
            if process.poll() is None:os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=15)
        for log in logs:log.close()
        # All three roots were verified absent before creating this container-only fixture.
        Path('/etc/systemd/system/v2box.service').unlink(missing_ok=True)
        for directory in ('/etc/v2box','/etc/node-network','/var/lib/node-network','/var/lib/v2box/traffic'):
            if Path(directory).exists():shutil.rmtree(directory)

if __name__=='__main__':
    try:run(sys.argv[1])
    except Exception as error:
        print(re.sub(r'(?:nk_|nd_|am_)[a-f0-9.]+','[redacted]',str(error)),file=sys.stderr);sys.exit(1)
