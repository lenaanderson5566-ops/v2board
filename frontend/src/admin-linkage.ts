import type { Row } from "./api";
import type { Field } from "./ui";
const on = (value: unknown) => Number(value) === 1;
const dependencies: Record<string, (values: Row) => boolean> = {
    try_out_hour: (v) => Number(v.try_out_plan_id) > 0,
    email_whitelist_suffix: (v) => on(v.email_whitelist_enable),
    recaptcha_key: (v) => on(v.recaptcha_enable),
    recaptcha_site_key: (v) => on(v.recaptcha_enable),
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
        (f) => !dependencies[f.key] || dependencies[f.key](values),
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
        on(values.recaptcha_enable) &&
        (!values.recaptcha_key || !values.recaptcha_site_key)
    )
        return "启用 reCAPTCHA 时必须填写站点密钥和服务端密钥";
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
        .filter(
            (f) =>
                kind !== "routes" ||
                ((f.key !== "match" || values.action !== "default_out") &&
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
            if (kind === "routes" && f.key === "action_value")
                return {
                    ...f,
                    label:
                        values.action === "dns"
                            ? "DNS 地址"
                            : values.action === "default_out"
                              ? "默认出口参数"
                              : "动作参数",
                    hint: "参数须与所选动作一致。",
                };
            if (kind === "giftcards" && f.key === "value")
                return {
                    ...f,
                    label:
                        (
                            {
                                1: "金额（分）",
                                2: "延长时间（天）",
                                3: "增加流量（GB）",
                                5: "套餐有效期（天）",
                            } as Record<number, string>
                        )[Number(values.type)] || f.label,
                    required: true,
                    min: 1,
                    step: 1,
                };
            if (kind === "giftcards" && f.key === "plan_id")
                return { ...f, required: true };
            if (kind === "coupons" && f.key === "value")
                return {
                    ...f,
                    label:
                        Number(values.type) === 2
                            ? "折扣比例（%，例如 20 表示减免 20%）"
                            : "优惠金额（分）",
                    min: 1,
                    max: Number(values.type) === 2 ? 100 : undefined,
                    step: 1,
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
        new Date(values.ended_at).getTime() <=
            new Date(values.started_at).getTime()
    )
        return "结束时间必须晚于开始时间";
    return undefined;
}
const tlsRequired = ["trojan", "tuic", "hysteria2", "anytls"];
export function linkNode(key: string, next: unknown, values: Row): Row {
    const result = { ...values, [key]: next };
    if (key === "protocol") {
        result.parent_id = "";
        if (tlsRequired.includes(String(next))) result.tls = 1;
        if (["shadowsocks", "tuic", "hysteria2"].includes(String(next)))
            result.network = "tcp";
        if (next !== "vless") result.flow = "";
    }
    return result;
}
export function nodeFields(
    type: string,
    fields: Field[],
    values: Row,
): Field[] {
    const protocol =
        type === "v2node" ? String(values.protocol || "shadowsocks") : type;
    const tls = Number(values.tls || 0),
        network = values.network || "tcp";
    return fields
        .filter((f) => {
            const [root, ...parts] = f.key.split(".");
            const parameter = parts.join(".");
            if (["tls_settings", "tlsSettings"].includes(root) && parameter) {
                if (tls === 0) return false;
                if (
                    [
                        "public_key",
                        "private_key",
                        "short_id",
                        "server_port",
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
            if (["tls_settings", "tlsSettings"].includes(f.key)) return tls > 0;
            if (["network_settings", "networkSettings"].includes(f.key))
                return (
                    type !== "v2node" ||
                    !["shadowsocks", "tuic", "hysteria2", "anytls"].includes(
                        protocol,
                    )
                );
            if (f.key === "flow") return protocol === "vless" && tls > 0;
            if (["obfs_settings", "obfs_password"].includes(f.key))
                return Boolean(values.obfs);
            if (type === "v2node") {
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
                if (f.key === "padding_scheme") return protocol === "anytls";
                if (["encryption", "encryption_settings"].includes(f.key))
                    return protocol === "vless";
            }
            return true;
        })
        .map((f) => {
            if (f.key === "tls")
                return {
                    ...f,
                    type: "select",
                    options: tlsRequired.includes(protocol)
                        ? [["1", "TLS（此协议必需）"]]
                        : type === "vless" || type === "v2node"
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
            if (f.key === "cipher" && type === "v2node")
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
                (!f.options?.length || type === "v2node")
            )
                return {
                    ...f,
                    type: "select",
                    options: (type === "v2node" &&
                    ["shadowsocks", "tuic", "hysteria2"].includes(protocol)
                        ? ["tcp"]
                        : ["tcp", "ws", "grpc", "http", "httpupgrade", "xhttp"]
                    ).map((v) => [v, v]),
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
