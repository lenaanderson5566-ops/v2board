#!/usr/bin/env python3
"""systemctl double for the isolated, two-panel V2Box process test."""
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time


def manage(root, args):
    action = args[0]
    unit = Path('/etc/systemd/system/v2box-deployment.service')
    if unit.name in args:
        pending = root / 'deployment-start.json'
        if action == 'show':
            fields = {
                'LoadState': 'loaded' if unit.is_file() else 'not-found',
                'ActiveState': 'active' if pending.exists() else 'inactive',
                'FragmentPath': str(unit) if unit.is_file() else '',
                'Transient': 'no',
            }
            properties = next(arg.split('=', 1)[1] for arg in args if arg.startswith('--property='))
            for key in properties.split(','):
                print(fields[key] if '--value' in args else key + '=' + fields[key])
            return 0 if unit.exists() else 4
        if action == 'start':
            # The command schedules a worker while it still owns the bootstrap
            # lock. The harness runs ExecStart after the command releases it.
            command = next(line for line in unit.read_text().splitlines() if line.startswith('ExecStart='))
            with pending.open('x') as queue:
                json.dump(shlex.split(command.removeprefix('ExecStart=')), queue)
            return 0
        if action in ('enable', 'disable', 'stop', 'reset-failed'):
            return 0
        raise ValueError('Unexpected deployment service action ' + action)

    if 'v2box' not in args and 'v2box.service' not in args:
        return 0  # daemon-reload and node-network timers
    pid_file = root / 'node.pid'
    pid = int(pid_file.read_text()) if pid_file.exists() else 0
    if action == 'show':
        print(pid if any('MainPID' in arg for arg in args) else ('active' if pid else 'inactive'))
    elif action == 'is-active':
        return 0 if pid else 3
    elif action == 'kill':
        os.kill(pid, signal.SIGHUP)
    elif action in ('restart', 'stop', 'start'):
        with (root / 'service-events.jsonl').open('a') as events:
            events.write(json.dumps(args) + '\n')
        if action != 'restart' or not (root / 'allow-node-restart').is_file():
            return 1
        os.killpg(pid, signal.SIGTERM)
        time.sleep(.5)
        with (root / 'shared-node.log').open('ab') as log:
            child = subprocess.Popen(
                ['/usr/local/lib/v2box/v2box', 'server', '--config', '/etc/v2box/config.json', '--watch=false'],
                stdout=log, stderr=log, start_new_session=True,
            )
        pid_file.write_text(str(child.pid))
    return 0


if __name__ == '__main__':
    fixture = Path(__file__).resolve().parent.parent
    if (os.environ.get('TEST_DISPOSABLE_WORKSPACE') != '1' or not Path('/.dockerenv').exists()
            or not re.fullmatch('/tmp/v2box-independent-[0-9a-f]{12}', str(fixture))):
        sys.exit('Only run in the disposable two-panel test')
    sys.exit(manage(fixture, sys.argv[1:]))
