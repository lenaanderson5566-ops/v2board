import { certificateCredentialOptions } from "./node-setup";
import { describe, it, expect, vi } from "vitest";
import type { Field } from "../shared/ui";
import {
    settingsFields,
    changedSettings,
    linkSettings,
    validateSettings,
    resourceFields,
    linkResource,
    validateResource,
    nodeFields,
    linkNode,
} from "./admin-linkage";
import {
    nodeSettingsFields,
    nodeSettingsInitial,
    nodeBackendInitial,
    nodeSettingsPayload,
} from "./node-settings";
const fields = (...keys: string[]): Field[] =>
    keys.map((key) => ({ key, label: key }));
describe("admin dependency behavior", () => {
    it.each([
        ["email_whitelist_enable", "email_whitelist_suffix"],
        ["register_limit_by_ip_enable", "register_limit_count"],
        ["password_limit_enable", "password_limit_expire"],
        ["commission_distribution_enable", "commission_distribution_l2"],
        ["telegram_bot_enable", "telegram_bot_token"],
        ["plan_change_enable", "surplus_enable"],
    ])("%s controls %s without changing the stored value", (toggle, child) => {
        const original = { [toggle]: 0, [child]: "preserved" };
        expect(
            settingsFields(fields(toggle, child), original).map((f) => f.key),
        ).toEqual([toggle]);
        expect(
            settingsFields(fields(toggle, child), {
                ...original,
                [toggle]: 1,
            }).map((f) => f.key),
        ).toContain(child);
        expect(original[child]).toBe("preserved");
    });
    it("shows interval only for timed tokens and trial duration only for an assigned plan", () => {
        expect(
            settingsFields(fields("show_subscribe_expire", "try_out_hour"), {
                show_subscribe_method: 1,
                try_out_plan_id: 0,
            }),
        ).toEqual([]);
        expect(
            settingsFields(fields("show_subscribe_expire", "try_out_hour"), {
                show_subscribe_method: 2,
                try_out_plan_id: 7,
            }),
        ).toHaveLength(2);
    });
    it("sends a partial configuration update, preserving unrelated invalid legacy fields", () => {
        expect(
            changedSettings(
                {
                    secure_path: "admin",
                    password_limit_enable: 1,
                    password_limit_count: 6,
                },
                {
                    secure_path: "admin",
                    password_limit_enable: 1,
                    password_limit_count: 5,
                },
            ),
        ).toEqual({ password_limit_count: 6 });
    });
    it("suggests standard SMTP ports and preserves custom ports", () => {
        expect(
            linkSettings("email_encryption", "ssl", { email_port: 25 })
                .email_port,
        ).toBe(465);
        expect(
            linkSettings("email_encryption", "tls", { email_port: 465 })
                .email_port,
        ).toBe(587);
        expect(
            linkSettings("email_encryption", "tls", { email_port: 2525 })
                .email_port,
        ).toBe(2525);
    });
    it("validates dependencies only when enabled", () => {
        expect(validateSettings({ passkey_enable: 0 })).toBeUndefined();
        expect(validateSettings({ passkey_enable: 1 })).toBeUndefined();
        expect(
            validateSettings({
                email_whitelist_enable: 1,
                email_whitelist_suffix: "[]",
            }),
        ).toBeTruthy();
        expect(
            validateSettings({
                commission_distribution_enable: 1,
                commission_distribution_l1: 80,
                commission_distribution_l2: 30,
            }),
        ).toBeTruthy();
    });
    it("changes gift-card units and required fields with type", () => {
        const list = fields("type", "value", "plan_id");
        expect(
            resourceFields("giftcards", list, { type: 4 }).map((f) => f.key),
        ).toEqual(["type"]);
        expect(
            resourceFields("giftcards", list, { type: 2 }).find(
                (f) => f.key === "value",
            )?.label,
        ).toContain("天");
        expect(
            resourceFields("giftcards", list, { type: 5 }).find(
                (f) => f.key === "plan_id",
            )?.required,
        ).toBe(true);
    });
    it("limits percentage coupons and hides gift-card codes for batch generation", () => {
        expect(
            resourceFields("coupons", fields("value"), { type: 2 })[0].max,
        ).toBe(100);
        expect(
            resourceFields("giftcards", fields("code"), { generate_count: 3 }),
        ).toEqual([]);
    });
    it("loads assigned plan limits without touching balances or expiration", () => {
        expect(
            linkResource(
                "users",
                [
                    {
                        id: 3,
                        transfer_enable: 200,
                        device_limit: 5,
                        speed_limit: 100,
                    },
                ],
                "plan_id",
                "3",
                { balance: 123, expired_at: "2030-01-01" },
            ),
        ).toEqual({
            plan_id: "3",
            transfer_enable: 200,
            device_limit: 5,
            speed_limit: 100,
            balance: 123,
            expired_at: "2030-01-01",
        });
    });
    it("rejects reversed validity periods", () =>
        expect(
            validateResource({
                started_at: "2026-10-10",
                ended_at: "2026-10-01",
            }),
        ).toBeTruthy());
    it("hides match conditions for the default outbound action and unused block arguments", () => {
        expect(
            resourceFields(
                "routes",
                fields("match", "action", "action_value"),
                { action: "default_out" },
            ).map((f) => f.key),
        ).toEqual(["action", "action_value"]);
        expect(
            resourceFields(
                "routes",
                fields("match", "action", "action_value"),
                { action: "block" },
            ).map((f) => f.key),
        ).toEqual(["match", "action"]);
    });
    it("enforces protocol-required TLS and transport choices", () => {
        expect(
            linkNode("protocol", "tuic", {
                tls: 0,
                network: "ws",
                flow: "xtls-rprx-vision",
            }),
        ).toMatchObject({ tls: 1, network: "tcp", flow: "" });
        expect(
            nodeFields("v2node", fields("tls", "network", "flow", "cipher"), {
                protocol: "tuic",
                tls: 1,
            }).map((f) => f.key),
        ).toEqual(["tls", "network"]);
    });
    it("changes structured TLS and transport fields with mode", () => {
        const list = nodeSettingsFields(
            fields("tls_settings", "network_settings"),
        );
        const keys = nodeFields("vless", list, { tls: 2, network: "grpc" }).map(
            (f) => f.key,
        );
        expect(keys).toContain("tls_settings.public_key");
        expect(keys).not.toContain("tls_settings.ech");
        expect(keys).toContain("network_settings.serviceName");
        expect(keys).not.toContain("network_settings.path");
        expect(
            nodeFields("vless", list, { tls: 0, network: "ws" }).map(
                (f) => f.key,
            ),
        ).not.toContain("tls_settings.server_name");
    });
    it("round-trips existing advanced parameters and serializes visible structured fields", () => {
        const initial = {
            tls_settings: {
                server_name: "old.example",
                unknown: { keep: true },
            },
            network_settings: {
                headers: { Host: "old.example", "User-Agent": "custom" },
                path: "/old",
            },
        };
        const form = nodeSettingsInitial(initial);
        expect(form.network_settings.headers.Host).toBeUndefined();
        const result = nodeSettingsPayload({
            ...form,
            "tls_settings.server_name": "new.example",
            "network_settings.path": "/new",
        });
        expect(result.tls_settings).toEqual({
            server_name: "new.example",
            unknown: { keep: true },
        });
        expect(result.network_settings.headers).toEqual({
            Host: "old.example",
            "User-Agent": "custom",
        });
        expect(result.network_settings.path).toBe("/new");
        expect(initial.tls_settings.server_name).toBe("old.example");
        expect(
            Object.keys(result).some((key) => key.startsWith("tls_settings.")),
        ).toBe(false);
    });
});

