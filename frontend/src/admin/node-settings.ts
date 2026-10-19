import {
    anytlsPresets,
    paddingPreset,
    applyPaddingPreset,
} from "./anytls-padding";
import type { Row } from "../shared/api";
import type { Field } from "../shared/ui";
const nested: Record<string, Field[]> = {
    tls_settings: [
        {
            key: "cert_mode",
            label: "证书模式",
            type: "select",
            options: [
                ["self", "自签名"],
                ["http", "HTTP 申请"],
                ["dns", "DNS 申请"],
                ["remote", "面板生成并下发"],
                ["none", "不使用证书"],
            ],
        },
        { key: "provider", label: "DNS 提供商", hint: "例如 cloudflare。" },
        {
            key: "dns_env",
            label: "DNS 环境参数",
            type: "password",
            hint: "例如 CF_DNS_API_TOKEN=xxx；多条用逗号分隔。",
        },
        {
            key: "cert_file",
            label: "证书文件路径",
            hint: "留空使用服务端默认路径。",
        },
        {
            key: "key_file",
            label: "证书私钥文件路径",
            hint: "留空使用服务端默认路径。",
        },
        {
            key: "pinned_peer_cert_sha256",
            label: "证书 SHA256 指纹（留空自动生成）",
        },
        { key: "server_name", label: "TLS 服务器名称（SNI）" },
        { key: "allow_insecure", label: "跳过证书校验", type: "switch" },
        {
            key: "fingerprint",
            label: "客户端指纹",
            type: "select",
            options: [
                ["chrome", "Chrome"],
                ["firefox", "Firefox"],
                ["safari", "Safari"],
                ["random", "随机"],
            ],
        },
        { key: "public_key", label: "Reality 公钥（留空自动生成）" },
        {
            key: "private_key",
            label: "Reality 私钥（留空自动生成）",
            type: "password",
        },
        { key: "short_id", label: "Reality Short ID（留空自动生成）" },
        { key: "dest", label: "Reality 目标地址" },
        {
            key: "xver",
            label: "Reality Proxy Protocol 版本",
            type: "select",
            options: [
                ["0", "关闭"],
                ["1", "v1"],
                ["2", "v2"],
            ],
        },
        {
            key: "server_port",
            label: "Reality 目标端口",
            type: "number",
            min: 1,
            max: 65535,
            step: 1,
        },
        {
            key: "ech",
            label: "ECH 模式",
            type: "select",
            options: [
                ["", "关闭"],
                ["cloudflare", "Cloudflare"],
                ["custom", "自定义"],
            ],
        },
        { key: "ech_server_name", label: "ECH 外层服务器名称" },
        { key: "ech_key", label: "ECH 密钥（留空自动生成）", type: "password" },
        { key: "ech_config", label: "ECH 配置（留空自动生成）" },
    ],
    tlsSettings: [
        { key: "serverName", label: "TLS 服务器名称（SNI）" },
        { key: "allowInsecure", label: "跳过证书校验", type: "switch" },
        { key: "fingerprint", label: "客户端指纹" },
    ],
    network_settings: [
        {
            key: "acceptProxyProtocol",
            label: "接收 Proxy Protocol",
            type: "switch",
        },
        { key: "path", label: "传输路径" },
        { key: "headers.Host", label: "传输 Host" },
        { key: "serviceName", label: "gRPC 服务名称" },
        { key: "host", label: "XHTTP Host" },
        {
            key: "mode",
            label: "XHTTP 模式",
            type: "select",
            options: [
                ["auto", "自动"],
                ["packet-up", "packet-up"],
                ["stream-up", "stream-up"],
                ["stream-one", "stream-one"],
            ],
        },
    ],
    networkSettings: [
        {
            key: "security",
            label: "VMess 加密方式",
            type: "select",
            options: ["auto", "aes-128-gcm", "chacha20-poly1305", "none"].map(
                (v) => [v, v],
            ),
        },
        { key: "path", label: "传输路径" },
        { key: "headers.Host", label: "传输 Host" },
        { key: "serviceName", label: "gRPC 服务名称" },
        { key: "host", label: "XHTTP Host" },
        {
            key: "mode",
            label: "XHTTP 模式",
            type: "select",
            options: ["auto", "packet-up", "stream-up", "stream-one"].map(
                (v) => [v, v],
            ),
        },
    ],
    obfs_settings: [
        { key: "host", label: "混淆 Host" },
        { key: "path", label: "混淆路径" },
    ],
};
const object = (value: unknown): Row =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (JSON.parse(JSON.stringify(value)) as Row)
        : {};
