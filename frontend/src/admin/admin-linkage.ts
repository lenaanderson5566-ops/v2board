import { anytlsPresets } from "./anytls-padding";
import nodeLocations from "../../../resources/client/node-locations.json";
import type { Row } from "../shared/api";
import type { Field } from "../shared/ui";
const on = (value: unknown) => Number(value) === 1;
const dependencies: Record<string, (values: Row) => boolean> = {
    email_host: (v) => (!v.email_provider || v.email_provider === "smtp"),
    email_port: (v) => (!v.email_provider || v.email_provider === "smtp"),
    email_encryption: (v) => (!v.email_provider || v.email_provider === "smtp"),
    email_username: (v) => (!v.email_provider || v.email_provider === "smtp"),
    email_password: (v) => (!v.email_provider || v.email_provider === "smtp"),
    email_resend_api_key: (v) => v.email_provider === "resend",
    email_ses_region: (v) => v.email_provider === "ses",
    email_ses_auth: (v) => v.email_provider === "ses",
    email_ses_configuration_set: (v) => v.email_provider === "ses",
    email_ses_access_key: (v) => v.email_provider === "ses" && v.email_ses_auth === "key",
    email_ses_secret_key: (v) => v.email_provider === "ses" && v.email_ses_auth === "key",
    email_mailgun_region: (v) => v.email_provider === "mailgun",
    email_mailgun_domain: (v) => v.email_provider === "mailgun",
    email_mailgun_api_key: (v) => v.email_provider === "mailgun",
    try_out_hour: (v) => Number(v.try_out_plan_id) > 0,
    email_whitelist_suffix: (v) => on(v.email_whitelist_enable),
    register_limit_count: (v) => on(v.register_limit_by_ip_enable),
    register_limit_expire: (v) => on(v.register_limit_by_ip_enable),
    password_limit_count: (v) => on(v.password_limit_enable),
    password_limit_expire: (v) => on(v.password_limit_enable),
    commission_distribution_l1: (v) => on(v.commission_distribution_enable),
    commission_distribution_l2: (v) => on(v.commission_distribution_enable),
    commission_distribution_l3: (v) => on(v.commission_distribution_enable),
    commission_withdraw_limit: (v) => !on(v.withdraw_close_enable),
    commission_withdraw_method: (v) => !on(v.withdraw_close_enable),
    surplus_enable: (v) => on(v.plan_change_enable),
    change_order_event_id: (v) => on(v.plan_change_enable),
    show_subscribe_expire: (v) => Number(v.show_subscribe_method) === 2,
    telegram_bot_token: (v) => on(v.telegram_bot_enable),
};
export function settingsFields(fields: Field[], values: Row): Field[] {
    return fields.filter(
        (f) => {
            if (f.key.startsWith("email_announcement_") && f.key !== "email_announcement_separate") {
                if (!on(values.email_announcement_separate)) return false;
                const base=f.key.replace("email_announcement_","email_");
                const scoped=Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith("email_announcement_")).map(([k,v])=>[k.replace("email_announcement_","email_"),v]));
                return !dependencies[base] || dependencies[base](scoped);
            }
            return !dependencies[f.key] || dependencies[f.key](values);
        },
    );
}
export function changedSettings(body: Row, initial: Row): Row {
    return Object.fromEntries(
        Object.entries(body).filter(
            ([key, value]) =>
                JSON.stringify(value) !== JSON.stringify(initial[key]),
        ),
    );
}
export function linkSettings(key: string, next: unknown, values: Row): Row {
    const result = { ...values, [key]: next };
    if (
        key === "email_encryption" &&
        (!values.email_port ||
            [25, 465, 587].includes(Number(values.email_port)))
    )
        result.email_port = next === "ssl" ? 465 : next === "tls" ? 587 : 25;
    return result;
}
export function validateSettings(values: Row): string | undefined {
    if (
        Number(values.show_subscribe_method) === 2 &&
        (!Number.isInteger(Number(values.show_subscribe_expire)) ||
            Number(values.show_subscribe_expire) < 1)
    )
        return "限时订阅链接有效时间至少为 1 分钟";
    if (on(values.email_whitelist_enable)) {
        let suffixes = values.email_whitelist_suffix;
        if (typeof suffixes === "string") {
            try {
                suffixes = JSON.parse(suffixes);
            } catch {
                return "邮箱白名单必须是有效的 JSON 数组";
            }
        }
        if (!Array.isArray(suffixes) || !suffixes.length)
            return "启用邮箱白名单时至少填写一个邮箱域名";
    }
    if (on(values.commission_distribution_enable)) {
        const total = [
            "commission_distribution_l1",
            "commission_distribution_l2",
            "commission_distribution_l3",
        ].reduce((sum, key) => sum + Number(values[key] || 0), 0);
        if (total > 100) return "三级佣金分配比例合计不能超过 100%";
    }
    if (on(values.telegram_bot_enable) && !values.telegram_bot_token)
        return "启用 Telegram 机器人时必须填写 Token";
    return undefined;
}
export function resourceFields(
    kind: string,
    fields: Field[],
    values: Row,
): Field[] {
    return fields
        .filter((f) => !(kind === "coupons" && values.id && f.key === "generate_count"))
        .filter(
            (f) =>
                kind !== "routes" ||
                ((f.key !== "backend" || !values.id) &&
                    (f.key !== "sing_box" || values.action === "sing_box") &&
                    (!["match", "action_value"].includes(f.key) || values.action !== "sing_box") &&
                    (f.key !== "match" || values.action !== "default_out") &&
                    (f.key !== "action_value" || values.action !== "block")),
        )
        .filter(
            (f) => f.key !== "code" || Number(values.generate_count || 1) <= 1,
        )
        .filter(
            (f) =>
                kind !== "giftcards" ||
                ((f.key !== "plan_id" || Number(values.type) === 5) &&
                    (f.key !== "value" || Number(values.type) !== 4)),
        )
        .map((f) => {
            if (kind === "coupons" && f.key === "type") return { ...f, options: (f.options || []).filter(([key]) => key === "2" || Boolean(values.id)) };
            if (kind === "routes" && f.key === "action") return { ...f, options: (f.options || []).filter(([key]) => key !== "sing_box" || values.backend === "v2box") };
            if (kind === "routes" && f.key === "action_value")
                return {
                    ...f,
                    label:
                        values.action === "dns"
                            ? "DNS 地址"
                            : values.action === "default_out"
                              ? "默认出口参数"
                              : "动作参数",
                    hint: values.backend === "v2box" ? "旧格式兼容规则：路由出口参数使用 sing-box outbound JSON；新规则建议选择 sing-box 原生规则。" : "Xray 路由出口参数使用 Xray outbound JSON；DNS 动作填写 DNS 地址。",
                };
            if (kind === "giftcards" && f.key === "value")
                return {
                    ...f,
                    label:
                        (
                            {
                                1: "金额（CNY）",
                                2: "延长时间（天）",
                                3: "增加流量（GB）",
                                5: "套餐有效期（天）",
                            } as Record<number, string>
                        )[Number(values.type)] || f.label,
                    required: true,
                    min: Number(values.type) === 1 ? 0.01 : 1,
                    step: Number(values.type) === 1 ? 0.01 : 1,
                    scale: Number(values.type) === 1 ? 100 : undefined,
                };
            if (kind === "giftcards" && f.key === "plan_id")
                return { ...f, required: true };
            if (kind === "coupons" && f.key === "value")
                return {
                    ...f,
                    label:
                        Number(values.type) === 2
                            ? "折扣比例（%，例如 20 表示减免 20%）"
                            : "优惠金额（CNY）",
                    min: Number(values.type) === 2 ? 1 : 0.01,
                    max: Number(values.type) === 2 ? 100 : undefined,
                    step: Number(values.type) === 2 ? 1 : 0.01,
                    scale: Number(values.type) === 2 ? undefined : 100,
                };
            if (f.key === "generate_count")
                return { ...f, min: 1, max: 500, step: 1 };
            return f;
        });
}
export function linkResource(
    kind: string,
    plans: Row[],
    key: string,
    next: unknown,
    values: Row,
): Row {
    const result = { ...values, [key]: next };
    if (kind === "routes" && key === "backend") {
        result.action = next === "v2box" ? "sing_box" : "block";
        result.match = [];
        result.action_value = "";
        result.sing_box = { route: { rules: [] } };
    }
    if (
        ["giftcards", "coupons"].includes(kind) &&
        key === "type" &&
        String(values.type) !== String(next)
    )
        result.value = "";
    if (kind === "users" && key === "plan_id" && Number(next) > 0) {
        const plan = plans.find((p) => String(p.id) === String(next));
        if (plan)
            Object.assign(result, {
                transfer_enable: plan.transfer_enable,
                device_limit: plan.device_limit,
                speed_limit: plan.speed_limit,
            });
    }
    return result;
}
export function validateResource(values: Row): string | undefined {
    if (
        values.started_at &&
        values.ended_at &&
        values.ended_at <= values.started_at
    )
        return "结束时间必须晚于开始时间";
    return undefined;
}
const tlsRequired = ["trojan", "tuic", "hysteria2", "anytls", "naive"];
export function linkNode(key: string, next: unknown, values: Row): Row {
    const result = { ...values, [key]: next };
    if (key === "padding_preset") {
        const preset = anytlsPresets.find(p => p.id === next);
        if (preset) result.padding_scheme = preset.scheme;
    }
    if (key === "region_code") {
        const city = String(values.city_code ?? "") as keyof typeof nodeLocations.cityRegions;
        if (next && nodeLocations.cityRegions[city] && nodeLocations.cityRegions[city] !== String(next).toUpperCase())
            result.city_code = "";
    }

    if (key === "setup_family") result.setup_server_id = "";
    if (key === "protocol") {
        result.service_id = "";
        if (tlsRequired.includes(String(next))) result.tls = 1;
        else if (next !== "vless" && Number(values.tls) === 2) result.tls = 1;
        if (
            ["shadowsocks", "tuic", "hysteria2", "anytls", "naive"].includes(
                String(next),
            )
        )
            result.network = "tcp";
        if (values.setup_mode === "managed" && tlsRequired.includes(String(next)) && !values["tls_settings.cert_mode"]) result["tls_settings.cert_mode"] = "http";
        if (next === "shadowsocks") result.tls = 0;
        if (next === "naive") {
            result.disable_sni = 0;
            result.network_settings = {};
            for (const field of Object.keys(result)) {
                if (field.startsWith("network_settings.")) delete result[field];
            }
            result["tls_settings.allow_insecure"] = 0;
            if (!["http", "dns", "file"].includes(String(values["tls_settings.cert_mode"]))) result["tls_settings.cert_mode"] = "http";
        }
        if (next !== "vless") result.flow = "";
    }
    if (key === "version") {
        result.obfs = "";
        result.obfs_password = "";
    }
    return result;
}
export function nodeFields(
    type: string,
    fields: Field[],
    values: Row,
): Field[] {
    const protocol =
        ["v2node", "v2box"].includes(type) ? String(values.protocol || "shadowsocks") : type;
    const tls = Number(values.tls || 0),
        network = values.network || "tcp";
    return fields
        .filter((f) => {
            if (f.key === "sing_box") return false;
            if (type === "v2box" && (
                ["encryption", "encryption_settings", "trusted_x_forwarded_for"].includes(f.key) ||
                f.key.startsWith("encryption_settings.") ||
                f.key.startsWith("tls_settings.ech") ||
                ["tls_settings.xver", "tls_settings.reject_unknown_sni", "tls_settings.mldsa65Seed", "network_settings.acceptProxyProtocol"].includes(f.key)
            )) return false;
            if (protocol === "naive" && ["disable_sni", "tls_settings.allow_insecure", "tls_settings.fingerprint", "tls_settings.pinned_peer_cert_sha256"].includes(f.key)) return false;
            const [root, ...parts] = f.key.split(".");
            const parameter = parts.join(".");
            if (["tls_settings", "tlsSettings"].includes(root) && parameter) {
                if (tls === 0) return false;
                if (
                    [
                        "cert_mode",
                        "provider",
                        "dns_env",
                        "cert_file",
                        "key_file",
                        "pinned_peer_cert_sha256",
                    ].includes(parameter)
                ) {
                    if (!["v2node", "v2box"].includes(type)) return false;
                    if (tls !== 1) return false;
                    const mode = values[root + ".cert_mode"] || "self";
                    if (["provider", "dns_env"].includes(parameter))
                        return mode === "dns";
                    if (parameter === "pinned_peer_cert_sha256")
                        return mode === "remote";
                    if (["cert_file", "key_file"].includes(parameter))
                        return mode !== "none";
                }
                if (
                    [
                        "public_key",
                        "private_key",
                        "short_id",
                        "server_port",
                        "dest",
                        "xver",
                    ].includes(parameter)
                )
                    return tls === 2;
                if (parameter.startsWith("ech"))
                    return (
                        tls === 1 &&
                        (parameter === "ech" ||
                            values[root + ".ech"] === "custom")
                    );
            }
            if (
                ["network_settings", "networkSettings"].includes(root) &&
                parameter
            ) {
                if (
                    ["v2node", "v2box"].includes(type) &&
                    ["shadowsocks", "tuic", "hysteria2", "anytls", "naive"].includes(
                        protocol,
                    )
                )
                    return false;
                if (parameter === "serviceName") return network === "grpc";
                if (parameter === "headers.Host")
                    return ["ws", "http", "httpupgrade"].includes(network);
                if (parameter === "path")
                    return ["ws", "http", "httpupgrade", "xhttp"].includes(
                        network,
                    );
                if (["mode", "host"].includes(parameter))
                    return network === "xhttp";
            }
            if (root === "obfs_settings" && parameter)
                return Boolean(values.obfs);
            if (
                (f.key === "server_name" || parameter === "server_name") &&
                on(values.disable_sni)
            )
                return false;
            if (["tls_settings", "tlsSettings"].includes(f.key)) return tls > 0;
            if (["network_settings", "networkSettings"].includes(f.key))
                return (
                    !["v2node", "v2box"].includes(type) ||
                    !["shadowsocks", "tuic", "hysteria2", "anytls", "naive"].includes(
                        protocol,
                    )
                );
            if (f.key === "flow")
                return (
                    protocol === "vless" &&
                    tls > 0 &&
                    (network === "tcp" ||
                        values.encryption === "mlkem768x25519plus")
                );
            if (f.key === "encryption_settings")
                return (
                    protocol === "vless" &&
                    values.encryption === "mlkem768x25519plus"
                );
            if (["obfs_settings", "obfs_password"].includes(f.key))
                return Boolean(values.obfs);
            if (["v2node", "v2box"].includes(type)) {
                if (["cipher"].includes(f.key))
                    return protocol === "shadowsocks";
                if (
                    ["up_mbps", "down_mbps", "obfs", "obfs_password"].includes(
                        f.key,
                    )
                )
                    return protocol === "hysteria2";
                if (
                    [
                        "udp_relay_mode",
                        "zero_rtt_handshake",
                        "congestion_control",
                    ].includes(f.key)
                )
                    return protocol === "tuic";
                if (f.key === "padding_preset") return protocol === "anytls";
                if (f.key === "padding_scheme") return protocol === "anytls" && (!values.padding_preset || values.padding_preset === "custom");
                if (["encryption", "encryption_settings"].includes(f.key))
                    return protocol === "vless";
            }
            return true;
        })
        .map((f) => {
            if (f.key === "protocol" && values.protocol === "") return { ...f, options: [["", "请选择目标内核支持的协议"], ...(f.options || [])] as [string, string][] };
            if (protocol === "naive" && f.key === "tls_settings.cert_mode") return { ...f, required: true, options: [["http", "HTTP 申请"], ["dns", "DNS 申请"], ["file", "已有证书文件"]] as [string, string][], hint: "Naive 需要客户端信任的有效证书。" };
            if (protocol === "naive" && f.key === "tls_settings.server_name") return { ...f, required: true };
            if (f.key === "tls_settings.server_name" && tls === 2)
                return {
                    ...f,
                    required: true,
                    hint: "Reality 必须与服务端 SNI 一致。",
                };
            if (
                f.key === "tls_settings.ech_server_name" &&
                values["tls_settings.ech"] === "custom"
            )
                return { ...f, required: true };
            if (f.key === "tls")
                return {
                    ...f,
                    type: "select",
                    options: tlsRequired.includes(protocol)
                        ? [["1", "TLS（此协议必需）"]]
                        : protocol === "vless"
                          ? [
                                ["0", "关闭"],
                                ["1", "TLS"],
                                ["2", "Reality"],
                            ]
                          : [
                                ["0", "关闭"],
                                ["1", "TLS"],
                            ],
                };
            if (f.key === "flow")
                return {
                    ...f,
                    type: "select",
                    nullable: true,
                    options: [
                        ["", "不设置"],
                        ["xtls-rprx-vision", "XTLS Vision"],
                    ],
                };
            if (f.key === "show") return { ...f, type: "switch" };
            if (f.key === "encryption")
                return {
                    ...f,
                    type: "select",
                    nullable: true,
                    options: [
                        ["", "不启用"],
                        ["mlkem768x25519plus", "MLKEM768X25519PLUS"],
                    ],
                };
            if (f.key === "udp_relay_mode")
                return {
                    ...f,
                    type: "select",
                    options: [
                        ["native", "native"],
                        ["quic", "quic"],
                    ],
                };
            if (f.key === "congestion_control")
                return {
                    ...f,
                    type: "select",
                    options: ["cubic", "new_reno", "bbr"].map((v) => [v, v]),
                };
            if (
                f.key === "obfs" &&
                (type === "hysteria" || protocol === "hysteria2")
            )
                return {
                    ...f,
                    type: "select",
                    nullable: true,
                    options: [
                        ["", "关闭"],
                        [
                            type === "hysteria" &&
                            Number(values.version || 1) === 1
                                ? "xplus"
                                : "salamander",
                            type === "hysteria" &&
                            Number(values.version || 1) === 1
                                ? "xplus"
                                : "salamander",
                        ],
                    ],
                };
            if (f.key === "padding_preset") return { ...f, hint: anytlsPresets.find(p => p.id === values.padding_preset)?.hint || "按 AnyTLS 原生格式填写；填充不保证规避流量识别。" };
            if (f.key === "padding_scheme")
                return {
                    ...f,
                    type: "json",
                    hint: 'JSON 数组，例如 ["stop=8", "0=30-30"]。留空使用服务端默认值。',
                };
            if (["rate", "up_mbps", "down_mbps"].includes(f.key))
                return { ...f, type: "number", min: 0 };
            if (f.key === "server_port")
                return { ...f, type: "number", min: 1, max: 65535, step: 1 };
            if (f.key === "cipher" && ["v2node", "v2box"].includes(type))
                return {
                    ...f,
                    type: "select",
                    required: true,
                    options: [
                        "aes-128-gcm",
                        "aes-192-gcm",
                        "aes-256-gcm",
                        "chacha20-ietf-poly1305",
                        "2022-blake3-aes-128-gcm",
                        "2022-blake3-aes-256-gcm",
                    ].map((v) => [v, v]),
                };
            if (f.key === "obfs" && type === "shadowsocks")
                return {
                    ...f,
                    type: "select",
                    nullable: true,
                    options: [
                        ["", "不启用"],
                        ["http", "HTTP"],
                    ],
                };
            if (
                f.key === "network" &&
                (!f.options?.length || ["v2node", "v2box"].includes(type))
            )
                return {
                    ...f,
                    type: "select",
                    options: (["v2node", "v2box"].includes(type) &&
                    ["shadowsocks", "tuic", "hysteria2", "anytls", "naive"].includes(
                        protocol,
                    )
                        ? ["tcp"]
                        : type === "v2box" ? ["tcp", "ws", "grpc", "httpupgrade"] : ["tcp", "ws", "grpc", "http", "httpupgrade", "xhttp"]
                    ).map((v) => [v, v]).concat(values.network === "" ? [["", "请选择目标内核支持的传输"]] : []) as [string, string][],
                };
            if (["disable_sni", "zero_rtt_handshake"].includes(f.key))
                return { ...f, type: "switch" };
            if (["tls_settings", "tlsSettings"].includes(f.key))
                return {
                    ...f,
                    hint:
                        tls === 2
                            ? "Reality 参数；留空的密钥由服务端生成。"
                            : "TLS 参数；仅在启用 TLS 时生效。",
                };
            if (["network_settings", "networkSettings"].includes(f.key))
                return {
                    ...f,
                    hint: `当前传输：${network}。参数须与所选传输方式一致。`,
                };
            return f;
        });
}
