#!/usr/bin/env python3
"""Transactional, panel-scoped API-origin migration for existing V2Box installations."""
import argparse
import base64
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path('/etc/v2box')
NETWORK = Path('/etc/node-network')
NETWORK_STATE = Path('/var/lib/node-network')
JOURNAL = ROOT / 'api-migration.json'

class MigrationError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def origin(value):
    p = urllib.parse.urlsplit(value)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ('', '/') or any(c.isspace() for c in value):
        raise MigrationError('Migration requires HTTPS origins without paths or credentials')
    host = '['+p.hostname.lower()+']' if ':' in p.hostname else p.hostname.lower()
    return 'https://' + host + (':'+str(p.port) if p.port and p.port != 443 else '')

def request(url, token, body=None, node_id=None):
    headers = {'Authorization': 'Bearer '+token, 'Accept': 'application/json', 'User-Agent': 'v2box-api-migration/1'}
    if node_id is not None:
        headers.update({'X-Node-ID': str(node_id), 'X-Node-Type': 'v2box', 'X-Node-Capabilities': 'native-routing-v1,dns-v1,outbounds-v1,configuration-receipt-v1,certificate-transition-v1'})
    if body is not None:
        headers['Content-Type'] = 'application/json'
    try:
        req = urllib.request.Request(url, headers=headers, data=None if body is None else json.dumps(body).encode())
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise ValueError()
            result = json.loads(raw)
            if not isinstance(result, dict) or not isinstance(result.get('data'), dict):
                raise ValueError()
            return result['data']
    except (OSError, ValueError):
        raise MigrationError('HTTPS API verification failed; check domain, certificate, gateway and migration authority') from None

def matches(value, host):
    try: return origin(value)==host
    except MigrationError: return False  # An unrelated panel may use an API path prefix.

def private(path, data):
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise MigrationError('Refusing symlinked migration file')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.'+path.name, dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def read(path):
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents) or not path.is_file() or path.stat().st_mode & 0o077:
        raise MigrationError('Configuration and migration journal must be private regular files')
    return json.loads(path.read_bytes())

def service_state():
    if shutil.which('systemctl'):
        p = subprocess.run(['systemctl','show','v2box','--property=ActiveState','--value'],capture_output=True,text=True,timeout=10)
        state = p.stdout.strip()
        if p.returncode == 0 and state in ('active','inactive','failed'): return state == 'active'
    elif shutil.which('rc-service'):
        p=subprocess.run(['rc-service','v2box','status'],capture_output=True,timeout=10)
        if p.returncode in (0,3): return p.returncode==0
    raise MigrationError('Migration requires a stable systemd or OpenRC V2Box service; service was not changed')

