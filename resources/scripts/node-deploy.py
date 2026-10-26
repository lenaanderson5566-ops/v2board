#!/usr/bin/env python3
"""Resumable panel deployment. Standard library only; never bypass ACME failure guards."""

import fcntl
import hashlib
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


def json_request(url, token=None, body=None, timeout=10):
    headers = {
        "User-Agent": "v2box-deployment/1.0 (+https://github.com/lenaanderson5566-ops/v2box)",
        "Accept": "application/dns-json" if body is None else "application/json",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
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


def read_object(path, label):
    try:
        document = json.loads(path.read_text())
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
        or node.get("NodeType", "v2node") not in ("v2box", "v2node")
    ):
        raise DeploymentError(
            "Invalid existing node identity; original configuration retained"
        )
    return (
        panel_identity(node.get("ApiHost", "")),
        node.get("NodeType", "v2node"),
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
    receipt = read_object(path, "Completed deployment receipt")
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


def run_command(args):
    try:
        subprocess.run(args, check=True, timeout=180)
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
            "timed out after 180 seconds"
            if isinstance(error, subprocess.TimeoutExpired)
            else (
                "program is missing"
                if isinstance(error, FileNotFoundError)
                else "failed"
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


class Deployment:
    """Resume one enrollment without changing its persisted recovery-state schema."""

    def __init__(self, path):
        self.path = Path(path)
        if (
            self.path.is_symlink()
            or not self.path.is_file()
            or self.path.stat().st_mode & 0o077
        ):
            raise DeploymentError("Deployment state must be a private regular file")
        self.state = read_object(self.path, "Saved deployment state")
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
        if self.shared_listener and (not isinstance(self.flow, dict) or self.flow.get("protocol") not in ("anytls", "vless", "vmess", "trojan", "shadowsocks", "hysteria2", "tuic", "naive") or (self.flow.get("tls") == 1 and self.flow.get("certificateMode") not in ("file", "remote"))):
            raise DeploymentError("Shared listener requires a supported protocol and compatible file or remote TLS certificate; configuration preserved")
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
        run_command(args)

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
        document["Nodes"] = document["Nodes"] + [node]
        self.save(previousConfig=original, appendedConfig=document)
        write_private(self.config, document)

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
        current["Nodes"] = [
            item for item in current["Nodes"] if node_identity(item) != identity
        ]
        write_private(self.config, current)
        self.save(startAttempted=False, activationAuthorized=False)
        self.apply_service()
        print(
            "Failed added node removed; other panels, operator settings and reporting targets retained. Deployment state saved for retry.",
            flush=True,
        )

    def service_state(self):
        if shutil.which("systemctl"):
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
            self.command(["v2box", "reload"])
        else:
            raise DeploymentError(
                "V2Box is stopping; wait for it to stop, then resume. Other nodes were not restarted."
            )

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
            "Waiting for panel synchronization and public A/AAAA propagation (up to 15 minutes).",
            flush=True,
        )
        deadline = time.monotonic() + 900
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
                print(reason, flush=True)
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
                        and item.get("CertificateDirectory")
                    ):
                        cert = str(
                            Path(item["CertificateDirectory"])
                            / (self.flow["protocol"] + ".cer")
                        )
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
            self.ensure_started()
            if not already_completed:
                self.wait_ready()
        else:
            self.prepare_config()
            self.apply_service()
        self.finish()


def main():
    try:
        if os.geteuid() != 0:
            raise DeploymentError("Run as root")
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
            if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
                raise DeploymentError("Reporting state must be private")
            data = read_object(path, "Reporting state")["data"]
            configure_reporting(
                panel_identity(data["apiHost"]), data["networkReport"], path.parent
            )
            return 0
        if len(sys.argv) != 2:
            raise DeploymentError("Run with a deployment state file")
        path = Path(sys.argv[1])
        lock = path.parent / ".deployment.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            Deployment(path).run()
    except (
        DeploymentError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.TimeoutExpired,
    ) as error:
        if isinstance(error, DeploymentError):
            reason = str(error)
        elif isinstance(error, BlockingIOError):
            reason = "Another deployment is already running. Wait for that command to finish or stop it before resuming."
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
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