it("offers V2Box alongside V2Node with compatible transports", () => {
    const list = fields("protocol", "network", "encryption", "trusted_x_forwarded_for", "tls");
    const box = nodeFields("v2box", list, { protocol: "vless", tls: 2 });
    expect(box.find(f => f.key === "network")?.options?.map(o => o[0])).toEqual(["tcp", "ws", "grpc", "httpupgrade"]);
    expect(box.some(f => f.key === "encryption")).toBe(false);
    expect(box.some(f => f.key === "trusted_x_forwarded_for")).toBe(false);
    expect(nodeFields("v2node", list, { protocol: "vless" }).find(f => f.key === "network")?.options?.map(o => o[0])).toContain("xhttp");
    expect(nodeFields("v2box", list, { protocol: "hysteria2" }).find(f => f.key === "network")?.options?.map(o => o[0])).toEqual(["tcp"]);
});

it("links Naive to HTTPS/HTTP2 and trusted certificate modes", () => {
    const values = linkNode("protocol", "naive", { tls: 2, network: "ws", network_settings: { maxEarlyData: 2048 }, "network_settings.path": "/old-ws", disable_sni: 1, "tls_settings.cert_mode": "remote", "tls_settings.allow_insecure": 1 });
    expect(values).toMatchObject({ tls: 1, network: "tcp", disable_sni: 0, "tls_settings.cert_mode": "http", "tls_settings.allow_insecure": 0 });
    expect(nodeSettingsPayload(values).network_settings).toEqual({});
    const list = nodeFields("v2box", fields("network", "tls", "tls_settings.cert_mode", "tls_settings.server_name", "tls_settings.fingerprint", "tls_settings.allow_insecure", "disable_sni", "network_settings.path"), values);
    expect(list.find(f => f.key === "network")?.options).toEqual([["tcp", "tcp"]]);
    expect(list.find(f => f.key === "tls")?.options?.map(o => o[0])).toEqual(["1"]);
    expect(list.find(f => f.key === "tls_settings.cert_mode")?.options?.map(o => o[0])).toEqual(["http", "dns", "file"]);
    expect(list.find(f => f.key === "tls_settings.server_name")?.required).toBe(true);
    expect(list.some(f => ["tls_settings.fingerprint", "tls_settings.allow_insecure", "disable_sni", "network_settings.path"].includes(f.key))).toBe(false);
});

