"""Workflow test helper, invoked by the existing disposable tests/v2box.php module."""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "deployment-state.json"
        self.data = {
            "nodeId": 3,
            "apiHost": "https://panel.example.invalid",
            "apiKey": "test-only",
            "networkReport": {"token": "c" * 64, "family": "ipv4"},
            "deployment": {
                "token": "dp_" + "d" * 64,
                "domain": "node.example.test",
                "tls": 1,
                "certificateMode": "http",
                "certificateDomain": "node.example.test",
                "certificateFile": "",
                "protocol": "vless",
                "listenAddress": "0.0.0.0",
                "listenPort": 443,
            },
        }
        m.write_private(self.path, {"data": self.data})
        self.deploy = m.Deployment(self.path)
        self.events = []
        self.deploy.report = lambda: self.events.append("report")
        self.deploy.wait_dns = lambda: self.events.append("dns") or False
        self.deploy.check_http_port = lambda: self.events.append("port")
        self.deploy.command = lambda args: self.events.append(args[-1])
        self.deploy.service_state = lambda: "active"
        self.deploy.verify_certificate = lambda: self.events.append("certificate")
        self.deploy.progress = lambda action="status": self.events.append(action) or {
            "applicationState": "applied",
            "completed": action == "complete",
        }

    def test_shared_anytls_append_preserves_peers_and_rollback(self):
        state = json.loads(self.path.read_text())
        state["sharedListener"] = "public-443"
        state["data"]["deployment"].update(protocol="anytls", certificateMode="file")
        m.write_private(self.path, state)
        deploy = m.Deployment(self.path)
        peer = {"NodeType": "v2box", "ApiHost": "https://other.example.test", "NodeID": 3, "ApiKey": "keep", "SharedListener": "public-443", "CertificateDirectory": "/keep/certs"}
        original = {"Log": {"Level": "warn"}, "Nodes": [peer]}
        m.write_private(deploy.config, original)
        self.mock_shared_resources(deploy)
        deploy.prepare_config()
        current = json.loads(deploy.config.read_text())
        self.assertEqual(current["Nodes"][0], peer)
        self.assertEqual(current["Nodes"][1]["SharedListener"], "public-443")
        self.assertEqual(current["Log"], original["Log"])
        deploy.apply_service = lambda: None
        deploy.rollback_addition()
        self.assertEqual(json.loads(deploy.config.read_text()), original)

    def mock_shared_resources(self, deploy, mismatch=None, collision=False):
        def resource(node, name):
            peer = node["ApiHost"] != self.data["apiHost"]
            if name == "users":
                return [{"id": 1, "uuid": "new" if collision or not peer else "old"}]
            config = {"protocol": "anytls", "listenPort": 443, "listenAddress": "0.0.0.0", "tls": 1,
                      "tlsSettings": {"certMode": "file", "certFile": "/keep/cert.pem", "keyFile": "/keep/key.pem"}}
            if peer and mismatch:
                config.update(mismatch)
            return config
        deploy.shared_resource = resource

    def shared_fixture(self):
        state = json.loads(self.path.read_text())
        state["sharedListener"] = "public-443"
        state["data"]["deployment"].update(protocol="anytls", certificateMode="file")
        m.write_private(self.path, state)
        deploy = m.Deployment(self.path)
        peer = {"NodeType": "v2box", "ApiHost": "https://other.example.test", "NodeID": 3,
                "ApiKey": "keep", "CertificateDirectory": "/keep/certs"}
        original = {"Log": {"Level": "warn"}, "Nodes": [peer]}
        m.write_private(deploy.config, original)
        self.mock_shared_resources(deploy)
        deploy.apply_service = lambda: None
        return deploy, original

    def test_shared_install_automatically_groups_original_and_rolls_back(self):
        deploy, original = self.shared_fixture()
        deploy.prepare_config()
        current = json.loads(deploy.config.read_text())
        self.assertEqual([n["SharedListener"] for n in current["Nodes"]], ["public-443"] * 2)
        self.assertEqual(current["Nodes"][0]["ApiKey"], "keep")
        # An operator edit to another setting survives targeted rollback.
        current["Nodes"][0]["Timeout"] = 30
        m.write_private(deploy.config, current)
        deploy.rollback_addition()
        original["Nodes"][0]["Timeout"] = 30
        self.assertEqual(json.loads(deploy.config.read_text()), original)

    def test_shared_conflicts_leave_original_bytes_unchanged(self):
        for mismatch, collision in [({"protocol": "tuic"}, False), ({"routes": [{"id": 7}]}, False),
                                    ({"tlsSettings": {"certMode": "http"}}, False), (None, True)]:
            with self.subTest(mismatch=mismatch, collision=collision):
                deploy, _ = self.shared_fixture()
                before = deploy.config.read_bytes()
                self.mock_shared_resources(deploy, mismatch, collision)
                with self.assertRaises(m.DeploymentError):
                    deploy.prepare_config()
                self.assertEqual(deploy.config.read_bytes(), before)

    def test_shared_offline_panel_preserves_configuration(self):
        deploy, _ = self.shared_fixture()
        before = deploy.config.read_bytes()
        deploy.shared_resource = lambda *args: (_ for _ in ()).throw(OSError("offline"))
        with self.assertRaises(OSError):
            deploy.prepare_config()
        self.assertEqual(deploy.config.read_bytes(), before)

    def test_shared_rollback_refuses_changed_operator_selection(self):
        deploy, _ = self.shared_fixture()
        deploy.prepare_config()
        current = json.loads(deploy.config.read_text())
        current["Nodes"][0]["SharedListener"] = "operator-group"
        m.write_private(deploy.config, current)
        before = deploy.config.read_bytes()
        with self.assertRaisesRegex(m.DeploymentError, "selection changed"):
            deploy.rollback_addition()
        self.assertEqual(deploy.config.read_bytes(), before)

    def test_shared_different_port_keeps_original_ungrouped(self):
        deploy, original = self.shared_fixture()
        self.mock_shared_resources(deploy, {"listenPort": 8443, "tlsSettings": {"certMode": "http"}})
        deploy.prepare_config()
        self.assertEqual(json.loads(deploy.config.read_text())["Nodes"][0], original["Nodes"][0])

    def test_shared_repeat_command_does_not_rewrite_config(self):
        deploy, _ = self.shared_fixture()
        deploy.prepare_config()
        before = deploy.config.stat().st_mtime_ns
        deploy.prepare_config()
        self.assertEqual(deploy.config.stat().st_mtime_ns, before)

    def test_shared_start_failure_and_timeout_restore_original_group(self):
        for failing_step in ("ensure_started", "wait_ready"):
            with self.subTest(step=failing_step):
                deploy, original = self.shared_fixture()
                deploy.report = lambda: None
                deploy.wait_dns = lambda: False
                deploy.authorize_start = lambda: None
                deploy.ensure_started = lambda: None
                deploy.wait_ready = lambda: None
                def fail():
                    raise m.DeploymentError("simulated failure")
                setattr(deploy, failing_step, fail)
                with self.assertRaisesRegex(m.DeploymentError, "simulated failure"):
                    deploy.run()
                self.assertEqual(json.loads(deploy.config.read_text()), original)
                # A second rollback must be harmless; resume can retry the add.
                deploy.rollback_addition()
                deploy.prepare_config()
                self.assertEqual(len(json.loads(deploy.config.read_text())["Nodes"]), 2)

    def test_shared_conversion_restarts_once_then_reloads(self):
        deploy, _ = self.shared_fixture()
        deploy.prepare_config()
        commands = []
        deploy.command = lambda args: commands.append(args)
        deploy.service_state = lambda: "active"
        m.Deployment.apply_service(deploy)
        m.Deployment.apply_service(deploy)
        self.assertEqual(commands, [["v2box", "restart"], ["v2box", "reload"]])

    def automatic_fixture(self, port=443):
        deploy, original = self.shared_fixture()
        deploy.shared_listener = ""
        deploy.save(sharedListener="", autoShare=True)
        self.mock_shared_resources(deploy, {"listenPort": port})
        resource = deploy.shared_resource
        def for_port(node, name):
            result = resource(node, name)
            if name == "configuration":
                result["listenPort"] = port
            return result
        deploy.shared_resource = for_port
        deploy.require_shared_runtime = lambda: None
        return deploy, original

    def test_automatic_legacy_response_keeps_independent_append(self):
        deploy, original = self.automatic_fixture()
        deploy.flow = None
        def unexpected(*args):
            self.fail("Legacy enrollment must not query sharing APIs")
        deploy.shared_resource = unexpected
        deploy.prepare_config()
        nodes = json.loads(deploy.config.read_text())["Nodes"]
        self.assertEqual(nodes[0], original["Nodes"][0])
        self.assertNotIn("SharedListener", nodes[1])

    def test_automatic_sharing_needs_no_argument_on_any_port(self):
        for port in (443, 8443, 20001):
            with self.subTest(port=port):
                deploy, _ = self.automatic_fixture(port)
                deploy.prepare_config()
                nodes = json.loads(deploy.config.read_text())["Nodes"]
                self.assertTrue(nodes[0]["SharedListener"].startswith("auto-" + str(port) + "-"))
                self.assertEqual(nodes[0]["SharedListener"], nodes[1]["SharedListener"])
                before = deploy.config.stat().st_mtime_ns
                deploy.prepare_config()
                self.assertEqual(deploy.config.stat().st_mtime_ns, before)

    def test_automatic_sharing_reuses_existing_group(self):
        deploy, original = self.automatic_fixture(8443)
        original["Nodes"][0]["SharedListener"] = "operator-existing"
        m.write_private(deploy.config, original)
        deploy.prepare_config()
        nodes = json.loads(deploy.config.read_text())["Nodes"]
        self.assertEqual([n["SharedListener"] for n in nodes], ["operator-existing"] * 2)
        self.assertFalse(deploy.state["sharedRestartRequired"])

    def test_automatic_different_port_remains_independent(self):
        deploy, original = self.automatic_fixture()
        self.mock_shared_resources(deploy, {"listenPort": 8443, "tlsSettings": {"certMode": "http"}})
        deploy.prepare_config()
        nodes = json.loads(deploy.config.read_text())["Nodes"]
        self.assertEqual(nodes[0], original["Nodes"][0])
        self.assertNotIn("SharedListener", nodes[1])

    def test_automatic_incompatible_configuration_does_not_change_files(self):
        for mismatch, collision in [({"paddingScheme": ["different"]}, False), (None, True)]:
            with self.subTest(mismatch=mismatch):
                deploy, _ = self.automatic_fixture()
                before = deploy.config.read_bytes()
                self.mock_shared_resources(deploy, mismatch, collision)
                with self.assertRaises(m.DeploymentError):
                    deploy.prepare_config()
                self.assertEqual(deploy.config.read_bytes(), before)

    def test_automatic_shared_runtime_failure_preserves_original(self):
        deploy, _ = self.automatic_fixture()
        before = deploy.config.read_bytes()
        def unsupported():
            raise m.DeploymentError("unsupported runtime")
        deploy.require_shared_runtime = unsupported
        with self.assertRaisesRegex(m.DeploymentError, "unsupported runtime"):
            deploy.prepare_config()
        self.assertEqual(deploy.config.read_bytes(), before)

    def test_shared_capability_checks_installed_and_running_program(self):
        deploy, _ = self.automatic_fixture()
        completed = m.subprocess.CompletedProcess
        with patch.object(m.subprocess, "run", return_value=completed([], 0, '{"features": []}', "")) as run:
            with self.assertRaisesRegex(m.DeploymentError, "Installed V2Box"):
                m.Deployment.require_shared_runtime(deploy)
            self.assertEqual(run.call_count, 1)
        installed = completed([], 0, '{"features": ["shared-listener-v1"]}', "")
        with patch.object(m.subprocess, "run", side_effect=[installed, completed([], 1, "", "")]):
            with self.assertRaisesRegex(m.DeploymentError, "upgraded V2Box"):
                m.Deployment.require_shared_runtime(deploy)
        with patch.object(m.subprocess, "run", side_effect=[installed, completed([], 0, "shared-listener-v1\n", "")]):
            m.Deployment.require_shared_runtime(deploy)

    def test_socket_overlap_respects_tcp_udp_and_bind_address(self):
        tcp = {"protocol": "anytls", "listenPort": 8443, "listenAddress": "127.0.0.1"}
        udp = dict(tcp, protocol="tuic")
        self.assertFalse(m.Deployment.listeners_overlap(tcp, udp))
        self.assertFalse(m.Deployment.listeners_overlap(tcp, dict(tcp, listenAddress="127.0.0.2")))
        self.assertTrue(m.Deployment.listeners_overlap(tcp, dict(tcp, listenAddress="0.0.0.0")))
        self.assertTrue(m.Deployment.listeners_overlap(udp, dict(udp, protocol="hysteria2")))

    def test_shared_resource_uses_own_https_identity_headers(self):
        deploy, original = self.shared_fixture()
        with patch.object(m, "json_request", return_value={"data": {}}) as request:
            m.Deployment.shared_resource(deploy, original["Nodes"][0], "configuration")
        args, kwargs = request.call_args
        self.assertEqual(args, ("https://other.example.test/api/v10/server/configuration", "keep"))
        self.assertEqual(kwargs["extra_headers"]["X-Node-ID"], "3")
        self.assertNotIn("keep", args[0])

    def test_shared_listener_protocol_and_certificate_matrix(self):
        for protocol, tls, mode in [(p, 1, "file") for p in ("anytls", "vless", "vmess", "trojan", "shadowsocks", "hysteria2", "tuic", "naive")] + [("vless", 0, "none"), ("vmess", 0, "none"), ("shadowsocks", 0, "none"), ("vless", 2, "none")]:
            with self.subTest(protocol=protocol, tls=tls):
                state = {"data": json.loads(json.dumps(self.data)), "sharedListener": "shared"}
                state["data"]["deployment"].update(protocol=protocol, tls=tls, certificateMode=mode)
                m.write_private(self.path, state)
                deploy = m.Deployment(self.path)
                self.assertEqual(deploy.shared_listener, "shared")
        for protocol in ("unsupported", "", "http"):
            state["data"]["deployment"].update(protocol=protocol)
            m.write_private(self.path, state)
            with self.assertRaises(m.DeploymentError):
                m.Deployment(self.path)

    def test_shared_listener_refuses_unsupported_protocol_and_existing_selection(self):
        state = json.loads(self.path.read_text())
        state["sharedListener"] = "public-443"
        m.write_private(self.path, state)
        with self.assertRaises(m.DeploymentError):
            m.Deployment(self.path)
        state["data"]["deployment"].update(protocol="anytls", certificateMode="file")
        m.write_private(self.path, state)
        deploy = m.Deployment(self.path)
        existing = {"NodeType": "v2box", "ApiHost": self.data["apiHost"], "NodeID": 3, "ApiKey": "keep", "ApiVersion": "v10", "SharedListener": "different"}
        m.write_private(deploy.config, {"Nodes": [existing]})
        before = deploy.config.read_bytes()
        with self.assertRaises(m.DeploymentError):
            deploy.prepare_config()
        self.assertEqual(deploy.config.read_bytes(), before)

    def tearDown(self):
        self.tmp.cleanup()

    def test_nonobject_response_is_rejected_safely(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, *args):
                return b"[]"

        with patch.object(m.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = Response()
            with self.assertRaisesRegex(OSError, "JSON object"):
                m.json_request("https://panel.example.test")

    def test_expired_authorization_guides_new_command_not_resume(self):
        with patch.object(
            m,
            "Deployment",
            side_effect=m.DeploymentError(
                "Deployment authorization expired. Generate a new deployment task in the panel."
            ),
        ), patch.object(m.sys, "argv", ["deploy", str(self.path)]), patch.object(
            m.sys, "stderr", io.StringIO()
        ) as output:
            self.assertEqual(m.main(), 1)
            self.assertIn("generate a new deployment command", output.getvalue())
            self.assertNotIn("run: sh install-v2box.sh --resume", output.getvalue())
            self.assertTrue(self.path.exists())

    def test_invalid_saved_state_is_actionable_and_retained(self):
        for value in ("{", "[]", '{"data":null}', '{"data":{"apiHost":3}}'):
            self.path.write_text(value)
            self.path.chmod(0o600)
            with self.assertRaises(m.DeploymentError):
                m.Deployment(self.path)
            self.assertEqual(self.path.read_text(), value)

    def test_corrupt_existing_config_is_not_overwritten(self):
        self.deploy.config.write_text("[]")
        with self.assertRaisesRegex(m.DeploymentError, "Existing node configuration"):
            self.deploy.run()
        self.assertEqual(self.deploy.config.read_text(), "[]")
        self.assertTrue(self.path.exists())

    def test_service_command_timeout_is_actionable(self):
        with patch.object(
            m.subprocess,
            "run",
            side_effect=m.subprocess.TimeoutExpired(["v2box", "restart"], 180),
        ):
            with self.assertRaisesRegex(m.DeploymentError, "timed out after 180"):
                m.Deployment.command(self.deploy, ["v2box", "restart"])

    def test_default_certificate_check_uses_panel_namespace(self):
        import hashlib

        self.deploy.flow.update(protocol="hysteria2")
        expected = (
            "/etc/v2box/panels/"
            + hashlib.sha256(self.deploy.host.encode()).hexdigest()[:16]
            + "/v2box-3/hysteria2.cer"
        )
        with patch.object(m.Path, "exists", return_value=False), patch.object(
            m.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
        ) as run:
            m.Deployment.verify_certificate(self.deploy)
        self.assertEqual(run.call_args_list[0].args[0][3], expected)

    def test_certificate_check_respects_operator_directory(self):
        self.deploy.prepare_config()
        document = json.loads(self.deploy.config.read_text())
        document["Nodes"][0]["CertificateDirectory"] = str(
            self.path.parent / "operator-certs"
        )
        m.write_private(self.deploy.config, document)
        self.deploy.flow.update(protocol="hysteria2")
        with patch.object(
            m.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
        ) as run:
            m.Deployment.verify_certificate(self.deploy)
        self.assertEqual(
            run.call_args_list[0].args[0][3],
            str(self.path.parent / "operator-certs" / "hysteria2.cer"),
        )

    def second_panel(self):
        document = json.loads(json.dumps({"data": self.data}))
        document["data"]["apiHost"] = "https://other.example.invalid"
        document["data"]["apiKey"] = "other-scoped-key"
        path = self.path.parent / "deployment-state-other.json"
        m.write_private(path, document)
        return m.Deployment(path)

    def test_cross_panel_same_node_id_preserves_settings_and_files(self):
        self.deploy.prepare_config()
        document = json.loads(self.deploy.config.read_text())
        document["OutboundAllowCIDRs"] = ["10.20.30.40/32"]
        document["Nodes"][0].update(Timeout=42, CertificateDirectory="/operator/certs")
        m.write_private(self.deploy.config, document)
        cert = self.path.parent / "saved.cer"
        cert.write_text("keep certificate")
        second = self.second_panel()
        second.prepare_config()
        result = json.loads(self.deploy.config.read_text())
        self.assertEqual(result["Nodes"][0], document["Nodes"][0])
        self.assertEqual(result["OutboundAllowCIDRs"], document["OutboundAllowCIDRs"])
        self.assertEqual([item["NodeID"] for item in result["Nodes"]], [3, 3])
        self.assertNotEqual(
            result["Nodes"][0]["ApiHost"], result["Nodes"][1]["ApiHost"]
        )
        self.assertEqual(cert.read_text(), "keep certificate")
        before = self.deploy.config.stat().st_mtime_ns
        second.prepare_config()
        self.assertEqual(before, self.deploy.config.stat().st_mtime_ns)

    def test_cross_panel_credential_replacement_is_scoped(self):
        self.deploy.prepare_config()
        second = self.second_panel()
        second.prepare_config()
        before = json.loads(self.deploy.config.read_text())
        second.data["apiKey"] = "rotated-key"
        second.save(replaceCredential=True)
        second.prepare_config()
        after = json.loads(self.deploy.config.read_text())
        self.assertEqual(after["Nodes"][0], before["Nodes"][0])
        self.assertEqual(after["Nodes"][1]["ApiKey"], "rotated-key")

    def test_duplicate_alias_identity_is_refused(self):
        self.deploy.prepare_config()
        document = json.loads(self.deploy.config.read_text())
        document["Nodes"].append(
            dict(
                document["Nodes"][0],
                ApiHost=self.deploy.host.upper().replace("HTTPS:", "https:") + "/",
            )
        )
        m.write_private(self.deploy.config, document)
        before = self.deploy.config.read_bytes()
        with self.assertRaises(m.DeploymentError):
            self.deploy.prepare_config()
        self.assertEqual(before, self.deploy.config.read_bytes())

    def test_activation_is_authorized_before_writing_live_node(self):
        self.deploy.prepare_config()
        self.deploy.data["nodeId"] = 4

        def progress(action="status"):
            if action == "start":
                self.assertEqual(
                    len(json.loads(self.deploy.config.read_text())["Nodes"]), 1
                )
            return {"applicationState": "applied", "completed": action == "complete"}

        self.deploy.progress = progress
        self.deploy.run()
        self.assertIn("reload", self.events)
        self.assertNotIn("restart", self.events)

    @unittest.skipUnless(
        os.environ.get("V2BOX_NETWORK_SCRIPT"), "network helper fixture required"
    )
    def test_reporting_merge_preserves_other_panel_dns_and_backoff(self):
        spec = importlib.util.spec_from_file_location(
            "network_fixture", os.environ["V2BOX_NETWORK_SCRIPT"]
        )
        network = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(network)
        root = self.path.parent / "network"
        root.mkdir()
        network.CONFIG = root / "config.json"
        network.STATE = root / "state.json"
        dns = {
            "zone_id": "a" * 32,
            "token": "dns-key",
            "domain": "saved.example.test",
            "family": "ipv4",
        }
        network.write_private(network.CONFIG, dns)
        network.write_private(network.STATE, {"paused": True, "next_run": 1234})

        def mapped(value):
            text = str(value)
            return (
                root / text[len("/etc/node-network/") :]
                if text.startswith("/etc/node-network/")
                else (root if text == "/etc/node-network" else Path(value))
            )

        def command(args):
            token = Path(args[args.index("--token-file") + 1])
            self.assertEqual(token.stat().st_mode & 0o777, 0o600)
            network.save_target(
                {
                    "mode": "panel",
                    "panel_url": args[args.index("--panel-url") + 1],
                    "token": token.read_text(),
                    "family": "ipv4",
                    "server_id": int(args[args.index("--server-id") + 1]),
                }
            )

        with patch.object(m, "Path", side_effect=mapped):
            for host, token in [
                ("https://a.example.test", "b" * 64),
                ("https://b.example.test", "c" * 64),
            ]:
                m.configure_reporting(
                    host,
                    {"token": token, "family": "ipv4", "serverId": 7},
                    self.path.parent,
                    command,
                )
            before = network.CONFIG.read_bytes()
            with self.assertRaises(m.DeploymentError):
                m.configure_reporting(
                    "https://a.example.test",
                    {"token": "d" * 64, "family": "ipv4", "serverId": 8},
                    self.path.parent,
                    command,
                )
        self.assertEqual(network.CONFIG.read_bytes(), before)
        self.assertEqual(len(network.targets(json.loads(before))), 3)
        state = json.loads(network.STATE.read_text())["targets"][
            network.target_key(dns)
        ]
        self.assertTrue(state["paused"])
        self.assertEqual(state["next_run"], 1234)
        self.assertEqual(len(list((root / "identities").glob("*.json"))), 2)
        self.assertFalse(list(self.path.parent.glob(".report-*")))

    def test_completed_command_receipt_is_private_scoped_and_has_no_key(self):
        self.deploy.save(grantHash="a" * 64)
        self.deploy.prepare_config()
        self.deploy.finish()
        receipt = self.path.with_name("deployment-completed.json")
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(self.data["apiKey"], receipt.read_text())
        self.assertTrue(
            m.completed_enrollment(
                receipt, self.deploy.config, self.deploy.host, 3, "a" * 64
            )
        )
        self.assertFalse(
            m.completed_enrollment(
                receipt, self.deploy.config, "https://other.example.test", 3, "a" * 64
            )
        )
        document = json.loads(self.deploy.config.read_text())
        document["Nodes"][0]["ApiKey"] = "rotated"
        m.write_private(self.deploy.config, document)
        self.assertFalse(
            m.completed_enrollment(
                receipt, self.deploy.config, self.deploy.host, 3, "a" * 64
            )
        )

    def test_order_and_private_config(self):
        self.deploy.run()
        self.assertEqual(
            self.events,
            [
                "report",
                "dns",
                "port",
                "start",
                "reload",
                "status",
                "certificate",
                "complete",
            ],
        )
        self.assertFalse(self.path.exists())
        self.assertEqual(self.deploy.config.stat().st_mode & 0o777, 0o600)

    def test_placeholder_retained_until_dns_ready(self):
        placeholder = {
            "Nodes": [{"ApiHost": "https://panel.example.com", "ApiKey": "REPLACE_ME"}]
        }
        m.write_private(self.deploy.config, placeholder)

        def fail_dns():
            self.assertEqual(json.loads(self.deploy.config.read_text()), placeholder)
            self.assertEqual(self.deploy.data["apiKey"], self.data["apiKey"])
            raise m.DeploymentError("dns unavailable")

        self.deploy.wait_dns = fail_dns
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertEqual(json.loads(self.deploy.config.read_text()), placeholder)
        self.assertIn("stop", self.events)
        self.assertNotIn("reload", self.events)
        self.assertTrue(self.path.exists())

    def test_completed_panel_repairs_local_placeholder(self):
        m.write_private(
            self.deploy.config,
            {
                "Nodes": [
                    {"ApiHost": "https://panel.example.com", "ApiKey": "REPLACE_ME"}
                ]
            },
        )
        self.deploy.save(startAttempted=True)
        self.deploy.wait_dns = lambda: True
        self.deploy.run()
        self.assertEqual(
            json.loads(self.deploy.config.read_text())["Nodes"][0]["ApiHost"],
            self.data["apiHost"],
        )
        self.assertIn("reload", self.events)
        self.assertFalse(self.path.exists())

    def test_uninstalled_resume_restores_programs_and_preserves_files(self):
        root = Path(self.tmp.name)
        binpath = root / "bin"
        binpath.mkdir()
        cert = root / "saved.cer"
        cert.write_text("existing certificate")
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        curl = binpath / "curl"
        curl.write_text(
            '#!/bin/bash\nwhile (($#)); do if [[ "$1" == -o ]]; then shift; out=$1; fi; shift; done\nprintf \'#!/bin/bash\\necho restored > PLACEHOLDER\\nmkdir -p RESTORE_LIB\\nfor file in v2box manager.sh install.sh node-network.py node-credentials.py; do echo repaired > RESTORE_LIB/$file; chmod 700 RESTORE_LIB/$file; done\\necho repaired > RESTORE_MANAGER\\nchmod 700 RESTORE_MANAGER\\n\' > "$out"\n'.replace(
                "PLACEHOLDER", str(root / "restored")
            )
            .replace("RESTORE_LIB", str(root / "lib"))
            .replace("RESTORE_MANAGER", str(root / "manager"))
        )
        curl.chmod(0o700)
        script = Path(sys.argv[1]).with_suffix(".sh").read_text()
        function = script.split("restore_programs() {", 1)[1].split(
            '\nif [[ "${1:-}" == --resume ]]', 1
        )[0]
        programs = (
            "programs_ready() {"
            + script.split("programs_ready() {", 1)[1].split(
                "\n# Resume can follow uninstall:", 1
            )[0]
        )
        function = (
            (programs + "\nrestore_programs() {" + function)
            .replace("/etc/v2box", str(root))
            .replace("/usr/local/lib/v2box", str(root / "lib"))
            .replace("/usr/local/bin/v2box", str(root / "manager"))
        )
        result = subprocess.run(
            ["bash", "-c", function + "\nrestore_programs"],
            env=dict(os.environ, PATH=str(binpath) + ":" + os.environ["PATH"]),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((root / "restored").exists())
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertEqual(cert.read_text(), "existing certificate")
        self.assertTrue(self.path.exists())
        for missing in [
            "manager.sh",
            "install.sh",
            "node-network.py",
            "node-credentials.py",
            "wrapper",
        ]:
            path = root / "manager" if missing == "wrapper" else root / "lib" / missing
            path.unlink()
            (root / "restored").unlink()
            result = subprocess.run(
                ["bash", "-c", function + "\nrestore_programs"],
                env=dict(os.environ, PATH=str(binpath) + ":" + os.environ["PATH"]),
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(path.exists())
            self.assertTrue((root / "restored").exists())
            self.assertEqual(self.deploy.config.read_bytes(), before)
            self.assertEqual(cert.read_text(), "existing certificate")

    def test_fresh_authorization_replaces_only_target_credential(self):
        self.deploy.prepare_config()
        original = json.loads(self.deploy.config.read_text())
        original["Nodes"][0]["Timeout"] = 42
        original["Nodes"].append(dict(original["Nodes"][0], NodeID=4))
        m.write_private(self.deploy.config, original)
        self.deploy.data["apiKey"] = "new-scoped-key"
        with self.assertRaises(m.DeploymentError):
            self.deploy.prepare_config()
        self.deploy.save(replaceCredential=True)
        self.deploy.prepare_config()
        current = json.loads(self.deploy.config.read_text())
        self.assertEqual(current["Nodes"][0]["ApiKey"], "new-scoped-key")
        self.assertEqual(current["Nodes"][0]["Timeout"], 42)
        self.assertEqual(current["Nodes"][1], original["Nodes"][1])
        self.assertEqual(
            json.loads(self.deploy.backup_path("redeploy").read_text()), original
        )

    @unittest.skipUnless(__import__("shutil").which("jq"), "jq required")
    def test_fresh_grant_replaces_stale_state_and_same_grant_resumes(self):
        root = Path(self.tmp.name)
        binpath = root / "bin"
        binpath.mkdir()
        lib = root / "lib"
        lib.mkdir()
        for name in (
            "v2box",
            "manager.sh",
            "install.sh",
            "node-network.py",
            "node-credentials.py",
        ):
            (lib / name).write_text("#!/bin/sh\nexit 0\n")
            (lib / name).chmod(0o700)
        manager = root / "manager"
        manager.write_text("#!/bin/sh\nexit 0\n")
        manager.chmod(0o700)
        (lib / "v2box").write_text(
            '#!/bin/sh\necho \'{"features":["multi-panel-v1","reload-signal-v1"]}\'\n'
        )
        for name, body in {
            "python3": 'if [[ "${2:-}" == --completed ]]; then exit 1; fi\necho \'{"features":["report-multi-target-v1"]}\'',
            "curl": 'while (($#)); do if [[ "$1" == -o ]]; then shift; out=$1; fi; shift; done\n[ ! -f "'
            + str(root / "fail")
            + '" ] || exit 22\necho redeemed >> "'
            + str(root / "redeemed")
            + '"\ncp "'
            + str(root / "response.json")
            + '" "$out"',
        }.items():
            f = binpath / name
            f.write_text("#!/bin/bash\n" + body + "\n")
            f.chmod(0o700)
        self.deploy.prepare_config()
        response = {
            "data": dict(
                self.data, nodeType="v2box", apiKey="nk_" + "a" * 32 + "." + "b" * 64
            )
        }
        (root / "response.json").write_text(json.dumps(response))
        script = (
            Path(sys.argv[1])
            .with_suffix(".sh")
            .read_text()
            .replace("__NODE_PREREQUISITES__", "")
            .replace("__NODE_DEPLOY_HELPER__", "pass")
        )
        script = (
            script.replace("/etc/v2box", str(root))
            .replace("/usr/local/lib/v2box", str(lib))
            .replace("/usr/local/bin/v2box", str(manager))
            .replace("/etc/node-network", str(root / "network"))
        )
        bootstrap = root / "bootstrap.sh"
        bootstrap.write_text(script)

        def run(grant, legacy=False):
            arguments = (
                ["bash", str(bootstrap)]
                if legacy
                else [
                    "bash",
                    str(bootstrap),
                    "--api-host",
                    self.data["apiHost"],
                    "--node-id",
                    "3",
                    "--deploy-token",
                    grant,
                ]
            )
            return subprocess.run(
                arguments,
                input=(self.data["apiHost"] + "\n" + grant + "\n") if legacy else None,
                env=dict(os.environ, PATH=str(binpath) + ":" + os.environ["PATH"]),
                capture_output=True,
                text=True,
            )

        grant = "nd_" + "d" * 64
        result = run(grant)
        self.assertEqual(result.returncode, 0, result.stderr)
        saved = self.path.read_bytes()
        self.assertTrue(json.loads(saved)["replaceCredential"])
        result = run(grant)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((root / "redeemed").read_text(), "redeemed\n")
        (root / "fail").touch()
        result = run("nd_" + "e" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.path.read_bytes(), saved)
        self.assertIn("Authorization redemption failed", result.stderr)
        (root / "fail").unlink()
        result = run("nd_" + "f" * 64, legacy=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(self.path.read_text())["replaceCredential"])

    def test_missing_program_has_actionable_error(self):
        with patch.object(m.subprocess, "run", side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(m.DeploymentError, "program is missing"):
                m.Deployment.command(self.deploy, ["v2box", "restart"])

    def test_reported_state_restores_reporting_schedule(self):
        self.deploy.save(reported=True)
        m.Deployment.report(self.deploy)
        self.assertTrue(self.deploy.state["reported"])
        self.assertEqual(len(self.events), 1)

    def test_report_failure_never_starts(self):
        self.deploy.report = lambda: (_ for _ in ()).throw(m.DeploymentError("report"))
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertNotIn("restart", self.events)
        self.assertTrue(self.path.exists())

    def test_dns_timeout_never_starts(self):
        self.deploy.wait_dns = lambda: m.Deployment.wait_dns(self.deploy)
        with patch.object(m.time, "monotonic", side_effect=[0, 1000]):
            with self.assertRaises(m.DeploymentError):
                self.deploy.run()
        self.assertNotIn("restart", self.events)
        self.assertFalse(self.deploy.state.get("startAttempted"))

    def test_resume_does_not_repeat_acme_start(self):
        self.deploy.prepare_config()
        self.deploy.save(startAttempted=True)
        self.deploy.run()
        self.assertNotIn("restart", self.events)
        self.assertIn("complete", self.events)

    def test_resume_starts_stopped_service_once(self):
        for state in ("inactive", "failed"):
            with self.subTest(state=state):
                self.events.clear()
                self.deploy.save(startAttempted=True)
                self.deploy.service_state = lambda: state
                self.deploy.ensure_started()
                self.assertEqual(self.events, ["port", "start", "start"])

    def test_failed_start_is_recoverable_without_manual_restart(self):
        self.deploy.command = lambda args: (_ for _ in ()).throw(
            m.DeploymentError("start failed")
        )
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertTrue(self.deploy.state["startAttempted"])
        self.events.clear()
        states = iter(["inactive", "active"])
        commands = []
        self.deploy.service_state = lambda: next(states)
        self.deploy.command = lambda args: commands.append(args)
        self.deploy.run()
        self.assertEqual(commands, [["v2box", "start"]])
        self.assertIn("complete", self.events)
        self.assertFalse(self.path.exists())

    def test_starting_service_is_not_restarted_on_resume(self):
        self.deploy.save(startAttempted=True)
        self.deploy.service_state = lambda: "activating"
        self.deploy.ensure_started()
        self.assertEqual(self.events, [])

    def test_stopped_service_is_reported_without_waiting_five_minutes(self):
        self.deploy.service_state = lambda: "failed"
        with self.assertRaisesRegex(m.DeploymentError, "V2Box stopped"):
            self.deploy.wait_ready()
        self.assertNotIn("complete", self.events)
        self.assertTrue(self.path.exists())

    def test_unchanged_config_does_not_trigger_file_watcher(self):
        self.deploy.prepare_config()
        original = json.loads(self.deploy.config.read_text())
        original["Log"] = {"Level": "warn"}
        m.write_private(self.deploy.config, original)
        before = self.deploy.config.stat().st_ino, self.deploy.config.stat().st_mtime_ns
        self.deploy.prepare_config()
        self.assertEqual(
            before,
            (self.deploy.config.stat().st_ino, self.deploy.config.stat().st_mtime_ns),
        )
        self.assertEqual(
            json.loads(self.deploy.config.read_text())["Log"], {"Level": "warn"}
        )

    def test_append_preserves_services_and_settings_and_resume(self):
        self.deploy.prepare_config()
        original = json.loads(self.deploy.config.read_text())
        original["Log"] = {"Level": "warn"}
        original["Nodes"][0]["Timeout"] = 42
        m.write_private(self.deploy.config, original)
        self.deploy.data["nodeId"] = 4
        self.deploy.prepare_config()
        result = json.loads(self.deploy.config.read_text())
        self.assertEqual(result["Log"], original["Log"])
        self.assertEqual(result["Nodes"][0], original["Nodes"][0])
        self.assertEqual([n["NodeID"] for n in result["Nodes"]], [3, 4])
        backup = self.deploy.backup_path("add")
        self.assertEqual(json.loads(backup.read_text()), original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        before = self.deploy.config.stat().st_mtime_ns
        self.deploy.prepare_config()
        self.assertEqual(before, self.deploy.config.stat().st_mtime_ns)

    def test_failed_addition_restores_previous_services(self):
        self.deploy.prepare_config()
        original = json.loads(self.deploy.config.read_text())
        self.deploy.data["nodeId"] = 4
        self.deploy.prepare_config()
        self.deploy.progress = lambda action="status": {
            "applicationState": "failed",
            "errorCode": "core",
        }
        with self.assertRaises(m.DeploymentError):
            self.deploy.wait_ready()
        self.assertEqual(json.loads(self.deploy.config.read_text()), original)
        self.assertIn("reload", self.events)
        self.assertFalse(self.deploy.state["startAttempted"])

    def test_rollback_preserves_other_nodes_and_operator_changes(self):
        self.deploy.prepare_config()
        self.deploy.data["nodeId"] = 4
        self.deploy.prepare_config()
        changed = json.loads(self.deploy.config.read_text())
        changed["Log"] = {"Level": "debug"}
        another = dict(changed["Nodes"][0], ApiHost="https://another.example.test")
        changed["Nodes"].append(another)
        m.write_private(self.deploy.config, changed)
        self.deploy.rollback_addition()
        result = json.loads(self.deploy.config.read_text())
        self.assertEqual(result["Log"], changed["Log"])
        self.assertEqual(result["Nodes"], [changed["Nodes"][0], another])

    def test_rollback_refuses_edits_to_the_added_node(self):
        self.deploy.prepare_config()
        self.deploy.data["nodeId"] = 4
        self.deploy.prepare_config()
        changed = json.loads(self.deploy.config.read_text())
        changed["Nodes"][1]["Timeout"] = 77
        m.write_private(self.deploy.config, changed)
        with self.assertRaises(m.DeploymentError):
            self.deploy.rollback_addition()
        self.assertEqual(json.loads(self.deploy.config.read_text()), changed)

    def test_same_identity_different_key_is_not_overwritten(self):
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        self.deploy.data["apiKey"] = "different"
        with self.assertRaises(m.DeploymentError):
            self.deploy.prepare_config()
        self.assertEqual(before, self.deploy.config.read_bytes())

    def test_dns_failure_does_not_change_live_config(self):
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        self.deploy.data["nodeId"] = 4
        self.deploy.wait_dns = lambda: (_ for _ in ()).throw(
            m.DeploymentError("DNS not ready")
        )
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertEqual(before, self.deploy.config.read_bytes())

    def test_service_state_handles_systemd_and_openrc(self):
        for state in ("active", "activating", "inactive", "failed"):
            with patch.object(
                m.shutil, "which", return_value="/bin/systemctl"
            ), patch.object(
                m.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, state + "\n"),
            ):
                self.assertEqual(m.Deployment.service_state(self.deploy), state)
        with patch.object(
            m.shutil,
            "which",
            side_effect=lambda name: (
                "/bin/rc-service" if name == "rc-service" else None
            ),
        ), patch.object(
            m.subprocess, "run", return_value=subprocess.CompletedProcess([], 3)
        ):
            self.assertEqual(m.Deployment.service_state(self.deploy), "inactive")
        with patch.object(
            m.shutil, "which", return_value="/bin/systemctl"
        ), patch.object(
            m.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 1, "unknown"),
        ):
            with self.assertRaisesRegex(m.DeploymentError, "Cannot determine"):
                m.Deployment.service_state(self.deploy)

    def test_certificate_failure_never_publishes(self):
        self.deploy.verify_certificate = lambda: (_ for _ in ()).throw(
            m.DeploymentError("certificate")
        )
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertNotIn("complete", self.events)
        self.assertTrue(self.path.exists())
        self.assertTrue(self.deploy.state["startAttempted"])

    def test_failed_node_never_publishes(self):
        self.deploy.progress = lambda action="status": {
            "applicationState": "failed",
            "errorCode": "certificate",
        }
        with self.assertRaises(m.DeploymentError):
            self.deploy.run()
        self.assertNotIn("certificate", self.events)

    def test_missing_receipt_times_out(self):
        with patch.object(m.time, "monotonic", side_effect=[0, 1000]):
            with self.assertRaises(m.DeploymentError):
                self.deploy.wait_ready()
        self.assertNotIn("complete", self.events)

    def test_certificate_path_uses_independent_acme_contact(self):
        self.deploy.flow.update(
            certificateFile="/tmp/{email}/{domain}.cer", protocol="hysteria2"
        )
        with patch.object(m.subprocess, "run") as run:
            run.return_value.returncode = 0
            m.Deployment.verify_certificate(self.deploy)
            expected = "/tmp/fastdog.ltd@gmail.com/node.example.test.cer"
            self.assertEqual(run.call_args_list[0].args[0][3], expected)
            self.assertEqual(run.call_args_list[1].args[0][-1], expected)

    def test_relay_checks_origin_and_entry_separately(self):
        self.deploy.flow.update(
            accessMode="relay",
            connectionDomain="entry.example.test",
            certificateMode="dns",
            certificateDomain="entry.example.test",
        )
        self.deploy.progress = lambda action="status": {
            "dnsReady": True,
            "addresses": {"ipv4": "8.8.8.8"},
            "entryAddresses": {"ipv4": "1.1.1.1"},
        }
        with patch.object(m, "dns_matches", return_value=True) as check:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual(
                check.call_args_list[0].args, ("node.example.test", {"ipv4": "8.8.8.8"})
            )
            self.assertEqual(
                check.call_args_list[1].args,
                ("entry.example.test", {"ipv4": "1.1.1.1"}),
            )

    def test_relay_entry_dns_wait_keeps_polling_interval(self):
        self.deploy.flow.update(
            accessMode="relay",
            connectionDomain="entry.example.test",
            certificateMode="dns",
        )
        self.deploy.progress = lambda action="status": {
            "dnsReady": True,
            "addresses": {"ipv4": "8.8.8.8"},
            "entryAddresses": {"ipv4": "1.1.1.1"},
        }
        with patch.object(m, "dns_matches", side_effect=[True, False]), patch.object(
            m.time, "monotonic", side_effect=[0, 0, 1000]
        ), patch.object(m.time, "sleep") as sleep:
            with self.assertRaises(m.DeploymentError):
                m.Deployment.wait_dns(self.deploy)
            sleep.assert_called_once_with(15)

    def test_http_relay_checks_independent_certificate_domain_before_start(self):
        self.deploy.flow.update(
            accessMode="relay",
            connectionDomain="entry.example.test",
            certificateMode="http",
            certificateDomain="cert.example.test",
        )
        self.deploy.progress = lambda action="status": {
            "dnsReady": True,
            "addresses": {"ipv4": "8.8.8.8"},
            "entryAddresses": {"ipv4": "1.1.1.1"},
        }
        with patch.object(m, "dns_matches", return_value=True) as check:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual(
                [call.args for call in check.call_args_list],
                [
                    ("node.example.test", {"ipv4": "8.8.8.8"}),
                    ("cert.example.test", {"ipv4": "8.8.8.8"}),
                    ("entry.example.test", {"ipv4": "1.1.1.1"}),
                ],
            )
        with patch.object(m, "dns_matches", side_effect=[True, False]), patch.object(
            m.time, "monotonic", side_effect=[0, 0, 1000]
        ), patch.object(m.time, "sleep"):
            with self.assertRaisesRegex(
                m.DeploymentError, "point directly to the origin"
            ):
                m.Deployment.wait_dns(self.deploy)
        self.assertNotIn("restart", self.events)
        self.assertNotIn("certificate", self.events)

    def test_dual_entry_ipv4_origin_http_flow_never_requires_origin_ipv6(self):
        self.deploy.flow.update(
            accessMode="relay",
            connectionDomain="entry.example.test",
            certificateMode="http",
            certificateDomain="node.example.test",
        )
        self.deploy.progress = lambda action="status": {
            "dnsReady": True,
            "addresses": {"ipv4": "8.8.8.8"},
            "entryAddresses": {"ipv4": "1.1.1.1", "ipv6": "2606:4700:4700::1111"},
        }

        def answers(domain, endpoint):
            return (
                {"ipv4": {"8.8.8.8"}, "ipv6": set()}
                if domain == "node.example.test"
                else {"ipv4": {"1.1.1.1"}, "ipv6": {"2606:4700:4700::1111"}}
            )

        with patch.object(m, "dns_answers", side_effect=answers) as resolver:
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
            self.assertEqual(resolver.call_count, 4)
        self.assertNotIn("certificate", self.events)

    def test_dns_wait_reports_missing_family_and_preserves_state(self):
        self.deploy.progress = lambda action="status": {
            "dnsReady": False,
            "dnsChecks": [
                {
                    "role": "entry",
                    "reason": "awaiting_report",
                    "missingFamilies": ["ipv6"],
                }
            ],
        }
        with patch.object(m.time, "monotonic", side_effect=[0, 0, 1000]), patch.object(
            m.time, "sleep"
        ), patch("sys.stdout", new_callable=io.StringIO) as out:
            with self.assertRaisesRegex(
                m.DeploymentError, "Entry: missing or stale ipv6"
            ):
                m.Deployment.wait_dns(self.deploy)
            self.assertIn("Entry: missing or stale ipv6", out.getvalue())
        self.assertTrue(self.path.exists())
        self.assertNotIn("restart", self.events)

    def test_entry_credential_pause_fails_without_certificate_request(self):
        self.deploy.progress = lambda action="status": {
            "dnsReady": False,
            "dnsChecks": [
                {"role": "entry", "reason": "sync_blocked", "missingFamilies": []}
            ],
        }
        with self.assertRaisesRegex(
            m.DeploymentError, "Entry: DNS synchronization paused"
        ):
            m.Deployment.wait_dns(self.deploy)
        self.assertNotIn("certificate", self.events)

    def test_known_conflict_is_actionable_without_echoing_unknown_secrets(self):
        for detail, expected in [
            (
                "节点或域名配置已变化，请核对后重新部署",
                "Deployment configuration changed",
            ),
            ("secret-token", "Deployment request rejected"),
        ]:
            error = m.urllib.error.HTTPError(
                "https://panel.example.test",
                409,
                "Conflict",
                {},
                io.BytesIO(json.dumps({"detail": detail}).encode()),
            )
            with patch.object(m.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                with self.assertRaisesRegex(m.DeploymentError, expected) as caught:
                    m.json_request(
                        "https://panel.example.test", body={"action": "status"}
                    )
                self.assertNotIn("secret-token", str(caught.exception))

    def test_relay_finish_does_not_claim_entry_connectivity(self):
        self.deploy.flow["accessMode"] = "relay"
        with patch("sys.stdout", new_callable=io.StringIO) as out:
            self.deploy.finish()
            self.assertIn("test a client connection", out.getvalue())
            self.assertNotIn("connection domain is active", out.getvalue())

    def test_dns_stale_ipv6_rejected(self):
        with patch.object(
            m,
            "dns_answers",
            return_value={"ipv4": {"8.8.8.8"}, "ipv6": {"2606:4700:4700::1111"}},
        ):
            self.assertFalse(m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"}))

    def test_dns_does_not_ignore_a_resolver_mismatch(self):
        with patch.object(
            m,
            "dns_answers",
            side_effect=[
                {"ipv4": {"8.8.8.8"}, "ipv6": set()},
                {"ipv4": {"1.1.1.1"}, "ipv6": set()},
            ],
        ) as resolver:
            self.assertFalse(m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"}))
            self.assertEqual(resolver.call_count, 2)

    def test_dns_unavailable_provider_falls_back(self):
        good = {"ipv4": {"8.8.8.8"}, "ipv6": set()}
        for responses in ([OSError("offline"), good], [good, OSError("offline")]):
            with patch.object(m, "dns_answers", side_effect=responses):
                self.assertTrue(m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"}))
        with patch.object(m, "dns_answers", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"})
        with patch.object(
            m,
            "dns_answers",
            side_effect=[OSError("offline"), {"ipv4": set(), "ipv6": set()}],
        ):
            self.assertFalse(m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"}))

    def test_dns_nxdomain_is_mismatch_not_service_outage(self):
        with patch.object(m, "json_request", return_value={"Status": 3}):
            self.assertFalse(m.dns_matches("node.example.test", {"ipv4": "8.8.8.8"}))

    def test_dns_observation_identifies_role_and_never_claims_certificate_success(self):
        with patch.object(m, "dns_matches", return_value=False):
            self.assertFalse(
                self.deploy.verify_dns(
                    "certificate", "cert.example.test", {"ipv4": "8.8.8.8"}
                )
            )
        self.assertEqual(
            self.deploy.dns_observation,
            {"dnsState": "mismatch", "dnsRole": "certificate"},
        )
        with patch.object(m, "json_request", return_value={"data": {}}) as request:
            m.Deployment.progress(self.deploy)
        self.assertEqual(
            request.call_args.args[2],
            {"action": "status", "dnsState": "mismatch", "dnsRole": "certificate"},
        )

    def test_unchanged_config_only(self):
        m.write_private(self.deploy.config, {"Nodes": [{"ApiKey": "someone-else"}]})
        before = self.deploy.config.read_bytes()
        with self.assertRaises(m.DeploymentError):
            self.deploy.prepare_config()
        self.assertEqual(before, self.deploy.config.read_bytes())

    def test_private_state_required(self):
        os.chmod(self.path, 0o644)
        with self.assertRaises(m.DeploymentError):
            m.Deployment(self.path)

    def test_report_secret_removed_on_failure(self):
        def fail(args):
            token = Path(args[-1])
            self.assertEqual(token.stat().st_mode & 0o777, 0o600)
            self.assertEqual(token.read_text(), "c" * 64)
            raise m.DeploymentError("failed")

        self.deploy.command = fail
        with self.assertRaises(m.DeploymentError):
            m.Deployment.report(self.deploy)
        self.assertFalse(list(self.path.parent.glob(".report-*")))
        self.assertFalse(self.deploy.state.get("reported"))

    def test_lost_completion_response_resumes_without_restart(self):
        self.deploy.prepare_config()
        self.deploy.save(startAttempted=True)
        self.deploy.wait_dns = lambda: True
        self.deploy.run()
        self.assertNotIn("restart", self.events)
        self.assertFalse(self.path.exists())

    def test_real_certificate_trust_and_name_verification(self):
        root = Path(self.tmp.name)
        ca = root / "ca.pem"
        key = root / "ca.key"
        cert = root / "leaf.pem"
        leafkey = root / "leaf.key"
        csr = root / "leaf.csr"
        ext = root / "extensions"
        ext.write_text(
            "subjectAltName=DNS:node.example.test\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n"
        )
        commands = [
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(key),
                "-out",
                str(ca),
                "-days",
                "2",
                "-subj",
                "/CN=Test CA",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
            ],
            [
                "openssl",
                "req",
                "-new",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(leafkey),
                "-out",
                str(csr),
                "-subj",
                "/CN=node.example.test",
            ],
            [
                "openssl",
                "x509",
                "-req",
                "-in",
                str(csr),
                "-CA",
                str(ca),
                "-CAkey",
                str(key),
                "-CAcreateserial",
                "-out",
                str(cert),
                "-days",
                "1",
                "-extfile",
                str(ext),
            ],
        ]
        for command in commands:
            subprocess.run(
                command,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        self.deploy.flow.update(certificateFile=str(cert), protocol="hysteria2")
        with patch.dict(os.environ, {"SSL_CERT_FILE": str(ca)}):
            m.Deployment.verify_certificate(self.deploy)
            self.deploy.flow["certificateDomain"] = "wrong.example.test"
            with self.assertRaises(m.DeploymentError):
                m.Deployment.verify_certificate(self.deploy)
        self.deploy.flow["certificateDomain"] = "node.example.test"
        with self.assertRaises(m.DeploymentError):
            m.Deployment.verify_certificate(self.deploy)

    def test_progress_retries_transient_failures_only(self):
        with patch.object(
            m, "json_request", side_effect=[OSError(), {"data": {"dnsReady": True}}]
        ) as request, patch.object(m.time, "sleep"):
            self.assertTrue(m.Deployment.progress(self.deploy)["dnsReady"])
            self.assertEqual(request.call_count, 2)
        with patch.object(
            m, "json_request", side_effect=m.DeploymentError("revoked")
        ) as request:
            with self.assertRaises(m.DeploymentError):
                m.Deployment.progress(self.deploy)
            self.assertEqual(request.call_count, 1)

    def test_machine_request_identifies_itself_without_url_secrets(self):
        class Response(io.BytesIO):
            pass

        token = "dp_" + "f" * 64
        with patch.object(m.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = Response(
                b'{"data":{"dnsReady":true}}'
            )
            self.assertTrue(
                m.json_request(
                    "https://panel.example.test/api/v10/server/enrollments/progress",
                    token,
                    {"action": "status"},
                )["data"]["dnsReady"]
            )
            request = build.return_value.open.call_args.args[0]
            self.assertTrue(
                request.get_header("User-agent").startswith("v2box-deployment/")
            )
            self.assertEqual(request.get_header("Authorization"), "Bearer " + token)
            self.assertNotIn(token, request.full_url)
            self.assertEqual(json.loads(request.data), {"action": "status"})
            self.assertIsInstance(build.call_args.args[0], m.NoRedirect)

    def test_browser_signature_block_is_not_revocation(self):
        for body, headers in [
            (
                {
                    "detail": "The site owner has blocked access based on your browser's signature.",
                    "reflected": "dp_" + "f" * 64,
                },
                {"cf-ray": "test-NRT"},
            ),
            ({"error_code": 1010}, {"cf-ray": "test-NRT"}),
            (None, {"cf-mitigated": "challenge", "cf-ray": "invalid\nsecret"}),
        ]:
            stream = io.BytesIO(
                json.dumps(body).encode()
                if body is not None
                else b"<html>challenge</html>"
            )
            error = m.urllib.error.HTTPError(
                "https://panel.example.test", 403, "Forbidden", headers, stream
            )
            with patch.object(m.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                with self.assertRaisesRegex(
                    m.DeploymentError, "Browser protection blocked"
                ) as caught:
                    m.json_request(
                        "https://panel.example.test", body={"action": "status"}
                    )
                self.assertNotIn("dp_", str(caught.exception))
                self.assertNotIn("invalid\nsecret", str(caught.exception))
                self.assertNotIn("Panel rejected", str(caught.exception))
                self.assertTrue(stream.closed)

    def test_application_403_and_other_json_errors_remain_rejected(self):
        for body in [{"code": "FORBIDDEN", "detail": "revoked"}, [], None, "not json"]:
            stream = io.BytesIO(json.dumps(body).encode())
            error = m.urllib.error.HTTPError(
                "https://panel.example.test",
                403,
                "Forbidden",
                {"cf-ray": "test-NRT"},
                stream,
            )
            with patch.object(m.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                with self.assertRaisesRegex(
                    m.DeploymentError, "Deployment request rejected"
                ):
                    m.json_request(
                        "https://panel.example.test", body={"action": "status"}
                    )
                self.assertTrue(stream.closed)

    def prerequisites(
        self,
        uid="0",
        system="Linux",
        manager=None,
        missing=False,
        failure=False,
        partial=False,
    ):
        root = Path(self.tmp.name) / (
            "prerequisites-"
            + str(len(list(Path(self.tmp.name).glob("prerequisites-*"))))
        )
        root.mkdir()
        bin = root / "bin"
        bin.mkdir()
        log = root / "packages.log"

        def executable(name, text):
            path = bin / name
            path.write_text("#!/bin/sh\n" + text + "\n")
            path.chmod(0o700)

        executable("id", 'printf "%s\\n" "$SIM_UID"')
        executable("uname", 'printf "%s\\n" "$SIM_OS"')
        for tool in (
            "curl",
            "bash",
            "jq",
            "unzip",
            "sha256sum",
            "install",
            "python3",
            "openssl",
            "flock",
            "timeout",
        ):
            if not (missing and tool == "bash"):
                executable(tool, "exit 0")
        if manager:
            executable(
                manager,
                'printf "%s\\n" "$*" >> "$SIM_LOG"\n[ "$SIM_FAIL" = 0 ] || exit 19\nif [ "$SIM_PARTIAL" = 0 ]; then printf "#!/bin/sh\\nexit 0\\n" > "$SIM_BIN/bash"; /bin/chmod 700 "$SIM_BIN/bash"; fi',
            )
        env = dict(
            os.environ,
            PATH=str(bin),
            SIM_UID=uid,
            SIM_OS=system,
            SIM_BIN=str(bin),
            SIM_LOG=str(log),
            SIM_FAIL=str(int(failure)),
            SIM_PARTIAL=str(int(partial)),
        )
        result = subprocess.run(
            ["/bin/sh", str(Path(sys.argv[1]).with_name("node-prerequisites.sh"))],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result, log.read_text() if log.exists() else ""

    def test_prerequisites_reject_nonroot_and_nonlinux_before_package_changes(self):
        for args in ({"uid": "1000"}, {"system": "Darwin"}):
            with self.subTest(args=args):
                result, log = self.prerequisites(
                    **args, manager="apt-get", missing=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(log, "")
                self.assertTrue(self.path.exists())

    def test_prerequisites_simulate_all_supported_package_managers(self):
        for manager in ("apt-get", "apk", "dnf", "yum"):
            with self.subTest(manager=manager):
                result, log = self.prerequisites(manager=manager, missing=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("python3", log)

    def test_prerequisites_reject_missing_manager_failed_install_and_partial_install(
        self,
    ):
        for args in (
            {},
            {"manager": "apt-get", "failure": True},
            {"manager": "apk", "partial": True},
        ):
            with self.subTest(args=args):
                result, _ = self.prerequisites(**args, missing=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(self.path.exists())

    def test_prerequisites_skip_package_manager_when_tools_are_present(self):
        result, log = self.prerequisites(manager="apt-get")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, "")

    def test_progress_malformed_data_is_bounded_and_retryable(self):
        for payload in ({"data": None}, {"data": []}, {"data": "gateway"}, {}):
            with self.subTest(payload=payload), patch.object(
                m, "json_request", return_value=payload
            ) as request, patch.object(m.time, "sleep"):
                with self.assertRaises(OSError):
                    m.Deployment.progress(self.deploy)
                self.assertEqual(request.call_count, 3)
        self.assertTrue(self.path.exists())

    def test_disk_full_during_atomic_append_preserves_original_and_can_retry(self):
        self.deploy.prepare_config()
        second = self.second_panel()
        before = self.deploy.config.read_bytes()
        cert = self.path.parent / "operator.pem"
        cert.write_text("existing certificate")
        replace = m.os.replace

        def full(source, destination):
            if Path(destination) == second.config:
                raise OSError(m.errno.ENOSPC, "disk full")
            return replace(source, destination)

        with patch.object(m.os, "replace", side_effect=full):
            with self.assertRaises(OSError):
                second.prepare_config()
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertTrue(second.path.exists())
        self.assertEqual(cert.read_text(), "existing certificate")
        self.assertFalse(list(self.path.parent.glob(".config.json.*")))
        second.prepare_config()
        self.assertEqual(len(json.loads(second.config.read_text())["Nodes"]), 2)

    def test_failed_state_write_never_appends_live_node(self):
        self.deploy.prepare_config()
        second = self.second_panel()
        before = self.deploy.config.read_bytes()
        state = second.path.read_bytes()
        write = m.write_private

        def denied(path, data):
            if path == second.path:
                raise PermissionError("read-only filesystem")
            return write(path, data)

        with patch.object(m, "write_private", side_effect=denied):
            with self.assertRaises(PermissionError):
                second.prepare_config()
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertEqual(second.path.read_bytes(), state)
        m.Deployment(second.path).prepare_config()
        self.assertEqual(len(json.loads(second.config.read_text())["Nodes"]), 2)

    def test_three_panels_same_id_failed_third_keeps_both_existing_panels(self):
        self.deploy.prepare_config()
        second = self.second_panel()
        second.prepare_config()
        before = json.loads(self.deploy.config.read_text())
        second_state = second.path.read_bytes()
        data = json.loads(json.dumps(self.data))
        data.update(apiHost="https://third.example.invalid", apiKey="third-scoped-key")
        third_path = self.path.parent / "deployment-state-third.json"
        m.write_private(third_path, {"data": data})
        third = m.Deployment(third_path)
        third.prepare_config()
        self.assertEqual(len(json.loads(third.config.read_text())["Nodes"]), 3)
        third.command = lambda args: self.events.append(args[-1])
        third.service_state = lambda: "active"
        third.rollback_addition()
        self.assertEqual(json.loads(third.config.read_text()), before)
        self.assertEqual(second.path.read_bytes(), second_state)
        self.assertNotIn("restart", self.events)

    def test_backend_outage_during_readiness_retains_state_without_restarting(self):
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        self.deploy.save(startAttempted=True)
        self.deploy.progress = lambda *args: (_ for _ in ()).throw(
            OSError("backend unavailable")
        )
        with patch.object(
            m.time, "monotonic", side_effect=iter(range(0, 2000, 100))
        ), patch.object(m.time, "sleep"):
            with self.assertRaisesRegex(m.DeploymentError, "readiness timed out"):
                self.deploy.wait_ready()
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertTrue(self.path.exists())
        self.assertNotIn("restart", self.events)
        self.assertNotIn("reload", self.events)

    def test_unmanaged_deployment_never_queries_dns_provider(self):
        self.deploy.flow["accessMode"] = "unmanaged"
        with patch.object(
            m, "dns_matches", side_effect=AssertionError("unexpected DNS lookup")
        ):
            self.assertFalse(m.Deployment.wait_dns(self.deploy))
        self.assertEqual(self.events, [])

    def test_revoked_start_permission_never_appends_another_panel(self):
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        second = self.second_panel()
        second.report = lambda: None
        second.wait_dns = lambda: False
        second.check_http_port = lambda: None
        second.progress = lambda *args: (_ for _ in ()).throw(
            m.DeploymentError("Deployment authorization was revoked")
        )
        second.command = lambda args: self.events.append(args[-1])
        with self.assertRaisesRegex(m.DeploymentError, "revoked"):
            second.run()
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertTrue(second.path.exists())
        self.assertEqual(self.events, [])

    def test_certificate_failure_retains_private_recovery_and_never_completes(self):
        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        self.deploy.save(startAttempted=True)
        self.deploy.verify_certificate = lambda: (_ for _ in ()).throw(
            m.DeploymentError("certificate verification failed")
        )
        with self.assertRaisesRegex(
            m.DeploymentError, "certificate verification failed"
        ):
            self.deploy.wait_ready()
        self.assertTrue(self.path.exists())
        self.assertEqual(self.deploy.config.read_bytes(), before)
        self.assertNotIn("complete", self.events)
        self.assertNotIn("restart", self.events)

    def test_concurrent_deployment_lock_preserves_state_and_configuration(self):
        import fcntl

        self.deploy.prepare_config()
        before = self.deploy.config.read_bytes()
        state = self.path.read_bytes()
        with open(self.path.parent / ".deployment.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run(
                [sys.executable, sys.argv[1], str(self.path)],
                capture_output=True,
                text=True,
                timeout=10,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("Another deployment is already running", result.stderr)
        self.assertNotIn(self.data["apiKey"], result.stderr)
        self.assertEqual(self.path.read_bytes(), state)
        self.assertEqual(self.deploy.config.read_bytes(), before)

    def test_inactive_tls_ignores_leftover_http_certificate_settings(self):
        for tls in (0, 2):
            self.deploy.flow["tls"] = tls
            self.deploy.flow["certificateDomain"] = "stale.example.test"
            with patch.object(
                m.socket,
                "socket",
                side_effect=AssertionError("HTTP port must not be probed"),
            ):
                m.Deployment.check_http_port(self.deploy)
            self.deploy.progress = lambda action="status": {
                "dnsReady": True,
                "addresses": {"ipv4": "8.8.8.8"},
            }
            with patch.object(m, "dns_matches", return_value=True) as dns:
                self.assertFalse(m.Deployment.wait_dns(self.deploy))
                dns.assert_called_once_with("node.example.test", {"ipv4": "8.8.8.8"})

    def test_port_conflict_never_starts_certificate_request(self):
        with patch.object(
            m.socket, "socket", side_effect=OSError(m.errno.EADDRINUSE, "in use")
        ):
            with self.assertRaises(m.DeploymentError):
                m.Deployment.check_http_port(self.deploy)


if __name__ == "__main__":
    unittest.main(argv=["deployment-tests"])
