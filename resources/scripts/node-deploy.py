#!/usr/bin/env python3
"""Resumable panel deployment. Standard library only; never bypass ACME failure guards."""
import fcntl
import errno
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

class DeploymentError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def json_request(url, token=None, body=None):
    headers={'User-Agent':'v2box-deployment/1.0 (+https://github.com/lenaanderson5566-ops/v2box)',
             'Accept':'application/dns-json' if body is None else 'application/json'}
    if token:
        headers['Authorization']='Bearer '+token
    if body is not None:
        headers['Content-Type']='application/json'
    request=urllib.request.Request(url,headers=headers,data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=10) as response:
            raw=response.read(262145)
            if len(raw)>262144:
                raise DeploymentError('Response exceeded size limit')
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        # A proxy rejection is not evidence that the panel revoked deployment
        # authority. Never print arbitrary upstream bodies or reflected secrets.
        try:
            try:
                payload=json.loads(e.read(16384))
            except (ValueError,UnicodeError,OSError):
                payload={}
            if not isinstance(payload,dict): payload={}
            signature=str(payload.get('detail','')).lower()
            browser_block=e.code==403 and (
                payload.get('error_code') in (1010,'1010') or
                signature in (
                    "the site owner has blocked access based on your browser's signature.",
                    "the owner of this website has banned your access based on your browser's signature"
                ) or e.headers.get('cf-mitigated')=='challenge')
            if browser_block:
                ray=e.headers.get('cf-ray','')
                reference=' Ray ID: '+ray+'.' if re.fullmatch(r'[a-zA-Z0-9-]{1,128}',ray) else ''
                raise DeploymentError('Browser protection blocked the deployment request (HTTP 403).'+reference+
                    ' Check Cloudflare Browser Integrity Check or challenge rules for the deployment API, then resume. Panel authorization was not verified.') from None
        finally:
            e.close()
        if e.code in (401,403,409,422):
            raise DeploymentError('Deployment request rejected (%s); check gateway rules, authorization and node settings. Do not delete existing certificates.' % e.code) from None
        raise OSError('HTTP service unavailable') from None
    except (ValueError,UnicodeError):
        raise OSError('Invalid response') from None

def write_private(path, data):
    if path.is_symlink():
        raise DeploymentError('Refusing symlinked deployment file')
    fd,name=tempfile.mkstemp(prefix='.'+path.name+'.',dir=str(path.parent))
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w') as out:
            json.dump(data,out);out.flush();os.fsync(out.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)

def dns_answers(domain, endpoint):
    answers={}
    for family,typ,version in [('ipv4',1,4),('ipv6',28,6)]:
        result=json_request(endpoint+'?'+urllib.parse.urlencode({'name':domain,'type':typ}))
        if result.get('Status')!=0:
            raise OSError('DNS response is not ready')
        values=set()
        for answer in result.get('Answer',[]):
            if answer.get('type')==typ:
                address=ipaddress.ip_address(answer.get('data',''))
                if address.version!=version or not address.is_global or address.is_multicast:
                    raise DeploymentError('DNS contains an invalid public address')
                values.add(str(address))
        answers[family]=values
    return answers

def dns_matches(domain, addresses):
    expected={family:{str(ipaddress.ip_address(addresses[family]))} if addresses.get(family) else set() for family in ('ipv4','ipv6')}
    # Check both families: a stale AAAA must not silently route HTTP validation elsewhere.
    for endpoint in ('https://cloudflare-dns.com/dns-query','https://dns.google/resolve'):
        if dns_answers(domain,endpoint)!=expected:
            return False
    return True

