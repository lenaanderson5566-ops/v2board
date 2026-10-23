#!/usr/bin/env python3
"""Resumable panel deployment. Standard library only; never bypass ACME failure guards."""
import fcntl
import errno
import ipaddress
import json
import os
from pathlib import Path
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
    headers={'Accept':'application/dns-json' if body is None else 'application/json'}
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
        if e.code in (401,403,409,422):
            raise DeploymentError('Panel rejected deployment (%s); check authorization and node settings. Do not delete existing certificates.' % e.code) from None
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
            previous=json.loads(self.config.read_text()).get('Nodes',[])
            placeholder=len(previous)==1 and previous[0].get('ApiKey')=='REPLACE_ME' and previous[0].get('ApiHost')=='https://panel.example.com'
            if not placeholder and previous!=[node]:
                raise DeploymentError('Existing node configuration changed; preserved without overwrite')
        write_private(self.config,{'Log':{'Level':'info'},'Nodes':[node]})

    def report(self):
        report=self.data.get('networkReport')
        if not report or self.state.get('reported'): return
        fd,name=tempfile.mkstemp(prefix='.report-',dir=str(self.path.parent))
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'w') as out: out.write(report['token'])
            self.command(['python3','/usr/local/lib/v2box/node-network.py','report-configure','--panel-url',self.host,'--family',report['family'],'--token-file',name])
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
                    if self.flow['certificateMode']!='http' or self.flow['certificateDomain']==self.flow['domain'] or dns_matches(self.flow['certificateDomain'],status['addresses']):
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
        cert=cert.replace('{domain}',self.flow['certificateDomain']).replace('{email}','node@v2board.com')
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
        while time.monotonic()<deadline:
            try:
                status=self.progress()
                if status.get('completed'): return
                if status.get('applicationState')=='failed':
                    raise DeploymentError('Node configuration failed: '+str(status.get('errorCode'))+'. Inspect journalctl -u v2box. ACME failure guards and certificates were preserved.')
                if status.get('applicationState')=='applied':
                    self.verify_certificate()
                    self.progress('complete')
                    return
            except OSError:
                pass
            time.sleep(10)
        raise DeploymentError('Node readiness timed out. Inspect journalctl -u v2box; do not repeatedly restart or remove ACME state. The domain was not activated.')

    def finish(self):
        self.path.unlink()
        (self.path.parent/'.deployment-pending').unlink(missing_ok=True)
        print('Deployment verified. The node connection domain is active.' if self.flow else 'Installation complete. Check node runtime status in the panel.')

    def run(self):
        self.prepare_config()
        self.report()
        if self.flow:
            if self.wait_dns(): self.finish();return
            if not self.state.get('startAttempted'):
                self.check_http_port();self.progress('start')
                self.save(startAttempted=True)
                self.command(['v2box','restart'])
            self.wait_ready()
        else:
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
