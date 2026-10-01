import { describe, it, expect } from "vitest";
import type { Field } from "./ui";
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
    nodeSettingsPayload,
} from "./node-settings";
const fields = (...keys: string[]): Field[] =>
    keys.map((key) => ({ key, label: key }));
describe("admin dependency behavior", () => {
    it.each([
        ["email_whitelist_enable", "email_whitelist_suffix"],
        ["recaptcha_enable", "recaptcha_key"],
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
        expect(validateSettings({ recaptcha_enable: 0 })).toBeUndefined();
        expect(validateSettings({ recaptcha_enable: 1 })).toBeTruthy();
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
    it("limits percentage coupons and hides specified codes for batch generation", () => {
        expect(
            resourceFields("coupons", fields("value"), { type: 2 })[0].max,
        ).toBe(100);
        expect(
            resourceFields("coupons", fields("code"), { generate_count: 3 }),
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