class Deployment:
    def __init__(self,path):
        self.path=Path(path)
        if self.path.is_symlink() or not self.path.is_file() or self.path.stat().st_mode & 0o077:
            raise DeploymentError('Deployment state must be a private regular file')
        self.state=json.loads(self.path.read_text());self.data=self.state['data']
        self.flow=self.data.get('deployment');self.config=self.path.parent/'config.json'
        self.host=self.data['apiHost'].rstrip('/')
        parsed=urllib.parse.urlsplit(self.host)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise DeploymentError('Invalid HTTPS panel address')

    def save(self,**values):
        self.state.update(values);write_private(self.path,self.state)

    def progress(self,action='status'):
        for attempt in range(3):
            try:
                return json_request(self.host+'/api/v10/server/enrollments/progress',self.flow['token'],{'action':action})['data']
            except OSError:
                if attempt==2: raise
                time.sleep(2)

    def command(self,args):
        try:
            subprocess.run(args,check=True,timeout=180)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
            raise DeploymentError('Deployment command failed; inspect node logs before resuming') from None

    def prepare_config(self):
        node={'NodeType':'v2box','ApiHost':self.host,'NodeID':self.data['nodeId'],'ApiKey':self.data['apiKey'],'ApiVersion':'v10','Timeout':15,'RetryCount':1,'LandingPage':{'Enabled':False,'Directory':''}}
        if self.config.is_symlink(): raise DeploymentError('Refusing symlinked node configuration')
        if self.config.exists():
            document=json.loads(self.config.read_text())
            previous=document.get('Nodes',[])
            if not isinstance(previous,list) or not previous or not all(isinstance(item,dict) for item in previous):
                raise DeploymentError('Invalid existing node configuration; preserved without overwrite')
            placeholder=len(previous)==1 and previous[0].get('ApiKey')=='REPLACE_ME' and previous[0].get('ApiHost')=='https://panel.example.com'
            if not placeholder:
                for item in previous:
                    if item.get('NodeType')!='v2box' or item.get('ApiHost')!=self.host or not isinstance(item.get('NodeID'),int):
                        raise DeploymentError('Existing configuration belongs to another panel or backend; preserved without overwrite')
                matches=[item for item in previous if item['NodeID']==node['NodeID']]
                if matches:
                    if len(matches)!=1 or any(matches[0].get(key)!=node[key] for key in ('ApiKey','ApiVersion')):
                        raise DeploymentError('Existing node credentials changed; preserved without overwrite')
                    os.chmod(self.config,0o600)
                    return
                # Preserve every existing service and operator setting. Keep a private
                # snapshot before the atomic append; never restore over later edits.
                backup=self.path.parent/('config.before-add-'+str(node['NodeID'])+'.json')
                if not backup.exists(): write_private(backup,document)
                original=json.loads(json.dumps(document))
                document['Nodes']=previous+[node]
                self.save(previousConfig=original, appendedConfig=document)
                write_private(self.config,document)
                return
        write_private(self.config,{'Log':{'Level':'info'},'Nodes':[node]})

    def rollback_addition(self):
        original=self.state.get('previousConfig')
        appended=self.state.get('appendedConfig')
        if not original or not appended: return
        if self.config.is_symlink() or json.loads(self.config.read_text())!=appended:
            raise DeploymentError('Configuration changed after deployment; automatic rollback refused. Inspect the private config.before-add snapshot.')
        write_private(self.config,original)
        self.save(startAttempted=False)
        self.command(['v2box','restart'])
        print('Failed added service removed; previous services and settings restored. Deployment state retained for retry.',flush=True)

    def service_state(self):
        if shutil.which('systemctl'):
            result=subprocess.run(['systemctl','show','v2box','--property=ActiveState','--value'],capture_output=True,text=True,timeout=10)
            state=result.stdout.strip()
            if result.returncode==0 and state in ('active','activating','reloading','deactivating','inactive','failed'):
                return state
        elif shutil.which('rc-service'):
            result=subprocess.run(['rc-service','v2box','status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
            if result.returncode==0: return 'active'
            if result.returncode==3: return 'inactive'
        raise DeploymentError('Cannot determine V2Box service state. Check v2box status and the service manager before resuming.')

    def ensure_started(self):
        if not self.state.get('startAttempted'):
            self.check_http_port();self.progress('start')
            self.save(startAttempted=True)
            self.command(['v2box','restart'])
            return
        state=self.service_state()
        if state in ('inactive','failed'):
            # One explicit resume may start a stopped service once. Never reset ACME
            # guards or repeatedly restart a process that is applying its configuration.
            print('The previous start did not leave a running service; starting V2Box once.',flush=True)
            self.check_http_port();self.progress('start')
            self.command(['v2box','start'])
        else:
            print('V2Box is already '+state+'; continuing readiness checks without restarting.',flush=True)

    def report(self):
        report=self.data.get('networkReport')
        if not report or self.state.get('reported'): return
        identity=None
        identity_path=Path('/etc/node-network/server-identity')
        if report.get('serverId'):
            identity=self.host+'/'+str(report['serverId'])
            if identity_path.is_symlink() or (identity_path.exists() and identity_path.read_text().strip()!=identity):
                raise DeploymentError('Reporting belongs to another physical server; existing configuration preserved')
        fd,name=tempfile.mkstemp(prefix='.report-',dir=str(self.path.parent))
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'w') as out: out.write(report['token'])
            self.command(['python3','/usr/local/lib/v2box/node-network.py','report-configure','--panel-url',self.host,'--family',report['family'],'--token-file',name])
            if identity:
                identity_path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                fd_identity=os.open(identity_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd_identity,'w') as out: out.write(identity+'\n')
            self.save(reported=True)
        finally:
            os.unlink(name)

    def wait_dns(self):
        print('Waiting for panel synchronization and public A/AAAA propagation (up to 15 minutes).',flush=True)
        deadline=time.monotonic()+900
        while time.monotonic()<deadline:
            try:
                status=self.progress()
                if status.get('completed'): return True
                if status.get('dnsStatus') in ('ownership_conflict','host_changed','credential_rejected','configuration_rejected','ambiguous_records'):
                    raise DeploymentError('DNS synchronization requires administrator attention: '+status['dnsStatus'])
                if status.get('dnsReady') and dns_matches(self.flow['domain'],status['addresses']):
                    if self.flow.get('accessMode')=='relay':
                        if dns_matches(self.flow['connectionDomain'],status.get('entryAddresses',{})): return False
                    elif self.flow['certificateMode']!='http' or self.flow['certificateDomain']==self.flow['domain'] or dns_matches(self.flow['certificateDomain'],status['addresses']):
                        return False
            except OSError:
                pass
            time.sleep(15)
        raise DeploymentError('DNS wait timed out. Check scheduler, Cloudflare status, both address families and public resolvers. No certificate request was started.')

    def check_http_port(self):
        if self.flow['certificateMode']!='http': return
        for family,address in ((socket.AF_INET,'0.0.0.0'),(socket.AF_INET6,'::')):
            try:
                with socket.socket(family) as probe:
                    if family==socket.AF_INET6: probe.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
                    probe.bind((address,80))
            except OSError as error:
                if error.errno in (errno.EAFNOSUPPORT,errno.EADDRNOTAVAIL): continue
                raise DeploymentError('HTTP certificate validation requires a free TCP port 80. Preserve the existing service; resolve the conflict before resuming.') from None

    def verify_certificate(self):
        if self.flow['tls']!=1 or self.flow['certificateMode'] not in ('http','dns'): return
        cert=self.flow['certificateFile'] or '/etc/v2box/'+self.flow['protocol']+str(self.data['nodeId'])+'.cer'
        cert=cert.replace('{domain}',self.flow['certificateDomain']).replace('{email}','fastdog.ltd@gmail.com')
        for args in (['openssl','x509','-in',cert,'-noout','-checkend','3600'],['openssl','verify','-purpose','sslserver','-verify_hostname',self.flow['certificateDomain'],'-untrusted',cert,cert]):
            result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
            if result.returncode: raise DeploymentError('Certificate trust, hostname or expiry verification failed; the connection domain was not activated')
        if self.flow['protocol'] not in ('hysteria','hysteria2','tuic'):
            address=self.flow['listenAddress']
            address={'0.0.0.0':'127.0.0.1','::':'::1'}.get(address,address)
            context=ssl.create_default_context();context.set_alpn_protocols(['h2','http/1.1'])
            with socket.create_connection((address,self.flow['listenPort']),timeout=5) as raw:
                with context.wrap_socket(raw,server_hostname=self.flow['certificateDomain']): pass

    def wait_ready(self):
        print('Waiting for the node to confirm the current configuration and certificate (up to 5 minutes).',flush=True)
        deadline=time.monotonic()+300
        next_notice=0
        while time.monotonic()<deadline:
            service=self.service_state()
            if service in ('inactive','failed'):
                raise DeploymentError('V2Box stopped before becoming ready. Inspect v2box log, fix the startup error, then resume; the resume command will start the stopped service once.')
            try:
                status=self.progress()
                if status.get('completed'): return
                if status.get('applicationState')=='failed':
                    self.rollback_addition()
                    raise DeploymentError('Node configuration failed: '+str(status.get('errorCode'))+'. Inspect journalctl -u v2box. ACME failure guards and certificates were preserved.')
                if status.get('applicationState')=='applied':
                    self.verify_certificate()
                    self.progress('complete')
                    return
            except OSError:
                pass
            if time.monotonic()>=next_notice:
                print('Service: '+service+'. Waiting for the panel to confirm configuration and certificate; '+str(max(0,int(deadline-time.monotonic())))+' seconds remaining.',flush=True)
                next_notice=time.monotonic()+30
            time.sleep(10)
        raise DeploymentError('Node readiness timed out. Inspect journalctl -u v2box; do not repeatedly restart or remove ACME state. The domain was not activated.')

    def finish(self):
        self.path.unlink()
        (self.path.parent/'.deployment-pending').unlink(missing_ok=True)
        if self.flow and self.flow.get('accessMode')=='relay':
            print('Origin node verified. Configure L4 forwarding on the entry server, test a client connection, then confirm the relay in the panel.'); return
        print('Deployment verified. The node connection domain is active.' if self.flow else 'Installation complete. Check node runtime status in the panel.')

    def run(self):
        self.report()
        if self.flow:
            if self.wait_dns(): self.finish();return
            self.prepare_config()
            self.ensure_started()
            self.wait_ready()
        else:
            self.prepare_config()
            self.command(['v2box','restart'])
        self.finish()

def main():
    try:
        if os.geteuid()!=0 or len(sys.argv)!=2: raise DeploymentError('Run as root with a deployment state file')
        path=Path(sys.argv[1]);lock=path.parent/'.deployment.lock'
        fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as handle:
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
            Deployment(path).run()
    except (DeploymentError,OSError,ValueError,KeyError,subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error,DeploymentError) else 'Deployment could not complete; inspect connectivity, configuration and file permissions.',file=sys.stderr)
        print('State retained. After fixing the cause, run: sh install-v2box.sh --resume (authorization valid for 24 hours).',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    sys.exit(main())
