import { describe, it, expect } from "vitest";
import { configField } from "./admin-fields";
import { nodeFields, linkNode, validateSettings } from "./admin-linkage";
import { nodeSettingsFields } from "./node-settings";
import type { Field } from "./ui";
const fields = (...keys: string[]): Field[] =>
    keys.map((key) => ({ key, label: key }));
describe("critical configuration regression", () => {
    it("describes consumable tokens and disallows zero time intervals", () => {
        expect(
            configField("show_subscribe_method", 1, "in:0,1,2", "Mode")
                .options?.[1][1],
        ).toContain("一次性");
        expect(
            validateSettings({
                show_subscribe_method: 2,
                show_subscribe_expire: 0,
            }),
        ).toBeTruthy();
        expect(
            validateSettings({
                show_subscribe_method: 2,
                show_subscribe_expire: 5,
            }),
        ).toBeUndefined();
        expect(configField("email_port", null, "", "Port")).toMatchObject({
            type: "number",
            min: 1,
            max: 65535,
            step: 1,
        });
    });
    it("restores Hysteria obfuscation per version and clears incompatible values", () => {
        expect(
            nodeFields("hysteria", fields("obfs"), { version: 1 })[0]
                .options?.[1][0],
        ).toBe("xplus");
        expect(
            nodeFields("hysteria", fields("obfs"), { version: 2 })[0]
                .options?.[1][0],
        ).toBe("salamander");
        expect(
            linkNode("version", 2, { obfs: "xplus", obfs_password: "old" }),
        ).toMatchObject({ obfs: "", obfs_password: "" });
    });
    it("limits Reality to VLESS and restores TUIC options", () => {
        expect(linkNode("protocol", "vmess", { tls: 2 })).toMatchObject({
            tls: 1,
        });
        expect(
            nodeFields("v2node", fields("tls"), {
                protocol: "vmess",
            })[0].options?.map((o) => o[0]),
        ).toEqual(["0", "1"]);
        const tuic = nodeFields(
            "tuic",
            fields("congestion_control", "udp_relay_mode"),
            {},
        );
        expect(tuic[0].options?.map((o) => o[0])).toEqual([
            "cubic",
            "new_reno",
            "bbr",
        ]);
        expect(tuic[1].options?.map((o) => o[0])).toEqual(["native", "quic"]);
    });
    it("shows certificate provider only for DNS mode and excludes it from Reality", () => {
        const list = nodeSettingsFields(fields("tls_settings"));
        const keys = (values: Record<string, unknown>) =>
            nodeFields("v2node", list, { protocol: "vless", ...values }).map(
                (f) => f.key,
            );
        expect(keys({ tls: 1, "tls_settings.cert_mode": "dns" })).toContain(
            "tls_settings.provider",
        );
        expect(
            keys({ tls: 1, "tls_settings.cert_mode": "http" }),
        ).not.toContain("tls_settings.provider");
        expect(keys({ tls: 2 })).not.toContain("tls_settings.cert_mode");
        expect(keys({ tls: 2 })).toContain("tls_settings.dest");
    });
    it("shows XHTTP parameters and JSON padding input and hides inactive flow", () => {
        const vmess = nodeFields(
            "vmess",
            nodeSettingsFields(fields("networkSettings")),
            { network: "xhttp" },
        ).map((f) => f.key);
        expect(vmess).toContain("networkSettings.mode");
        expect(vmess).toContain("networkSettings.security");
        expect(nodeFields("anytls", fields("padding_scheme"), {})[0].type).toBe(
            "json",
        );
        expect(
            nodeFields("vless", fields("flow"), { tls: 1, network: "ws" }),
        ).toEqual([]);
    });
});
