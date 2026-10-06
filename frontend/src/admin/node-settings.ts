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
        ? structuredClone(value as Row)
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
        nested[field.key]
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
            : [field],
    );
}
export function nodeSettingsInitial(initial: Row): Row {
    const values = { ...initial };
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
    return result;
}