def reload_service():
    subprocess.run(['v2box','reload'],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def value(record):
    path = Path(record['path'])
    if record['kind'] == 'link':
        if path.is_symlink(): return os.readlink(path)
        if path.exists(): raise MigrationError('Traffic storage destination changed; preserved')
        return None
    if path.is_symlink(): raise MigrationError('Configuration replaced by a symlink; preserved')
    return base64.b64encode(path.read_bytes()).decode() if path.exists() else None

def install(record, field):
    path = Path(record['path']); data = record[field]
    if data is None:
        path.unlink(missing_ok=True)
    elif record['kind'] == 'link':
        if not path.is_symlink():
            path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            os.symlink(data,path)
    else:
        private(path,base64.b64decode(data))

def rollback(journal):
    # Check every record before changing any; never overwrite later operator changes.
    for r in journal['files']:
        if value(r) not in (r['before'],r['after']):
            raise MigrationError('Rollback conflict: a migration-owned file changed later. Backups retained; no conflicting configuration overwritten')
    for r in reversed(journal['files']): install(r,'before')
    journal['status'] = 'rolledBack'
    private(JOURNAL,json.dumps(journal).encode())
    if journal['active'] and journal['nodeIds']:
        try: reload_service()
        except (OSError,subprocess.SubprocessError):
            journal['status']='rollbackNeedsReload';private(JOURNAL,json.dumps(journal).encode())
            raise MigrationError('Original files restored, but node reload failed. Fix the service manager and rerun the local --rollback command; private backup retained') from None

class Migration:
    def __init__(self, old, new, token, node_id, server_id=None):
        self.old, self.new = origin(old), origin(new)
        self.token, self.node_id = token, node_id
        self.server_id = server_id
        if self.old == self.new or not re.fullmatch(r'am_[a-f0-9]{64}',token):
            raise MigrationError('Invalid migration authority or identical origins')
        self.files = []
        self.nodes = []
        self.reports = []
        self.report_sources = []
        self.network = None

    def progress(self, action, **extra):
        return request(self.new+'/api/v10/server/api-migrations/progress',self.token,dict(action=action,nodeIds=self.ids,**extra))

    def file(self, path, document):
        path = Path(path)
        if path.is_symlink(): raise MigrationError('Refusing symlinked configuration')
        before = base64.b64encode(path.read_bytes()).decode() if path.exists() else None
        after = base64.b64encode(json.dumps(document,separators=(',',':')).encode()).decode() if document is not None else None
        if before != after: self.files.append(dict(path=str(path),kind='file',before=before,after=after))

    def prepare(self):
        if JOURNAL.exists():
            previous=read(JOURNAL)
            if previous['status'] not in ('committed','rolledBack'):
                raise MigrationError('An interrupted migration exists. Run the local --rollback command first')
            if previous['status']=='committed' and previous['from']==self.old and previous['to']==self.new:
                if all(value(r)==r['after'] for r in previous['files']):
                    return False
                raise MigrationError('Completed migration files changed later; preserved')
            private(ROOT/('api-migration-backup-'+secrets.token_hex(8)+'.json'),JOURNAL.read_bytes())
        config=read(ROOT/'config.json') if (ROOT/'config.json').exists() else {'Nodes':[]}; updated=copy.deepcopy(config)
        for entry in updated.get('Nodes',[]):
            if not matches(entry['ApiHost'],self.old): continue
            if entry.get('NodeType','v2node') != 'v2box':
                raise MigrationError('This origin includes legacy V2Node entries; migrate them separately')
            self.nodes.append(copy.deepcopy(entry))
            identity=(entry['NodeID'],entry.get('NodeType','v2node'))
            if any(matches(n['ApiHost'],self.new) and (n['NodeID'],n.get('NodeType','v2node'))==identity for n in config['Nodes']):
                raise MigrationError('Destination panel/node already exists; both configurations preserved')
            original=urllib.parse.urlsplit(entry['ApiHost'])
            namespace_host=urllib.parse.urlunsplit(('https',original.netloc.lower(),original.path.rstrip('/'),'',''))
            old_namespace=ROOT/'panels'/hashlib.sha256(namespace_host.encode()).hexdigest()[:16]/('v2box-'+str(entry['NodeID']))
            entry.setdefault('CertificateDirectory',str(old_namespace))
            if not entry['CertificateDirectory']: entry['CertificateDirectory']=str(old_namespace)
            # Preserve queued traffic using its existing namespace; no batch is moved or copied.
            spool=Path(entry.get('TrafficSpoolDirectory') or '/var/lib/v2box/traffic')
            old_spool=spool/hashlib.sha256((entry['ApiHost']+':'+str(entry['NodeID'])).encode()).hexdigest()
            new_spool=spool/hashlib.sha256((self.new+':'+str(entry['NodeID'])).encode()).hexdigest()
            if old_spool != new_spool:
                if new_spool.exists() or new_spool.is_symlink(): raise MigrationError('Destination traffic storage already exists; preserved')
                old_spool.mkdir(parents=True,exist_ok=True,mode=0o700)
                self.files.append(dict(path=str(new_spool),kind='link',before=None,after=str(old_spool.resolve())))
            entry['ApiHost']=self.new
        self.ids=sorted(n['NodeID'] for n in self.nodes)
        if self.server_id and self.nodes:
            raise MigrationError('This server also runs nodes for the old origin; use its node migration command to migrate nodes and reporting together')
        if (not self.server_id and self.node_id not in self.ids) or len(self.ids)!=len(set(self.ids)):
            raise MigrationError('Selected source node not found or ambiguous; configuration retained')
        for pending in list(ROOT.glob('deployment-state*.json'))+list(NETWORK.glob('enrollment-state*.json')):
            if matches(read(pending).get('data',{}).get('apiHost',''),self.old):
                raise MigrationError('Finish or roll back pending deployments for this origin before migration')
        challenge=secrets.token_hex(32)
        body=dict(action='probe',nodeIds=self.ids,challenge=challenge)
        trusted=request(self.old+'/api/v10/server/api-migrations/progress',self.token,body)
        target=self.progress('probe',challenge=challenge)
        if trusted != target or target.get('fromApiHost')!=self.old or target.get('toApiHost')!=self.new or target.get('nodeIds')!=self.ids:
            raise MigrationError('The two domains did not prove the same authorized backend')
        if self.server_id and target.get('serverId')!=self.server_id:
            raise MigrationError('Reporting server migration authority does not match this server')
        for node in self.nodes:
            # Long-lived credentials are used only after verifying the authorized backend pair.
            a=request(self.old+'/api/v10/server/configuration',node['ApiKey'],node_id=node['NodeID'])
            b=request(self.new+'/api/v10/server/configuration',node['ApiKey'],node_id=node['NodeID'])
            if a != b: raise MigrationError('Node configuration differs between domains; original configuration retained')
        report_path=NETWORK/'cloudflare.json'
        if report_path.exists():
            if self.network is None:
                helper='/usr/local/lib/node-network/node-network.py' if Path('/usr/local/lib/node-network/node-network.py').is_file() else '/usr/local/lib/v2box/node-network.py'
                spec=importlib.util.spec_from_file_location('migration_network',helper)
                self.network=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.network)
            if not all(callable(getattr(self.network,name,None)) for name in ('targets','target_key','validate_report','fingerprint','report','Client')):
                raise MigrationError('Upgrade the IP reporting helper to v1.0.12 before migration; existing settings retained')
            document=read(report_path); entries=self.network.targets(document)
            changed=copy.deepcopy(entries);state_path=NETWORK_STATE/'state.json'
            state=read(state_path) if state_path.exists() else {}
            states=copy.deepcopy(state.get('targets',{}))
            if document.get('mode')!='multi': states={self.network.target_key(entries[0]):copy.deepcopy(state)}
            for old, new in zip(entries,changed):
                if old.get('mode')!='panel' or origin(old['panel_url'])!=self.old: continue
                if self.server_id and old.get('server_id')!=self.server_id:
                    raise MigrationError('Source report target belongs to another physical server; preserved')
                new['panel_url']=self.new
                if any(n.get('mode')=='panel' and origin(n['panel_url'])==self.new and n.get('server_id')==old.get('server_id') for n in entries):
                    raise MigrationError('Destination IP reporting identity already exists; preserved')
                self.network.validate_report(new)
                self.reports.append(new)
                self.report_sources.append(old)
                old_key=self.network.target_key(old);new_key=self.network.target_key(new)
                target_state=states.pop(old_key,{})
                # Old-origin failures must not leave a verified new target permanently paused.
                target_state.pop('paused',None);target_state.pop('next_run',None)
                states[new_key]=dict(target_state,fingerprint=self.network.fingerprint(new))
            if self.reports:
                result=changed[0] if document.get('mode')!='multi' else dict(document,targets=changed)
                if document.get('mode')!='multi': new_state=states[self.network.target_key(changed[0])]
                else: new_state=dict(state,targets=states)
                self.file(report_path,result);self.file(state_path,new_state)
                for source,report in zip(self.report_sources,self.reports):
                    if report.get('server_id'):
                        original=urllib.parse.urlsplit(source['panel_url'])
                        source_host=urllib.parse.urlunsplit(('https',original.netloc.lower(),'','',''))
                        old_identity=NETWORK/'identities'/(hashlib.sha256(source_host.encode()).hexdigest()[:24]+'.json')
                        new_identity=NETWORK/'identities'/(hashlib.sha256(self.new.encode()).hexdigest()[:24]+'.json')
                        if new_identity.exists(): raise MigrationError('Destination server identity already exists; preserved')
                        if old_identity.exists():
                            expected={'panelUrl':source_host,'serverId':report['server_id']}
                            if read(old_identity)!=expected: raise MigrationError('Source reporting identity does not match; preserved')
                            self.file(old_identity,None)
                        self.file(new_identity,{'panelUrl':self.new,'serverId':report['server_id']})
                legacy=NETWORK/'server-identity'
                if legacy.exists():
                    if legacy.is_symlink(): raise MigrationError('Refusing symlinked legacy reporting identity')
                    legacy_identity=legacy.read_text().strip();host,_,server=legacy_identity.rpartition('/')
                    if origin(host)==self.old:
                        matching=[r for r in self.reports if str(r.get('server_id'))==server]
                        if len(matching)!=1: raise MigrationError('Legacy reporting identity does not match; preserved')
                        self.files.append(dict(path=str(legacy),kind='file',before=base64.b64encode(legacy.read_bytes()).decode(),after=base64.b64encode((self.new+'/'+server+'\n').encode()).decode()))
        if self.server_id and not self.reports: raise MigrationError('Source reporting server not found; configuration retained')
        if self.nodes: self.file(ROOT/'config.json',updated)  # Publish Nodes only after support files.

    def run(self):
        if self.prepare() is False:
            print('This migration already completed; no files or credentials changed.');return
        if any(n.get('ApiVersion') not in (None,'','v10') for n in self.nodes):
            raise MigrationError('Set these nodes to the V10 API before migrating; original API configuration retained')
        active=service_state() if self.nodes else False
        if active:
            p=subprocess.run(['/usr/local/lib/v2box/v2box','capabilities'],capture_output=True,text=True,check=True,timeout=10)
            features=json.loads(p.stdout)['features']
            if 'multi-panel-v1' not in features or 'reload-signal-v1' not in features:
                raise MigrationError('Upgrade V2Box before migrating; existing service was retained')
        self.progress('start')
        journal=dict(status='prepared',active=active,fromApiHost=self.old,toApiHost=self.new,nodeIds=self.ids,files=self.files)
        journal['from']=self.old;journal['to']=self.new
        private(JOURNAL,json.dumps(journal).encode())
        try:
            for r in self.files:
                if value(r)!=r['before']: raise MigrationError('Configuration changed during migration; preserved')
                install(r,'after')
            if active: reload_service()
            for report in self.reports: self.network.report(self.network.Client(),report)
            if active:
                deadline=time.monotonic()+180
                while time.monotonic()<deadline:
                    result=self.progress('status')
                    if result.get('failed'): raise MigrationError('Node rejected the migrated configuration')
                    if result.get('ready'): break
                    time.sleep(2)
                else: raise MigrationError('New-domain applied receipt timed out')
            journal['status']='committed';private(JOURNAL,json.dumps(journal).encode())
        except BaseException:
            rollback(journal)
            raise
        print('API migration committed. Existing keys, certificates and other panels retained.' if active else 'API migration saved. V2Box remains stopped; configuration will apply at its next start.')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--migrate-api',action='store_true');parser.add_argument('--rollback',action='store_true')
    parser.add_argument('--from-api-host');parser.add_argument('--api-host');parser.add_argument('--migration-token');parser.add_argument('--node-id',type=int)
    parser.add_argument('--server-id',type=int)
    args=parser.parse_args()
    try:
        if os.geteuid()!=0: raise MigrationError('Run as root')
        for directory in (ROOT,NETWORK,NETWORK_STATE):
            if directory.is_symlink(): raise MigrationError('Refusing symlinked configuration directory')
            directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        for lock in (ROOT/'.bootstrap.lock',NETWORK_STATE/'lock'):
            if lock.is_symlink(): raise MigrationError('Refusing symlinked migration lock')
        with open(ROOT/'.bootstrap.lock','a') as bootstrap, open(NETWORK_STATE/'lock','a') as reporter:
            if os.environ.get('V2BOX_API_MIGRATION_LOCK_HELD')!='1': fcntl.flock(bootstrap,fcntl.LOCK_EX|fcntl.LOCK_NB)
            fcntl.flock(reporter,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if args.rollback:
                rollback(read(JOURNAL));print('Original API configuration restored; other panels and certificates retained.')
            else:
                if not all((args.from_api_host,args.api_host,args.migration_token,args.node_id or args.server_id)) or bool(args.node_id)==bool(args.server_id): raise MigrationError('Missing or ambiguous migration parameters')
                Migration(args.from_api_host,args.api_host,args.migration_token,args.node_id,args.server_id).run()
    except (Exception,KeyboardInterrupt) as error:
        print(str(error) if isinstance(error,MigrationError) else 'Migration failed. Private journal retained; check service, connectivity and file permissions.',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__': sys.exit(main())