it("edits persisted node settings without secure-context structuredClone", () => {
    vi.stubGlobal("structuredClone", undefined);
    try {
        const initial = { id: 42, tls_settings: { server_name: "node.example", extra: { enabled: true } }, network_settings: { headers: { Host: "ws.example" } } };
        const before = JSON.stringify(initial);
        const form = nodeSettingsInitial(initial);
        form["tls_settings.server_name"] = "edited.example";
        const saved = nodeSettingsPayload(form);
        expect(saved.tls_settings.server_name).toBe("edited.example");
        expect(saved.network_settings.headers.Host).toBe("ws.example");
        expect(JSON.stringify(initial)).toBe(before);
    } finally { vi.unstubAllGlobals(); }
});
it("selects routes on nodes and edits native rules only in route management", () => {
    expect(nodeFields("v2box", fields("sing_box", "route_id"), { protocol: "vless" }).map(f => f.key)).toEqual(["route_id"]);
    const list = resourceFields("routes", fields("backend", "match", "action_value", "sing_box"), { id: 1, backend: "v2box", action: "sing_box" });
    expect(list.map(f => f.key)).toEqual(["sing_box"]);
    expect(linkResource("routes", [], "backend", "v2box", {}).action).toBe("sing_box");
});

it("clears backend-scoped settings and requires a compatible protocol on conversion", () => {
    const source = { id: 7, type: "v2node", protocol: "vless", route_id: [1], service_id: 3, network: "xhttp", encryption: "mlkem768x25519plus", tls_settings: { server_name: "keep.example", ech: "custom", ech_key: "key" } };
    const target = nodeBackendInitial(source, "v2box");
    expect(target).toMatchObject({ route_id: [], service_id: null, network: "", tls_settings: { server_name: "keep.example" } });
    expect(target.encryption).toBeUndefined();
    expect(target.tls_settings.ech).toBeUndefined();
    expect(source.route_id).toEqual([1]);
    expect(nodeBackendInitial({ id: 8, type: "v2box", protocol: "naive" }, "v2node").protocol).toBe("");
});