function get(source: Row, path: string): unknown {
    return path
        .split(".")
        .reduce((result, key) => result?.[key], source as any);
}
function remove(source: Row, path: string) {
    const keys = path.split(".");
    const leaf = keys.pop()!;
    const parent = keys.reduce((result, key) => result?.[key], source);
    if (parent) delete parent[leaf];
}
function put(source: Row, path: string, value: unknown) {
    const keys = path.split(".");
    const leaf = keys.pop()!;
    let parent = source;
    for (const key of keys) {
        parent[key] = object(parent[key]);
        parent = parent[key];
    }
    parent[leaf] = value;
}
export function nodeSettingsFields(fields: Field[]): Field[] {
    return fields.flatMap((field) =>
        field.key === "padding_scheme"
            ? [
                  {
                      key: "padding_preset",
                      label: "AnyTLS 填充预设",
                      type: "select" as const,
                      options: [
                          ...anytlsPresets.map(
                              (p) => [p.id, p.label] as [string, string],
                          ),
                          ["custom", "自定义"] as [string, string],
                      ],
                  },
                  field,
              ]
            : nested[field.key]
              ? [
                    ...nested[field.key].map((f) => ({
                        ...f,
                        key: field.key + "." + f.key,
                    })),
                    {
                        ...field,
                        label: field.label + "（高级扩展 JSON）",
                        hint: "仅填写未在上方列出的扩展参数；已有扩展参数会保留。",
                    },
                ]
              : [
                    {
                        ...field,
                        ...(field.key === "region_code"
                            ? {
                                  hint: "管理员配置的节点展示地区，用于节点名称和订阅；与访问 IP 的 GeoIP 归属地独立，不会自动覆盖。留空保留原节点名称。",
                              }
                            : field.key === "city_code"
                              ? {
                                    label: "城市 / 州（可选）",
                                    hint: "选城市或州即可，留空仅显示国家；支持中英文名称检索。",
                                }
                              : field.key === "display_label"
                                ? {
                                      label: "线路编号 / 后缀（可选）",
                                      hint: "留空不追加编号，也不会追加原节点名称。",
                                  }
                                : {}),
                    },
                ],
    );
}
export function nodeSettingsInitial(initial: Row): Row {
    const values: Row = {
        ...initial,
        padding_preset: paddingPreset(initial.padding_scheme),
    };
    for (const [root, fields] of Object.entries(nested)) {
        const source = object(initial[root]);
        const advanced = object(source);
        for (const field of fields) {
            const value = get(source, field.key);
            if (value !== undefined) values[root + "." + field.key] = value;
            remove(advanced, field.key);
        }
        values[root] = advanced;
    }
    return values;
}
export function nodeSettingsPayload(values: Row): Row {
    const result = { ...values };
    for (const [root, fields] of Object.entries(nested)) {
        for (const field of fields) {
            const key = root + "." + field.key;
            if (!(key in result)) continue;
            const value = result[key];
            delete result[key];
            if (value === undefined || value === null || value === "") continue;
            result[root] = object(result[root]);
            put(result[root], field.key, value);
        }
    }
    return applyPaddingPreset(result);
}

// Start a backend conversion from the saved record; routes and parents are scoped
// to the original backend and must be selected again for the target backend.
export function nodeBackendInitial(initial: Row, backend: string): Row {
    if (!initial.id || initial.type === backend) return initial;
    const result = JSON.parse(JSON.stringify(initial)) as Row;
    result.route_id = [];
    result.parent_id = null;
    delete result.sing_box;
    if (backend === "v2node" && result.protocol === "naive")
        result.protocol = "";
    if (backend === "v2box") {
        delete result.encryption;
        delete result.encryption_settings;
        delete result.trusted_x_forwarded_for;
        for (const key of [
            "ech",
            "ech_key",
            "ech_config",
            "ech_server_name",
            "xver",
            "reject_unknown_sni",
            "mldsa65Seed",
            "server_names",
        ])
            if (result.tls_settings) delete result.tls_settings[key];
        if (!["tcp", "ws", "grpc", "httpupgrade"].includes(result.network)) {
            result.network = "";
            result.network_settings = {};
        }
        if (result.network_settings)
            delete result.network_settings.acceptProxyProtocol;
    }
    return result;
}

// Organize only the visible fields; never drop extension settings for presentation.
export function nodeEditorPresentation(fields: Field[]): Field[] {
    const category = (key: string): number => {
        if (
            [
                "name",
                "region_code",
                "city_code",
                "display_label",
                "tags",
            ].includes(key)
        )
            return 0;
        if (
            ["host", "port", "protocol", "network", "tls", "flow"].includes(
                key,
            ) ||
            key.startsWith("network_settings.") ||
            key.startsWith("networkSettings.") ||
            key.startsWith("tls_settings.") ||
            key.startsWith("tlsSettings.")
        )
            return 1;
        if (
            [
                "group_id",
                "rate",
                "show",
                "speed_limit",
                "device_limit",
            ].includes(key)
        )
            return 2;
        if (["listen_ip", "server_port", "parent_id", "route_id"].includes(key))
            return 3;
        return 4;
    };
    const titles = [
        "基本信息",
        "接入与协议",
        "访问与计费",
        "服务端设置",
        "高级与扩展参数",
    ];
    const hints: Record<string, string> = {
        host: "客户端连接的域名或 IP，不包含协议前缀和路径。",
        port: "客户端连接的端口；使用转发时可能与服务端口不同。",
        listen_ip: "节点服务监听的地址；不是客户端连接地址。",
        server_port: "节点服务实际监听端口，请核对防火墙及转发配置。",
        protocol:
            "切换协议可能清除不兼容参数和父节点选择，请先核对并保存当前配置。",
        rate: "计费流量 = 实际使用流量 × 倍率，不改变节点真实传输量。",
    };
    let previous = -1;
    return [...fields]
        .sort((a, b) => category(a.key) - category(b.key))
        .map((field) => {
            const group = category(field.key),
                section = group !== previous ? titles[group] : undefined;
            previous = group;
            const risky = /allow_?insecure|allowInsecure|^insecure$/.test(
                field.key,
            );
            return {
                ...field,
                section,
                hint: risky
                    ? "跳过证书校验会降低连接安全性，除明确需要外请保持关闭。"
                    : hints[field.key] || field.hint,
            };
        });
}
