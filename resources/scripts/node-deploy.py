#!/usr/bin/env python3
"""Resumable panel deployment. Standard library only; never bypass ACME failure guards."""

import fcntl
from contextlib import contextmanager
import hashlib
import errno
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


class DeploymentError(Exception):
    pass


class TemporaryDeploymentError(DeploymentError):
    pass


class UnselectedDeploymentError(DeploymentError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@contextmanager
def request_deadline(seconds):
    """Bound DNS, connect and body reads together in this Linux worker."""
    started = time.monotonic()
    deadline = started + seconds
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_delay, previous_interval = signal.getitimer(signal.ITIMER_REAL)
    previous_due = started + previous_delay if previous_delay else None

    def schedule():
        due = min(deadline, previous_due) if previous_due is not None else deadline
        signal.setitimer(signal.ITIMER_REAL, max(0.000001, due - time.monotonic()))

    def expired(signum, frame):
        nonlocal previous_due
        if previous_due is not None and previous_due <= deadline:
            previous_due = previous_due + previous_interval if previous_interval else None
            if callable(previous_handler):
                previous_handler(signum, frame)
            elif previous_handler == signal.SIG_DFL:
                signal.signal(signal.SIGALRM, signal.SIG_DFL)
                signal.raise_signal(signal.SIGALRM)
            schedule()
            return
        raise TimeoutError("Deployment HTTP request exceeded its time limit")

    signal.signal(signal.SIGALRM, expired)
    schedule()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_due is not None:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, previous_due - time.monotonic()), previous_interval)


def json_request(url, token=None, body=None, timeout=10, extra_headers=None):
    with request_deadline(timeout):
        return _json_request(url, token, body, timeout, extra_headers)


def _json_request(url, token=None, body=None, timeout=10, extra_headers=None):
    headers = {
        "User-Agent": "v2box-deployment/1.0 (+https://github.com/lenaanderson5566-ops/v2box)",
        "Accept": "application/dns-json" if body is None else "application/json",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra_headers:
        headers.update(extra_headers)
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        url, headers=headers, data=None if body is None else json.dumps(body).encode()
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(
            request, timeout=timeout
        ) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise DeploymentError("Response exceeded size limit")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise OSError("Expected a JSON object response")
            return payload
    except urllib.error.HTTPError as e:
        # A proxy rejection is not evidence that the panel revoked deployment
        # authority. Never print arbitrary upstream bodies or reflected secrets.
        try:
            try:
                payload = json.loads(e.read(16384))
            except TimeoutError:
                raise
            except (ValueError, UnicodeError, OSError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            signature = str(payload.get("detail", "")).lower()
            browser_block = e.code == 403 and (
                payload.get("error_code") in (1010, "1010")
                or signature
                in (
                    "the site owner has blocked access based on your browser's signature.",
                    "the owner of this website has banned your access based on your browser's signature",
                )
                or e.headers.get("cf-mitigated") == "challenge"
            )
            if browser_block:
                ray = e.headers.get("cf-ray", "")
                reference = (
                    " Ray ID: " + ray + "."
                    if re.fullmatch(r"[a-zA-Z0-9-]{1,128}", ray)
                    else ""
                )
                raise DeploymentError(
                    "Browser protection blocked the deployment request (HTTP 403)."
                    + reference
                    + " Check Cloudflare Browser Integrity Check or challenge rules for the deployment API, then resume. Panel authorization was not verified."
                ) from None
        finally:
            e.close()
        if e.code in (401, 403, 409, 422):
            known = {
                "节点或域名配置已变化，请核对后重新部署": "Deployment configuration changed. Finish saving node/domain settings, then generate a new deployment task; the current resume task cannot apply changed settings.",
                "解析尚未同步": "DNS changed before service start. Check origin and entry DNS, then resume.",
                "部署恢复授权已过期，请在后台重新配置": "Deployment authorization expired. Generate a new deployment task in the panel.",
                "部署授权已撤销": "Deployment authorization was revoked. Check node credentials in the panel.",
            }
            detail = payload.get("detail", payload.get("message"))
            if isinstance(detail, str) and detail in known:
                raise DeploymentError(known[detail]) from None
            raise DeploymentError(
                "Deployment request rejected (%s); check gateway rules, authorization and node settings. Do not delete existing certificates."
                % e.code
            ) from None
        raise OSError("HTTP service unavailable") from None
    except (ValueError, UnicodeError):
        raise OSError("Invalid response") from None


TRUSTED_OWNER = os.geteuid()


def require_trusted_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != TRUSTED_OWNER or info.st_mode & 0o022 or path.resolve() != path.absolute():
        raise DeploymentError("Deployment directory must be owned by root and cannot be writable by other users")


def read_trusted_text(path, label, forbidden_mode):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        if error.errno == errno.ELOOP:
            raise DeploymentError(label + " must not be a symlink") from None
        raise
    with os.fdopen(fd, encoding="utf-8") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != TRUSTED_OWNER or info.st_mode & forbidden_mode:
            raise DeploymentError(label + " must be a regular file owned by root with safe permissions")
        return source.read()


def open_deployment_lock(path):
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != TRUSTED_OWNER or info.st_mode & 0o022:
            raise DeploymentError("Deployment lock must be a root-owned regular file without write access for other users")
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_object(path, label, *, private=False):
    try:
        contents = read_trusted_text(path, label, 0o077) if private else path.read_text()
        document = json.loads(contents)
    except (ValueError, UnicodeError):
        raise DeploymentError(
            label
            + " is not valid JSON. The file was retained; correct it or use a newly generated panel deployment command."
        ) from None
    if not isinstance(document, dict):
        raise DeploymentError(
            label + " must be a JSON object. The original file was retained."
        )
    return document


def write_private(path, data):
    if path.is_symlink():
        raise DeploymentError("Refusing symlinked deployment file")
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(data, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def dns_answers(domain, endpoint):
    answers = {}
    for family, typ, version in [("ipv4", 1, 4), ("ipv6", 28, 6)]:
        try:
            result = json_request(
                endpoint + "?" + urllib.parse.urlencode({"name": domain, "type": typ})
            )
        except DeploymentError:
            raise OSError("DNS query service rejected the request") from None
        if result.get("Status") == 3:
            return {"ipv4": set(), "ipv6": set()}
        if result.get("Status") != 0:
            raise OSError("DNS response is not ready")
        values = set()
        for answer in result.get("Answer", []):
            if answer.get("type") == typ:
                address = ipaddress.ip_address(answer.get("data", ""))
                if (
                    address.version != version
                    or not address.is_global
                    or address.is_multicast
                ):
                    raise DeploymentError("DNS contains an invalid public address")
                values.add(str(address))
        answers[family] = values
    return answers


def dns_matches(domain, addresses):
    expected = {
        family: (
            {str(ipaddress.ip_address(addresses[family]))}
            if addresses.get(family)
            else set()
        )
        for family in ("ipv4", "ipv6")
    }
    # Every usable answer must match; unreachable providers may be skipped.
    successful = 0
    for endpoint in (
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/resolve",
    ):
        try:
            actual = dns_answers(domain, endpoint)
        except OSError:
            continue
        successful += 1
        if actual != expected:
            return False
    if not successful:
        raise OSError("All public DNS query services are unavailable")
    if successful == 1:
        print(
            "DNS verified using the available resolver; the other query service is unavailable.",
            flush=True,
        )
    return True


def panel_identity(host):
    if not isinstance(host, str):
        raise DeploymentError("Invalid HTTPS panel identity")
    parsed = urllib.parse.urlsplit(host)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise DeploymentError("Invalid HTTPS panel identity")
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/"), "", "")
    )


def is_placeholder(nodes):
    return (
        isinstance(nodes, list)
        and len(nodes) == 1
        and isinstance(nodes[0], dict)
        and nodes[0].get("ApiKey") == "REPLACE_ME"
        and nodes[0].get("ApiHost") == "https://panel.example.com"
    )


def node_identity(node):
    if (
        not isinstance(node, dict)
        or type(node.get("NodeID")) is not int
        or node["NodeID"] <= 0
        or node.get("NodeType", "v2box") not in ("v2box",)
    ):
        raise DeploymentError(
            "Invalid existing node identity; original configuration retained"
        )
    return (
        panel_identity(node.get("ApiHost", "")),
        node.get("NodeType", "v2box"),
        node["NodeID"],
    )


def reporting_identity(host, server_id):
    if type(server_id) is not int or server_id <= 0:
        raise DeploymentError("Invalid reporting server identity")
    host = panel_identity(host)
    root = Path("/etc/node-network")
    directory = root / "identities"
    if root.is_symlink() or directory.is_symlink():
        raise DeploymentError("Refusing symlinked reporting identity directory")
    path = directory / (hashlib.sha256(host.encode()).hexdigest()[:24] + ".json")
    if path.is_symlink():
        raise DeploymentError("Refusing symlinked reporting identity")
    if path.exists():
        current = read_object(path, "Reporting identity")
        if current.get("panelUrl") != host or current.get("serverId") != server_id:
            raise DeploymentError(
                "This panel is already bound to another physical server; existing reporting configuration preserved"
            )
    legacy = root / "server-identity"
    if legacy.is_symlink():
        raise DeploymentError("Refusing symlinked reporting identity")
    if legacy.exists():
        origin, _, identity = legacy.read_text().strip().rpartition("/")
        if panel_identity(origin) == host and identity != str(server_id):
            raise DeploymentError(
                "This panel is already bound to another physical server; existing reporting configuration preserved"
            )
    return path, {"panelUrl": host, "serverId": server_id}


def completed_enrollment(path, config, host, node_id, grant_hash):
    if (
        path.is_symlink()
        or not path.is_file()
        or path.stat().st_mode & 0o077
        or config.is_symlink()
        or not config.is_file()
    ):
        return False
    receipt = read_object(path, "Completed deployment receipt", private=True)
    if (
        receipt.get("grantHash") != grant_hash
        or receipt.get("apiHost") != panel_identity(host)
        or receipt.get("nodeId") != node_id
    ):
        return False
    nodes = read_object(config, "Existing node configuration").get("Nodes", [])
    matches = [
        item
        for item in nodes
        if node_identity(item) == (panel_identity(host), "v2box", node_id)
    ]
    return (
        len(matches) == 1
        and isinstance(matches[0].get("ApiKey"), str)
        and hashlib.sha256(matches[0]["ApiKey"].encode()).hexdigest()
        == receipt.get("credentialFingerprint")
    )


COMMAND_TIMEOUT = 180
COMMAND_STOP_GRACE = 15
BOOTSTRAP_LOCK_TIMEOUT = 30


def run_command(args, deployment_locked=False):
    limit = 660 if "report-configure" in args else COMMAND_TIMEOUT
    environment = os.environ.copy()
    environment.pop("V2BOX_BOOTSTRAP_LOCK_HELD", None)
    environment.pop("V2BOX_DEPLOYMENT_LOCK_HELD", None)
    if deployment_locked and args[0] in ("v2box", "/usr/local/bin/v2box"):
        environment.update(V2BOX_BOOTSTRAP_LOCK_HELD="1", V2BOX_DEPLOYMENT_LOCK_HELD="1")
    try:
        with subprocess.Popen(args, env=environment, start_new_session=True, close_fds=True) as child:
            try:
                returncode = child.wait(timeout=limit)
            except subprocess.TimeoutExpired:
                # Killing only the wrapper would leave its installer/service
                # children changing files after the deployment reports failure.
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=COMMAND_STOP_GRACE)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=5)
                raise
            if returncode:
                raise subprocess.CalledProcessError(returncode, args)
    except (
        FileNotFoundError,
        subprocess.TimeoutExpired,
        subprocess.CalledProcessError,
    ) as error:
        step = (
            "IP reporting configuration"
            if "report-configure" in args
            else "V2Box service command"
        )
        reason = (
            "timed out after %s seconds" % limit
            if isinstance(error, subprocess.TimeoutExpired)
            else (
                "program is missing"
                if isinstance(error, FileNotFoundError)
                else "failed (exit status %s)" % error.returncode
            )
        )
        raise DeploymentError(
            step
            + " "
            + reason
            + ". Review the service manager and logs, then resume; configuration and certificates were retained."
        ) from None