it("allows editing coupon terms without batch generation and restricts new templates to percentage", () => {
    const schema = [...fields("generate_count", "name", "value"), { key: "type", label: "type", options: [["1", "fixed"], ["2", "percentage"]] } as any];
    const edit = resourceFields("coupons", schema, { id: 9, type: 2 });
    expect(edit.map(f => f.key)).not.toContain("generate_count");
    expect(edit.map(f => f.key)).toContain("value");
    expect(resourceFields("coupons", schema, { type: 2 }).find(f => f.key === "type")?.options).toEqual([["2", "percentage"]]);
});

it("applies native protocol defaults and clears incompatible server reuse",()=>{
    expect(linkNode("protocol","anytls",{setup_mode:"managed",tls:0,network:"ws"})).toMatchObject({tls:1,network:"tcp","tls_settings.cert_mode":"http"});
    expect(linkNode("protocol","shadowsocks",{tls:1,network:"ws"})).toMatchObject({tls:0,network:"tcp"});
    expect(linkNode("setup_family","ipv6",{setup_server_id:5})).toMatchObject({setup_server_id:"",setup_family:"ipv6"});
});

it("defaults new relay TLS to DNS validation and clears origin reuse when ingress changes",()=>{
    expect(linkNode("setup_access_mode","relay",{"tls_settings.cert_mode":"http"})["tls_settings.cert_mode"]).toBe("dns");
    expect(linkNode("setup_access_mode","relay",{"tls_settings.cert_mode":"file"})["tls_settings.cert_mode"]).toBe("file");
    expect(linkNode("setup_entry_id","5",{setup_server_id:"3"}).setup_server_id).toBe("");
});

it("uses a saved DNS credential without exposing manual environment fields",()=>{
 const source=fields("tls_settings.cert_mode","tls_settings.dns_credential_id","tls_settings.provider","tls_settings.dns_env");
 const selected=nodeFields("v2box",source,{protocol:"anytls",tls:1,"tls_settings.cert_mode":"dns","tls_settings.dns_credential_id":"7"});
 expect(selected.map(f=>f.key)).toContain("tls_settings.dns_credential_id");
 expect(selected.map(f=>f.key)).not.toContain("tls_settings.dns_env");
 expect(selected.map(f=>f.key)).not.toContain("tls_settings.provider");
 expect(linkNode("tls_settings.cert_mode","http",{"tls_settings.dns_credential_id":"7"})["tls_settings.dns_credential_id"]).toBe("");
});

import {nodeConfigurationProblems} from "./node-guidance";
it("round trips saved certificate references and does not require hidden manual credentials",()=>{
 const original={tls:1,protocol:"anytls",network:"tcp",tls_settings:{cert_mode:"dns",server_name:"entry.example.test",dns_credential_id:7}};
 const form=nodeSettingsInitial(original);
 expect(form["tls_settings.dns_credential_id"]).toBe(7);
 expect(nodeSettingsPayload(form).tls_settings).toEqual(original.tls_settings);
 expect(nodeConfigurationProblems(form,"v2box").filter(p=>["tls_settings.provider","tls_settings.dns_env"].includes(p.key))).toEqual([]);
});

it("matches certificate credentials to the ingress identity, not origin, and retains invalid references", () => {
 const network={credentials:[{id:1,name:"入口",root_domain:"example.com",next_run:0},{id:2,name:"回源",root_domain:"origin.net",next_run:0},{id:3,name:"暂停",root_domain:"example.com",next_run:-1}],assignments:[{id:9,purpose:"entry",domain:"hk.example.com"}]};
 const values={setup_mode:"managed",setup_access_mode:"relay",setup_entry_id:9,setup_credential_id:2};
 expect(certificateCredentialOptions(values,network).map(x=>x[0])).toEqual(["","1"]);
 expect(certificateCredentialOptions({...values,"tls_settings.dns_credential_id":2},network).at(-1)).toEqual(["2","当前凭据不匹配或不可用，请重新选择"]);
 expect(certificateCredentialOptions({"tls_settings.server_name":"badexample.com"},network)).toHaveLength(1);
 expect(certificateCredentialOptions({...values,setup_access_mode:"direct"},network).map(x=>x[0])).toEqual(["","2"]);
});