def configure_reporting(host, report, directory, command=run_command):
    if (
        not isinstance(report, dict)
        or not re.fullmatch(r"[a-f0-9]{64}", report.get("token", ""))
        or report.get("family") not in ("ipv4", "ipv6", "dual")
    ):
        raise DeploymentError("Invalid reporting setup; existing settings preserved")
    binding = None
    if report.get("serverId") is not None:
        binding = reporting_identity(host, report["serverId"])
    fd, name = tempfile.mkstemp(prefix=".report-", dir=str(directory))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(report["token"])
        args = [
            "python3",
            "/usr/local/lib/v2box/node-network.py",
            "report-configure",
            "--panel-url",
            host,
            "--family",
            report["family"],
            "--token-file",
            name,
        ]
        if binding:
            args += ["--server-id", str(report["serverId"])]
        command(args)
        if binding:
            path, identity = binding
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            write_private(path, identity)
    finally:
        os.unlink(name)


STATE_DIRECTORY = Path("/etc/v2box")
SYSTEMD_DIRECTORY = Path("/etc/systemd/system")
DEPLOYMENT_HELPER = Path("/usr/local/lib/v2box/panel-deploy.py")
MANAGED_UNIT = "v2box-deployment.service"
MANAGED_UNIT_MARKER = "# Managed by V2Box panel deployment; no credentials in this file.\n"


def has_systemd():
    return Path("/run/systemd/system").is_dir() and bool(shutil.which("systemctl"))


def managed_identity(path):
    path = Path(path)
    require_trusted_directory(STATE_DIRECTORY)
    if (
        path.parent != STATE_DIRECTORY
        or not re.fullmatch(r"deployment-state(?:-[a-zA-Z0-9_-]{1,128})?\.json", path.name)
        or path.is_symlink()
    ):
        raise DeploymentError("Invalid managed deployment state path; no task was changed")
    return path, MANAGED_UNIT


def service_command(*arguments, check=True):
    return subprocess.run(
        ["systemctl", *arguments], check=check, timeout=30, close_fds=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True,
    )


def unit_quote(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def read_managed_unit(target):
    return read_trusted_text(target, "Deployment service file", 0o022)


def write_managed_unit(path, unit):
    directory = SYSTEMD_DIRECTORY
    require_trusted_directory(directory)
    target = directory / unit
    if directory.is_symlink() or not directory.is_dir() or target.is_symlink():
        raise DeploymentError("Unsafe deployment service path; state was retained")
    if target.exists() and (
        not target.is_file() or not read_managed_unit(target).startswith(MANAGED_UNIT_MARKER)
    ):
        raise DeploymentError("Existing deployment service is not managed by this helper; retained")
    contents = MANAGED_UNIT_MARKER + "# StateFile=" + str(path) + "\n" + (
        "[Unit]\nDescription=V2Box resumable panel deployment\n"
        "Wants=network-online.target\nAfter=network-online.target\n"
        "StartLimitIntervalSec=0\nConditionPathExists=" + str(path).replace("%", "%%") + "\n"
        "ConditionPathExists=/usr/local/lib/v2box/v2box\n\n"
        "[Service]\nType=exec\nUMask=0077\n"
        "ExecStart=/usr/bin/env python3 -u " + unit_quote(DEPLOYMENT_HELPER)
        + " --boot-worker " + unit_quote(path) + "\n"
        "Restart=on-failure\nRestartSec=60s\nRestartPreventExitStatus=78\n"
        "TimeoutStartSec=30s\nRuntimeMaxSec=25h\nTimeoutStopSec=30s\n"
        "KillMode=control-group\n\n[Install]\nWantedBy=multi-user.target\n"
    )
    fd, temporary = tempfile.mkstemp(prefix=".v2box-deployment-", dir=str(directory))
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "w") as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def remove_managed_unit(path):
    path, unit = managed_identity(path)
    require_trusted_directory(SYSTEMD_DIRECTORY)
    target = SYSTEMD_DIRECTORY / unit
    if target.is_symlink():
        raise DeploymentError("Unsafe deployment service file; retained")
    if target.exists():
        contents = read_managed_unit(target)
        if not contents.startswith(MANAGED_UNIT_MARKER) or "# StateFile=" + str(path) not in contents.splitlines():
            raise DeploymentError("A different deployment task is selected; no task was changed")
    service_command("disable", unit)
    target.unlink(missing_ok=True)
    service_command("daemon-reload")


def managed_idle_state(unit):
    active = service_command("show", "--property=LoadState,ActiveState", unit, check=False)
    values = dict(line.split("=", 1) for line in active.stdout.splitlines() if "=" in line)
    load = values.get("LoadState")
    state = values.get("ActiveState")
    if active.returncode in (0, 4) and load == "not-found" and state in (None, "inactive"):
        return ""
    if active.returncode != 0 or load != "loaded":
        raise DeploymentError("Cannot verify the existing deployment service; no task was changed")
    if state in ("active", "activating", "reloading", "deactivating"):
        raise TemporaryDeploymentError("Another managed deployment is running. Check v2box deploy-status; the selected task and authorization were not changed.")
    if state not in ("inactive", "failed"):
        raise DeploymentError("Cannot verify the existing deployment service; no task was changed")
    return state


@contextmanager
def managed_service_lock():
    require_trusted_directory(STATE_DIRECTORY)
    fd = open_deployment_lock(STATE_DIRECTORY / ".deployment-service.lock")
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise TemporaryDeploymentError("Another deployment service operation is running; state was retained") from None
        yield
    finally:
        os.close(fd)


def launch_managed(path):
    path, unit = managed_identity(path)
    deployment = Deployment(path)
    if not has_systemd():
        print("No systemd: deployment runs in foreground. Keep SSH open; automatic recovery after reboot is not available on this init system.", flush=True)
        return False
    if not deployment.flow:
        raise DeploymentError("Automatic recovery requires current panel deployment authorization. Generate a new command in the panel.")
    managed_idle_state(unit)
    with managed_service_lock():
        with bootstrap_lock(path.parent):
            state = managed_idle_state(unit)
            deployment = Deployment(path)
            schedule_managed(deployment, path, unit, state)
    print("Deployment continues after SSH closes and after a server reboot. Status: v2box deploy-status", flush=True)
    print("Logs: v2box deploy-log (Ctrl+C closes only the log view).", flush=True)
    print("Cancel automatic recovery: v2box deploy-cancel (older node scripts: systemctl disable --now v2box-deployment.service). Recovery state is retained, together with configuration and certificates. A plain systemctl stop pauses this boot only.", flush=True)
    return True


def schedule_managed(deployment, path, unit, state):
    # Old helpers used a transient --collect unit with this same name. Never
    # replace an active worker. Stop/reset an idle transient before publishing
    # its persistent replacement; a failed unit need not survive the transition.
    if state:
        service_command("stop", unit)
        service_command("reset-failed", unit, check=False)
    recovery = deployment.state.get("managedRecovery", {})
    deadline = recovery.get("deadline") if isinstance(recovery, dict) else None
    if type(deadline) is not int or deadline <= time.time():
        deadline = int(time.time()) + 86400
    deployment.save(managedRecovery={"enabled": True, "deadline": deadline})
    write_managed_unit(path, unit)
    service_command("daemon-reload")
    for attempt in range(10):
        loaded = service_command("show", "--property=FragmentPath,Transient", unit)
        properties = dict(line.split("=", 1) for line in loaded.stdout.splitlines() if "=" in line)
        if properties.get("Transient") == "no" and properties.get("FragmentPath") == str(SYSTEMD_DIRECTORY / unit):
            break
        if attempt < 9:
            time.sleep(0.2)
    else:
        raise DeploymentError("Deployment service is still transient or points to another file. Check its status, then resume; saved state was retained")
    service_command("enable", unit)
    service_command("start", unit)


def cancel_managed():
    with managed_service_lock():
        return cancel_selected_managed()


def cancel_selected_managed():
    require_trusted_directory(SYSTEMD_DIRECTORY)
    unit = MANAGED_UNIT
    target = SYSTEMD_DIRECTORY / unit
    selected = None
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise DeploymentError("Unsafe deployment service file; retained")
    if not target.exists():
        result = service_command("show", "--property=LoadState,Transient", unit, check=False)
        properties = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        if result.returncode in (0, 4) and properties.get("LoadState") == "not-found":
            print("No managed deployment service is selected. Saved states and certificates retained.", flush=True)
            return
        if result.returncode != 0 or properties.get("Transient") != "yes":
            raise DeploymentError("Cannot identify the deployment service safely; saved state was retained")
        service_command("stop", unit)
        service_command("reset-failed", unit, check=False)
        print("Legacy transient deployment stopped. It cannot restart after reboot; saved state, configuration and certificates retained.", flush=True)
        return
    if target.exists():
        contents = read_managed_unit(target)
        if not contents.startswith(MANAGED_UNIT_MARKER):
            raise DeploymentError("Existing deployment service is not managed by this helper; retained")
        for line in contents.splitlines():
            if line.startswith("# StateFile="):
                selected, _ = managed_identity(line[len("# StateFile="):])
                break
        if selected is None:
            raise DeploymentError("Managed deployment service has no valid state identity; retained")
    # Disable before stopping: even a reboot during cancellation cannot re-enable
    # this task. Do not take the worker's long-held deployment lock first.
    service_command("disable", "--now", unit)
    if selected is not None:
        with bootstrap_lock(selected.parent):
            pause_recovery(selected)
    else:
        service_command("daemon-reload")
    print("Automatic deployment recovery cancelled. State, configuration and certificates retained; resume explicitly using the panel command.", flush=True)


def boot_recovery(path):
    path, unit = managed_identity(path)
    require_trusted_directory(SYSTEMD_DIRECTORY)
    target = SYSTEMD_DIRECTORY / unit
    contents = read_managed_unit(target) if not target.is_symlink() and target.is_file() else ""
    if not contents.startswith(MANAGED_UNIT_MARKER) or "# StateFile=" + str(path) not in contents.splitlines():
        raise UnselectedDeploymentError("This deployment is not the selected recovery task; no task was changed")
    deployment = Deployment(path)
    recovery = deployment.state.get("managedRecovery")
    if not isinstance(recovery, dict) or recovery.get("enabled") is not True:
        raise DeploymentError("Automatic recovery is paused; resume explicitly using the panel command")
    deadline = recovery.get("deadline")
    if type(deadline) is not int or deadline <= time.time():
        raise DeploymentError("Deployment authorization expired. Generate a new deployment task in the panel.")
    if not deployment.flow:
        raise DeploymentError("Automatic recovery requires current panel deployment authorization")
    # Revalidate server-side authorization before reporting setup, config writes
    # or service changes. Reboot never creates a new grant or resets ACME state.
    deployment.progress()
    return deployment


def pause_recovery(path):
    path, unit = managed_identity(path)
    require_trusted_directory(SYSTEMD_DIRECTORY)
    target = SYSTEMD_DIRECTORY / unit
    if target.exists() or target.is_symlink():
        contents = read_managed_unit(target)
        if not contents.startswith(MANAGED_UNIT_MARKER) or "# StateFile=" + str(path) not in contents.splitlines():
            raise DeploymentError("A different deployment task is selected; no task was changed")
    try:
        if Path(path).exists():
            deployment = Deployment(path)
            recovery = deployment.state.get("managedRecovery", {})
            deadline = recovery.get("deadline") if isinstance(recovery, dict) else None
            deployment.save(managedRecovery={"enabled": False, "deadline": deadline})
    finally:
        remove_managed_unit(path)


@contextmanager
def bootstrap_lock(directory):
    require_trusted_directory(directory)
    fd = open_deployment_lock(directory / ".bootstrap.lock")
    try:
        # The foreground bootstrap already owns fd 9. Reuse its open-file
        # description rather than waiting on our own parent's lock.
        try:
            inherited, opened = os.fstat(9), os.fstat(fd)
            if (inherited.st_dev, inherited.st_ino) == (opened.st_dev, opened.st_ino):
                replacement = os.dup(9)
                os.close(fd)
                fd = replacement
        except OSError:
            pass
        deadline = time.monotonic() + BOOTSTRAP_LOCK_TIMEOUT
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TemporaryDeploymentError("Another installer or deployment still holds the bootstrap lock. Check its status before resuming; saved state and configuration were retained.") from None
                time.sleep(0.1)
        yield
    finally:
        os.close(fd)


class Deployment:
    """Resume one enrollment without changing its persisted recovery-state schema."""

    def __init__(self, path):
        self.path = Path(path)
        require_trusted_directory(self.path.parent)
        self.state = read_object(self.path, "Saved deployment state", private=True)
        self.data = self.state.get("data")
        if not isinstance(self.data, dict) or not isinstance(
            self.data.get("apiHost"), str
        ):
            raise DeploymentError(
                "Saved deployment identity is invalid. Generate a new deployment command in the panel; configuration and certificates were retained."
            )
        self.flow = self.data.get("deployment")
        self.config = self.path.parent / "config.json"
        self.shared_listener = self.state.get("sharedListener", "")
        if not isinstance(self.shared_listener, str) or (self.shared_listener and not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}", self.shared_listener)):
            raise DeploymentError("Invalid shared listener group; configuration preserved")
        if self.shared_listener and (not isinstance(self.flow, dict) or self.flow.get("protocol") not in ("anytls", "vless", "vmess", "trojan", "shadowsocks", "hysteria2", "tuic", "naive") or (self.flow.get("tls") == 1 and self.flow.get("certificateMode") not in ("file", "remote", "http", "dns"))):
            raise DeploymentError("Shared listener requires a supported protocol and compatible TLS certificate; configuration preserved")
        if self.flow is not None and (
            not isinstance(self.flow, dict)
            or type(self.flow.get("tls")) is not int
            or self.flow["tls"] not in (0, 1, 2)
            or not isinstance(self.flow.get("token"), str)
        ):
            raise DeploymentError(
                "Saved deployment workflow is invalid. Generate a new command in the panel; do not remove configuration or certificates."
            )
        self.host = self.data["apiHost"].rstrip("/")
        parsed = urllib.parse.urlsplit(self.host)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise DeploymentError("Invalid HTTPS panel address")
        if (
            parsed.hostname.lower().rstrip(".") == "panel.example.com"
            or type(self.data.get("nodeId")) is not int
            or self.data["nodeId"] <= 0
            or not isinstance(self.data.get("apiKey"), str)
            or not self.data["apiKey"].strip()
            or self.data["apiKey"] == "REPLACE_ME"
        ):
            raise DeploymentError(
                "Invalid enrollment identity; obtain a deployment command from the panel. Example configuration cannot start."
            )

    def save(self, **values):
        self.state.update(values)
        write_private(self.path, self.state)

    def progress(self, action="status"):
        for attempt in range(3):
            try:
                response = json_request(
                    self.host + "/api/v10/server/enrollments/progress",
                    self.flow["token"],
                    dict({"action": action}, **getattr(self, "dns_observation", {})),
                    timeout=60,
                )
                data = response.get("data")
                if not isinstance(data, dict):
                    raise OSError("Invalid deployment progress response")
                return data
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2)

    def command(self, args):
        run_command(args, deployment_locked=True)

    def backup_path(self, action):
        namespace = hashlib.sha256(panel_identity(self.host).encode()).hexdigest()[:16]
        return self.path.parent / (
            "config.before-"
            + action
            + "-"
            + namespace
            + "-"
            + str(self.data["nodeId"])
            + ".json"
        )

    def prepare_config(self):
        node = {
            "NodeType": "v2box",
            "ApiHost": self.host,
            "NodeID": self.data["nodeId"],
            "ApiKey": self.data["apiKey"],
            "ApiVersion": "v10",
            "Timeout": 15,
            "RetryCount": 1,
            "LandingPage": {"Enabled": False, "Directory": ""},
        }
        if self.shared_listener:
            node["SharedListener"] = self.shared_listener
        if self.config.is_symlink():
            raise DeploymentError("Refusing symlinked node configuration")
        if self.config.exists():
            document = read_object(self.config, "Existing node configuration")
            previous = document.get("Nodes", [])
            if (
                not isinstance(previous, list)
                or not previous
                or not all(isinstance(item, dict) for item in previous)
            ):
                raise DeploymentError(
                    "Invalid existing node configuration; preserved without overwrite"
                )
            placeholder = is_placeholder(previous)
            if not placeholder:
                identities = [node_identity(item) for item in previous]
                if len(identities) != len(set(identities)):
                    raise DeploymentError(
                        "Duplicate node identity; existing configuration preserved"
                    )
                matches = [
                    item
                    for item in previous
                    if node_identity(item) == node_identity(node)
                ]
                if matches:
                    if len(matches) != 1:
                        raise DeploymentError(
                            "Duplicate node identity; existing configuration preserved"
                        )
                    self.update_existing_node(document, matches[0], node)
                    return
                self.append_node(document, node)
                return
        write_private(self.config, {"Log": {"Level": "info"}, "Nodes": [node]})

    def save_config_backup(self, action, document):
        backup = self.backup_path(action)
        if not backup.exists():
            write_private(backup, document)

    def update_existing_node(self, document, existing, requested):
        if self.state.get("sharedTLS"):
            self.require_shared_runtime("shared-acme-v1")
        if self.shared_listener and existing.get("SharedListener", "") != self.shared_listener:
            raise DeploymentError("Existing shared listener selection differs; use v2box share-listener explicitly, credentials preserved")
        if any(existing.get(key) != requested[key] for key in ("ApiKey", "ApiVersion")):
            if not self.state.get("replaceCredential"):
                raise DeploymentError(
                    "Existing node credentials changed; preserved without overwrite"
                )
            self.save_config_backup("redeploy", document)
            # Only a newly redeemed scoped grant may replace this identity.
            existing.update({key: requested[key] for key in ("ApiKey", "ApiVersion")})
            write_private(self.config, document)
        os.chmod(self.config, 0o600)

    def append_node(self, document, node):
        # Persist recovery metadata before publishing a new live service.
        self.save_config_backup("add", document)
        original = json.loads(json.dumps(document))
        # Legacy enrollment responses have no readiness/rollback workflow. Keep
        # their independent append semantics rather than converting live peers.
        if self.shared_listener or (self.state.get("autoShare") and self.flow):
            self.prepare_shared_members(document, node)
        document["Nodes"] = document["Nodes"] + [node]
        converted = any(
            before.get("SharedListener", "") != after.get("SharedListener", "")
            for before, after in zip(original["Nodes"], document["Nodes"])
        )
        self.save(previousConfig=original, appendedConfig=document, sharedRestartRequired=converted)
        write_private(self.config, document)

    def shared_resource(self, node, resource):
        # Each panel keeps its own bearer credential; never follow redirects or
        # send credentials to a URL supplied by a configuration response.
        host = panel_identity(node.get("ApiHost", ""))
        if not host.startswith("https://") or node.get("NodeType") != "v2box" or node.get("ApiVersion", "v10") != "v10":
            raise DeploymentError("Automatic sharing requires HTTPS V10 panel nodes; configuration preserved")
        result = json_request(
            host + "/api/v10/server/" + resource,
            node["ApiKey"],
            extra_headers={"Accept": "application/json", "X-Node-Type": "v2box", "X-Node-ID": str(node["NodeID"]),
                           "X-Node-Capabilities": "native-routing-v1,configuration-receipt-v1,certificate-transition-v1"},
        )
        return result.get("data")

    def shared_configuration(self, node):
        config = self.shared_resource(node, "configuration")
        if not isinstance(config, dict) or type(config.get("listenPort")) is not int or not 1 <= config["listenPort"] <= 65535 or not config.get("protocol"):
            raise DeploymentError("Invalid sharing configuration response; configuration preserved")
        # Intervals and accounting capabilities belong to each independent panel.
        return {k: v for k, v in config.items() if k not in ("intervals", "trafficBatchDedup", "trafficBudgetSupported")}

    @staticmethod
    def check_shared_certificate(config):
        if config.get("domainTransition"):
            raise DeploymentError("Finish the pending certificate transition before sharing; configuration preserved")
        if config.get("tls") == 1:
            tls = config.get("tlsSettings", {})
            mode = tls.get("certMode")
            fields = ("certFile", "keyFile") if mode == "file" else ("tlsCert", "tlsKey")
            if mode in ("http", "dns"):
                if not isinstance(tls.get("serverName"), str) or not tls["serverName"]:
                    raise DeploymentError("Shared ACME requires a certificate domain; configuration preserved")
                return
            if mode not in ("file", "remote") or not all(isinstance(tls.get(k), str) and tls[k] for k in fields):
                raise DeploymentError("Sharing requires explicit file paths or remote certificates; existing certificate settings preserved")
            if mode == "file" and not all(os.path.isabs(tls[k]) for k in fields):
                raise DeploymentError("Shared certificate paths must be absolute; configuration preserved")

    def shared_credentials(self, node, config):
        users = self.shared_resource(node, "users")
        if not isinstance(users, list):
            raise DeploymentError("Invalid sharing user response; configuration preserved")
        credentials = set()
        for user in users:
            value = user.get("uuid") if isinstance(user, dict) else None
            if not isinstance(value, str) or not value:
                raise DeploymentError("Invalid sharing user credential; configuration preserved")
            if config["protocol"] in ("vless", "vmess", "tuic"):
                value = value.lower()
            elif config["protocol"] == "shadowsocks" and str(config.get("cipher", "")).startswith("2022-"):
                value = value[:16 if config["cipher"] == "2022-blake3-aes-128-gcm" else 32]
            if value in credentials:
                raise DeploymentError("Shared listener credential conflict; configuration preserved")
            credentials.add(value)
        return credentials

    @staticmethod
    def listeners_overlap(left, right):
        if left["listenPort"] != right["listenPort"]:
            return False
        def transports(config):
            if config["protocol"] in ("tuic", "hysteria2"):
                return {"udp"}
            return {"tcp", "udp"} if config["protocol"] == "shadowsocks" else {"tcp"}
        if not transports(left) & transports(right):
            return False
        first = left.get("listenAddress") or "0.0.0.0"
        second = right.get("listenAddress") or "0.0.0.0"
        return first == second or first in ("0.0.0.0", "::") or second in ("0.0.0.0", "::")

    def require_shared_runtime(self, required="shared-listener-v1"):
        installed = subprocess.run(["/usr/local/lib/v2box/v2box", "capabilities"],
                                   capture_output=True, text=True, timeout=15)
        try:
            capabilities = json.loads(installed.stdout)
        except ValueError:
            capabilities = {}
        features = capabilities.get("features") if isinstance(capabilities, dict) else None
        if installed.returncode or not isinstance(features, list) or required not in features:
            raise DeploymentError("Installed V2Box lacks " + required + "; upgrade the node program first. Configuration preserved")
        result = subprocess.run(["v2box", "check-runtime", required],
                                capture_output=True, text=True, timeout=15)
        if result.returncode or result.stdout.strip() != required:
            raise DeploymentError("Port sharing requires an upgraded V2Box program and manager; configuration preserved")

    @staticmethod
    def listener_configuration(config):
        result = json.loads(json.dumps(config))
        if result.get("tls") == 1:
            tls = result.get("tlsSettings", {})
            for field in ("serverName", "certMode", "certFile", "keyFile", "tlsCert", "tlsKey", "provider", "dnsEnv"):
                tls.pop(field, None)
        return result

    @staticmethod
    def certificate_paths(node, config):
        tls = config["tlsSettings"]
        domain = tls["serverName"]
        binding = node.get("SharedCertificate")
        if binding:
            if binding.get("Domain", "").lower().rstrip(".") != domain.lower().rstrip("."):
                raise DeploymentError("Shared certificate binding domain changed; configuration preserved")
            cert, key = binding["CertFile"], binding["KeyFile"]
        else:
            namespace = hashlib.sha256(panel_identity(node["ApiHost"]).encode()).hexdigest()[:16]
            directory = node.get("CertificateDirectory") or "/etc/v2box/panels/" + namespace + "/" + node["NodeType"] + "-" + str(node["NodeID"])
            cert = tls.get("certFile") or directory + "/" + config["protocol"] + ".cer"
            key = tls.get("keyFile") or directory + "/" + config["protocol"] + ".key"
        for path in (cert, key):
            if not os.path.isabs(path) or "{" in path or "}" in path:
                raise DeploymentError("Shared certificate paths must be explicit absolute paths; configuration preserved")
        if os.path.normpath(cert) == os.path.normpath(key):
            raise DeploymentError("Certificate and key paths must differ; configuration preserved")
        return cert, key

    def prepare_shared_members(self, document, requested):
        config = self.shared_configuration(requested)
        candidates = []
        for peer in document["Nodes"]:
            other = self.shared_configuration(peer)
            same_group = bool(self.shared_listener) and peer.get("SharedListener") == self.shared_listener
            explicit_port = bool(self.shared_listener) and other["listenPort"] == config["listenPort"]
            if self.listeners_overlap(config, other) or same_group or explicit_port:
                candidates.append((peer, other))
        if not candidates and not self.shared_listener:
            return
        self.check_shared_certificate(config)
        if config["protocol"] not in ("anytls", "vless", "vmess", "trojan", "shadowsocks", "hysteria2", "tuic", "naive"):
            raise DeploymentError("Unsupported shared listener protocol; configuration preserved")
        groups = {peer["SharedListener"] for peer, _ in candidates if peer.get("SharedListener")}
        if self.shared_listener:
            groups.add(self.shared_listener)
        if len(groups) > 1:
            raise DeploymentError("Conflicting existing shared groups; configuration preserved")
        group = next(iter(groups), None)
        if group is None:
            digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
            group = "auto-" + str(config["listenPort"]) + "-" + digest
        if not isinstance(group, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}", group):
            raise DeploymentError("Invalid existing shared group name; configuration preserved")
        # Never reuse a generated name already owned by an unrelated listener.
        if any(peer.get("SharedListener") == group and not any(peer is member for member, _ in candidates)
               for peer in document["Nodes"]):
            raise DeploymentError("Shared listener group name conflict; configuration preserved")
        credentials = self.shared_credentials(requested, config)
        tls = config.get("tlsSettings", {}) if config.get("tls") == 1 else {}
        modern_tls = tls.get("certMode") in ("http", "dns")
        shared_binding = None
        signature = self.listener_configuration(config)
        for peer, other in candidates:
            self.check_shared_certificate(other)
            landing = peer.get("LandingPage") or {}
            if self.listener_configuration(other) != signature or landing.get("Enabled", False) or landing.get("Directory", ""):
                raise DeploymentError("Shared listener configuration conflict; align protocol, port, TLS, transport and routing in both panels. Existing configuration preserved")
            peer_credentials = self.shared_credentials(peer, other)
            if credentials & peer_credentials:
                raise DeploymentError("Shared listener credential conflict between panels; configuration preserved")
            credentials.update(peer_credentials)
            if config.get("tls") == 1:
                other_tls = other["tlsSettings"]
                modern_tls = modern_tls or other_tls != tls or other_tls.get("certMode") in ("http", "dns")
                same_domain = tls.get("serverName", "").lower().rstrip(".") == other_tls.get("serverName", "").lower().rstrip(".")
                if same_domain and tls.get("certMode") in ("http", "dns"):
                    # Share only paths, never copy keys or alter either panel's renewal settings.
                    if any(tls.get(k) != other_tls.get(k) for k in ("certMode", "provider", "dnsEnv")):
                        raise DeploymentError("Same-domain renewal settings conflict; configuration preserved")
                    cert, key = self.certificate_paths(peer, other)
                    candidate = {"Domain": tls["serverName"], "CertFile": cert, "KeyFile": key}
                    existing_binding = peer.get("SharedCertificate")
                    if existing_binding:
                        for field in ("LegacyCertFile", "LegacyKeyFile"):
                            if existing_binding.get(field):
                                candidate[field] = existing_binding[field]
                    elif not other_tls.get("certFile") and not other_tls.get("keyFile"):
                        # Retain the original owner's adoption/guard provenance,
                        # including when the stopped service has not migrated yet.
                        stem = "/etc/v2box/" + other["protocol"] + str(peer["NodeID"])
                        candidate.update(LegacyCertFile=stem + ".cer", LegacyKeyFile=stem + ".key")
                    if shared_binding is not None and shared_binding != candidate:
                        raise DeploymentError("Existing same-domain certificate sources conflict; configuration preserved")
                    shared_binding = candidate
                elif same_domain and other_tls != tls:
                    raise DeploymentError("Same-domain certificate sources conflict; configuration preserved")
        if config.get("tls") == 1:
            effective = dict(requested)
            if shared_binding is not None:
                effective["SharedCertificate"] = shared_binding
            path_owners = {}
            for member, settings in [(effective, config)] + candidates:
                details = settings["tlsSettings"]
                if details.get("certMode") == "remote":
                    continue
                domain = details.get("serverName", "").lower().rstrip(".")
                for path in self.certificate_paths(member, settings):
                    path = os.path.normpath(path)
                    if path in path_owners and path_owners[path] != domain:
                        raise DeploymentError("Different certificate domains cannot share certificate/key paths; configuration preserved")
                    path_owners[path] = domain
        if modern_tls:
            self.require_shared_runtime("shared-acme-v1")
        elif self.state.get("autoShare"):
            self.require_shared_runtime()
        self.shared_listener = group
        self.save(sharedListener=group, sharedTLS=bool(modern_tls))
        if shared_binding is not None:
            requested["SharedCertificate"] = shared_binding
        requested["SharedListener"] = group
        for peer, _ in candidates:
            peer["SharedListener"] = group

    def rollback_addition(self):
        original = self.state.get("previousConfig")
        appended = self.state.get("appendedConfig")
        if not original or not appended:
            return
        if self.config.is_symlink():
            raise DeploymentError("Refusing symlinked configuration")
        current = read_object(self.config, "Existing node configuration")
        identity = (panel_identity(self.host), "v2box", self.data["nodeId"])
        expected = [
            item for item in appended["Nodes"] if node_identity(item) == identity
        ]
        matches = [
            item for item in current.get("Nodes", []) if node_identity(item) == identity
        ]
        if len(expected) != 1 or matches != expected:
            raise DeploymentError(
                "Added node configuration changed; automatic rollback refused. Inspect the private config.before-add snapshot."
            )
        # Restore only group selections changed by this deployment. Keep operator
        # edits to unrelated fields, but refuse to overwrite a changed selection.
        converted = False
        for before in original["Nodes"]:
            after = next((n for n in appended["Nodes"] if node_identity(n) == node_identity(before)), None)
            if after is None or before.get("SharedListener", "") == after.get("SharedListener", ""):
                continue
            converted = True
            peers = [n for n in current["Nodes"] if node_identity(n) == node_identity(before)]
            if len(peers) != 1 or peers[0].get("SharedListener", "") != after.get("SharedListener", ""):
                raise DeploymentError("Shared listener selection changed; automatic rollback refused. Inspect the private config.before-add snapshot")
            if "SharedListener" in before:
                peers[0]["SharedListener"] = before["SharedListener"]
            else:
                peers[0].pop("SharedListener", None)
        current["Nodes"] = [
            item for item in current["Nodes"] if node_identity(item) != identity
        ]
        write_private(self.config, current)
        self.save(startAttempted=False, activationAuthorized=False, previousConfig=None, appendedConfig=None, sharedRestartRequired=converted)
        self.apply_service()
        print(
            "Failed added node removed; other panels, operator settings and reporting targets retained. Deployment state saved for retry.",
            flush=True,
        )

    def service_state(self):
        if Path("/run/systemd/system").is_dir() and shutil.which("systemctl"):
            result = subprocess.run(
                ["systemctl", "show", "v2box", "--property=ActiveState", "--value"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            state = result.stdout.strip()
            if result.returncode == 0 and state in (
                "active",
                "activating",
                "reloading",
                "deactivating",
                "inactive",
                "failed",
            ):
                return state
        elif shutil.which("rc-service"):
            result = subprocess.run(
                ["rc-service", "v2box", "status"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            if result.returncode == 0:
                return "active"
            if result.returncode == 3:
                return "inactive"
        raise DeploymentError(
            "Cannot determine V2Box service state. Check v2box status and the service manager before resuming."
        )

    def apply_service(self):
        state = self.service_state()
        if state in ("inactive", "failed"):
            self.command(["v2box", "start"])
        elif state in ("active", "activating", "reloading"):
            if self.state.get("sharedRestartRequired"):
                print("Converting an existing listener to a shared group: restarting V2Box once; active connections will reconnect.", flush=True)
                self.command(["v2box", "restart"])
            else:
                self.command(["v2box", "reload"])
        else:
            raise DeploymentError(
                "V2Box is stopping; wait for it to stop, then resume. Other nodes were not restarted."
            )
        if self.state.get("sharedRestartRequired"):
            self.save(sharedRestartRequired=False)

    def authorize_start(self):
        if not self.state.get("startAttempted") or self.state.get("applyPending"):
            self.check_http_port()
            self.progress("start")
            self.save(startAttempted=True, applyPending=True, activationAuthorized=True)

    def ensure_started(self):
        if not self.state.get("startAttempted") or self.state.get("applyPending"):
            if not self.state.get("activationAuthorized"):
                self.authorize_start()
            self.apply_service()
            self.save(applyPending=False)
            return
        state = self.service_state()
        if state in ("inactive", "failed"):
            print(
                "The previous start did not leave a running service; starting V2Box once.",
                flush=True,
            )
            self.check_http_port()
            self.progress("start")
            self.command(["v2box", "start"])
        else:
            print(
                "V2Box is already "
                + state
                + "; continuing readiness checks without restarting.",
                flush=True,
            )

    def report(self):
        report = self.data.get("networkReport")
        if not report:
            return
        print("Deployment recovery: adding this panel IP reporting target.", flush=True)
        configure_reporting(self.host, report, self.path.parent, self.command)
        self.save(reported=True)

    def verify_dns(self, role, domain, addresses):
        self.dns_observation = {"dnsState": "checking", "dnsRole": role}
        matched = dns_matches(domain, addresses)
        self.dns_observation["dnsState"] = "verified" if matched else "mismatch"
        return matched

    def wait_dns(self):
        if self.flow.get("accessMode") == "unmanaged":
            return False
        print(
            "Waiting for panel synchronization and public A/AAAA propagation (up to 24 hours when managed; 15 minutes in foreground).",
            flush=True,
        )
        budget = 86400 if getattr(self, "managed", False) else 900
        recovery = self.state.get("managedRecovery", {})
        if getattr(self, "persistent", False) and isinstance(recovery, dict):
            budget = min(budget, max(0, recovery.get("deadline", 0) - time.time()))
        deadline = time.monotonic() + budget
        last_reason = None
        polls = 0
        reason = "Waiting for panel response."
        while time.monotonic() < deadline:
            try:
                reason = "Panel deployment status request"
                status = self.progress()
                if status.get("completed"):
                    return True
                reasons = []
                for check in status.get("dnsChecks", []):
                    role = check.get("role")
                    if role not in ("origin", "entry"):
                        continue
                    label = "Origin" if role == "origin" else "Entry"
                    code = check.get("reason")
                    missing = ", ".join(
                        f
                        for f in check.get("missingFamilies", [])
                        if f in ("ipv4", "ipv6")
                    )
                    messages = {
                        "ready": "panel DNS synchronized",
                        "disabled": "server or domain disabled; enable it in the panel",
                        "awaiting_report": "missing or stale "
                        + missing
                        + " report; check IP reporting on this server and its configured address family",
                        "sync_blocked": "DNS synchronization paused; check Cloudflare credentials and record ownership in the panel",
                        "provider_backoff": "Cloudflare retry cooldown; wait for the provider retry",
                        "dns_pending": "waiting for panel DNS synchronization; check domain status in the panel",
                    }
                    if code in messages:
                        reasons.append(label + ": " + messages[code])
                    if code in ("sync_blocked", "disabled"):
                        known_statuses = {
                            "ownership_conflict",
                            "host_changed",
                            "credential_rejected",
                            "credential_unreadable",
                            "configuration_rejected",
                            "ambiguous_records",
                            "unexpected_record",
                            "provider_rejected",
                        }
                        states = ", ".join(
                            s
                            for s in (check.get("status"), check.get("providerStatus"))
                            if isinstance(s, str) and s in known_statuses
                        )
                        raise DeploymentError(
                            label
                            + ": "
                            + messages[code]
                            + (" (" + states + ")" if states else "")
                            + ". No certificate request was started."
                        )
                reason = (
                    "; ".join(reasons)
                    or "Waiting for panel DNS synchronization; check origin/entry IP reporting and Cloudflare status."
                )
                if status.get("dnsStatus") in (
                    "ownership_conflict",
                    "host_changed",
                    "credential_rejected",
                    "configuration_rejected",
                    "ambiguous_records",
                ):
                    raise DeploymentError(
                        "DNS synchronization requires administrator attention: "
                        + status["dnsStatus"]
                    )
                if status.get("dnsReady"):
                    self.dns_observation = {"dnsState": "checking", "dnsRole": "origin"}
                    reason = "Origin public DNS: waiting for A/AAAA to match reported IPs on available public resolvers; correct A/AAAA, review stale records and use DNS-only mode."
                    if not self.verify_dns(
                        "origin", self.flow["domain"], status["addresses"]
                    ):
                        self.dns_observation["dnsState"] = "mismatch"
                    elif (
                        self.flow["tls"] == 1
                        and self.flow["certificateMode"] == "http"
                        and self.flow["certificateDomain"] != self.flow["domain"]
                        and not self.verify_dns(
                            "certificate",
                            self.flow["certificateDomain"],
                            status["addresses"],
                        )
                    ):
                        self.dns_observation = {
                            "dnsState": "mismatch",
                            "dnsRole": "certificate",
                        }
                        reason = "Certificate HTTP validation domain: A/AAAA must point directly to the origin server. Correct certificate DNS or select DNS validation; entry forwarding does not prove port 80 reachability."
                    elif self.flow.get("accessMode") == "relay":
                        self.dns_observation = {
                            "dnsState": "checking",
                            "dnsRole": "entry",
                        }
                        reason = "Entry public DNS: waiting for A/AAAA to match entry server IPs on available public resolvers; correct entry A/AAAA records before resuming."
                        if self.verify_dns(
                            "entry",
                            self.flow["connectionDomain"],
                            status.get("entryAddresses", {}),
                        ):
                            self.dns_observation["dnsState"] = "verified"
                            print(
                                "DNS verified: origin and entry. Next: start V2Box and verify certificate.",
                                flush=True,
                            )
                            return False
                        self.dns_observation["dnsState"] = "mismatch"
                    else:
                        self.dns_observation["dnsState"] = "verified"
                        print(
                            "DNS verified. Next: start V2Box and verify certificate.",
                            flush=True,
                        )
                        return False
            except OSError:
                if reason.startswith("Panel"):
                    reason = "Panel request failed. Check HTTPS connectivity to the panel, then resume."
                else:
                    self.dns_observation["dnsState"] = "unavailable"
                    reason = "Public DNS query services unavailable; neither provider returned a usable response. Check outbound HTTPS and local DNS, then resume. No certificate request was started."
            if reason != last_reason or polls % 4 == 0:
                print(reason + " (%s seconds remaining in DNS wait)." % max(0, int(deadline - time.monotonic())), flush=True)
                last_reason = reason
            polls += 1
            time.sleep(15)
        raise DeploymentError(
            "DNS wait timed out. "
            + reason
            + " No certificate request was started. Fix the reported issue, then resume."
        )

    def check_http_port(self):
        if self.flow["tls"] != 1 or self.flow["certificateMode"] != "http":
            return
        for family, address in ((socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")):
            try:
                with socket.socket(family) as probe:
                    if family == socket.AF_INET6:
                        probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    probe.bind((address, 80))
            except OSError as error:
                if error.errno in (errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL):
                    continue
                raise DeploymentError(
                    "HTTP certificate validation requires a free TCP port 80. Preserve the existing service; resolve the conflict before resuming."
                ) from None

    def verify_certificate(self):
        if self.flow["tls"] != 1 or self.flow["certificateMode"] not in ("http", "dns"):
            return
        cert = self.flow["certificateFile"]
        if not cert:
            host = urllib.parse.urlsplit(self.host)
            canonical = urllib.parse.urlunsplit(
                (host.scheme, host.netloc.lower(), host.path.rstrip("/"), "", "")
            )
            namespace = hashlib.sha256(canonical.encode()).hexdigest()[:16]
            cert = str(
                Path("/etc/v2box/panels")
                / namespace
                / ("v2box-" + str(self.data["nodeId"]))
                / (self.flow["protocol"] + ".cer")
            )
            if self.config.exists():
                for item in read_object(self.config, "Existing node configuration").get(
                    "Nodes", []
                ):
                    if (
                        item.get("ApiHost", "").rstrip("/") == self.host
                        and item.get("NodeID") == self.data["nodeId"]
                    ):
                        binding = item.get("SharedCertificate")
                        if binding and binding.get("Domain", "").lower().rstrip(".") == self.flow["certificateDomain"].lower().rstrip("."):
                            cert = binding["CertFile"]
                        elif item.get("CertificateDirectory"):
                            cert = str(Path(item["CertificateDirectory"]) / (self.flow["protocol"] + ".cer"))
            legacy = (
                "/etc/v2box/"
                + self.flow["protocol"]
                + str(self.data["nodeId"])
                + ".cer"
            )
            if not Path(cert).exists() and Path(legacy).exists():
                cert = legacy
        cert = cert.replace("{domain}", self.flow["certificateDomain"]).replace(
            "{email}", "fastdog.ltd@gmail.com"
        )
        for args in (
            ["openssl", "x509", "-in", cert, "-noout", "-checkend", "3600"],
            [
                "openssl",
                "verify",
                "-purpose",
                "sslserver",
                "-verify_hostname",
                self.flow["certificateDomain"],
                "-untrusted",
                cert,
                cert,
            ],
        ):
            result = subprocess.run(
                args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10
            )
            if result.returncode:
                raise DeploymentError(
                    "Certificate trust, hostname or expiry verification failed; the connection domain was not activated"
                )
        if self.flow["protocol"] not in ("hysteria", "hysteria2", "tuic"):
            address = self.flow["listenAddress"]
            address = {"0.0.0.0": "127.0.0.1", "::": "::1"}.get(address, address)
            context = ssl.create_default_context()
            context.set_alpn_protocols(["h2", "http/1.1"])
            with socket.create_connection(
                (address, self.flow["listenPort"]), timeout=5
            ) as raw:
                with context.wrap_socket(
                    raw, server_hostname=self.flow["certificateDomain"]
                ):
                    pass

    def wait_ready(self):
        print(
            "Waiting for the node to confirm the current configuration and certificate (up to 5 minutes).",
            flush=True,
        )
        deadline = time.monotonic() + 300
        next_notice = 0
        while time.monotonic() < deadline:
            service = self.service_state()
            if service in ("inactive", "failed"):
                raise DeploymentError(
                    "V2Box stopped before becoming ready. Inspect v2box log, fix the startup error, then resume; the resume command will start the stopped service once."
                )
            try:
                status = self.progress()
                if status.get("completed"):
                    return
                if status.get("applicationState") == "failed":
                    self.rollback_addition()
                    raise DeploymentError(
                        "Node configuration failed: "
                        + str(status.get("errorCode"))
                        + ". Inspect journalctl -u v2box. ACME failure guards and certificates were preserved."
                    )
                if status.get("applicationState") == "applied":
                    self.verify_certificate()
                    self.progress("complete")
                    return
            except OSError:
                pass
            if time.monotonic() >= next_notice:
                print(
                    "Service: "
                    + service
                    + ". Waiting for the panel to confirm configuration and certificate; "
                    + str(max(0, int(deadline - time.monotonic())))
                    + " seconds remaining.",
                    flush=True,
                )
                next_notice = time.monotonic() + 30
            time.sleep(10)
        raise DeploymentError(
            "Node readiness timed out. Inspect journalctl -u v2box; do not repeatedly restart or remove ACME state. The domain was not activated."
        )

    def finish(self):
        if self.state.get("grantHash"):
            receipt = self.path.with_name(
                self.path.name.replace("deployment-state", "deployment-completed", 1)
            )
            write_private(
                receipt,
                {
                    "grantHash": self.state["grantHash"],
                    "apiHost": panel_identity(self.host),
                    "nodeId": self.data["nodeId"],
                    "credentialFingerprint": hashlib.sha256(
                        self.data["apiKey"].encode()
                    ).hexdigest(),
                },
            )
        self.path.unlink()
        if not list(self.path.parent.glob("deployment-state*.json")):
            (self.path.parent / ".deployment-pending").unlink(missing_ok=True)
        if self.flow and self.flow.get("accessMode") == "relay":
            print(
                "Origin node verified. Configure L4 forwarding on the entry server, test a client connection. No forwarding confirmation is required in the panel."
            )
            return
        if self.flow and self.flow.get("accessMode") == "unmanaged":
            print(
                "Node configuration and listener verified. Existing connection address, certificates and other panels retained."
            )
            return
        print(
            "Deployment verified. The node connection domain is active."
            if self.flow
            else "Installation complete. Check node runtime status in the panel."
        )

    def run(self):
        # Write enrollment identity before DNS waits, but never append a live
        # service before those checks (the config watcher would start it).
        initial = not self.config.exists()
        if self.config.exists() and not self.config.is_symlink():
            nodes = read_object(self.config, "Existing node configuration").get(
                "Nodes", []
            )
            initial = is_placeholder(nodes)
        if initial:
            if self.config.exists():
                self.command(["v2box", "stop"])
            self.save(startAttempted=False, activationAuthorized=False)
            print(
                "Enrollment saved privately. Node configuration remains unchanged until deployment checks pass.",
                flush=True,
            )
        self.report()
        if self.flow:
            # Panel completion does not prove local files survived reinstall.
            already_completed = self.wait_dns()
            self.authorize_start()
            self.prepare_config()
            try:
                self.ensure_started()
                if not already_completed:
                    self.wait_ready()
            except (DeploymentError, OSError, subprocess.TimeoutExpired):
                if self.shared_listener:
                    self.rollback_addition()
                raise
        else:
            self.prepare_config()
            self.apply_service()
        self.finish()


def main():
    persistent = False
    recovery_path = None
    try:
        if os.geteuid() != 0:
            raise DeploymentError("Run as root")
        if len(sys.argv) == 2 and sys.argv[1] == "--capabilities":
            print(json.dumps({"features": ["management-lock-delegation-v1", "reboot-recovery-v1"]}))
            return 0
        if len(sys.argv) == 2 and sys.argv[1] == "--cancel":
            cancel_managed()
            return 0
        if len(sys.argv) == 7 and sys.argv[1] == "--completed":
            return (
                0
                if completed_enrollment(
                    Path(sys.argv[2]),
                    Path(sys.argv[3]),
                    sys.argv[4],
                    int(sys.argv[5]),
                    sys.argv[6],
                )
                else 1
            )
        if len(sys.argv) == 4 and sys.argv[1] == "--check-report-identity":
            reporting_identity(sys.argv[2], int(sys.argv[3]))
            return 0
        if len(sys.argv) == 3 and sys.argv[1] == "--configure-report":
            path = Path(sys.argv[2])
            require_trusted_directory(path.parent)
            data = read_object(path, "Reporting state", private=True)["data"]
            configure_reporting(
                panel_identity(data["apiHost"]), data["networkReport"], path.parent
            )
            return 0
        persistent = len(sys.argv) == 3 and sys.argv[1] == "--boot-worker"
        managed = persistent or (len(sys.argv) == 3 and sys.argv[1] == "--worker")
        if len(sys.argv) == 2 or (len(sys.argv) == 3 and sys.argv[1] == "--managed"):
            recovery_path = sys.argv[-1]
            if launch_managed(recovery_path):
                return 0
            sys.argv = [sys.argv[0], recovery_path]
        if managed:
            recovery_path = sys.argv[2]
            sys.argv = [sys.argv[0], sys.argv[2]]
        if len(sys.argv) != 2:
            raise DeploymentError("Run with a deployment state file")
        path, _ = managed_identity(sys.argv[1])
        with bootstrap_lock(path.parent):
            lock = path.parent / ".deployment.lock"
            fd = open_deployment_lock(lock)
            with os.fdopen(fd, "w") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                try:
                    deployment = boot_recovery(path) if persistent else Deployment(path)
                    deployment.managed = managed
                    deployment.persistent = persistent
                    deployment.run()
                    if persistent:
                        remove_managed_unit(path)
                except (DeploymentError, ValueError, KeyError, TypeError) as error:
                    if persistent and not isinstance(error, (TemporaryDeploymentError, UnselectedDeploymentError)):
                        try:
                            pause_recovery(path)
                        except (DeploymentError, OSError, ValueError, subprocess.SubprocessError):
                            print("Automatic recovery stopped. Check and disable v2box-deployment before manual repair; state was retained.", file=sys.stderr)
                    raise
    except (
        DeploymentError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.TimeoutExpired,
        subprocess.CalledProcessError,
    ) as error:
        terminal = persistent and isinstance(error, (DeploymentError, ValueError, KeyError, TypeError)) and not isinstance(error, TemporaryDeploymentError)
        if isinstance(error, DeploymentError):
            reason = str(error)
        elif isinstance(error, BlockingIOError):
            reason = "Another deployment is already running. Wait for that command to finish or stop it before resuming."
        elif isinstance(error, subprocess.CalledProcessError):
            reason = "Managed deployment did not start. Check systemctl status v2box-deployment and its journal; another task may still be running."
        elif isinstance(error, PermissionError):
            reason = "Deployment files could not be read or written. Check ownership, permissions and available disk space; configuration and certificates were retained."
        elif isinstance(error, subprocess.TimeoutExpired):
            reason = "Service status query timed out. Check the service manager and v2box log, then resume."
        else:
            reason = "Deployment could not complete; inspect connectivity, configuration and file permissions."
        print(reason, file=sys.stderr)
        if any(
            marker in reason
            for marker in (
                "authorization expired",
                "authorization was revoked",
                "configuration changed",
                "Saved deployment",
            )
        ):
            print(
                "State, configuration and certificates retained. Save the intended settings and generate a new deployment command in the panel; repeating --resume cannot repair this authorization or state.",
                file=sys.stderr,
            )
        else:
            print(
                "State retained. After fixing the cause, run: sh install-v2box.sh --resume (authorization valid for 24 hours).",
                file=sys.stderr,
            )
        return 78 if terminal else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
