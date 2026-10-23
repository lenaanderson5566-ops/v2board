import type { Row } from "../shared/api";
import type { Field } from "../shared/ui";

export function nodeSetupFields(
    fields: Field[],
    values: Row,
    network: Row | null | undefined,
): Field[] {
    const roots: Row[] = (network?.credentials || []).filter(
        (root: Row) => root.root_domain,
    );
    const managed = values.setup_mode === "managed";
    const setup: Field[] = [
        {
            key: "setup_mode",
            section: "连接与域名",
            label: "配置方式",
            type: "select",
            options: [
                ["managed", "直连一键部署（推荐）"],
                ["manual", "手动维护连接地址"],
            ],
            hint: "自动关联服务器与域名，保存后即可部署。",
        },
    ];
    if (managed)
        setup.push(
            {
                key: "setup_credential_id",
                columns: 6,
                label: "根域名",
                type: "select",
                required: true,
                options: [
                    ["", "选择已验证的根域名"],
                    ...roots.map(
                        (root) =>
                            [String(root.id), root.root_domain] as [
                                string,
                                string,
                            ],
                    ),
                ],
                hint: roots.length
                    ? "普通 TLS 的 SNI 自动同步。"
                    : "请先在服务器与域名中维护 Cloudflare 根域名；也可选择手动维护连接地址。",
            },
            {
                key: "setup_prefix",
                columns: 6,
                label: "子域名前缀（可选）",
                hint: "留空自动生成。",
            },
            {
                key: "setup_family",
                columns: 6,
                label: "服务器地址类型",
                type: "select",
                options: [
                    ["ipv4", "IPv4"],
                    ["ipv6", "IPv6"],
                    ["dual", "双栈"],
                ],
            },
            {
                key: "setup_server_id",
                columns: 6,
                label: "所属服务器",
                type: "select",
                options: [
                    ["", "自动创建（与节点同名）"],
                    ...(network?.servers || [])
                        .filter(
                            (server: Row) =>
                                server.enabled &&
                                (server.family === "dual" ||
                                    server.family === values.setup_family),
                        )
                        .map(
                            (server: Row) =>
                                [String(server.id), server.name] as [
                                    string,
                                    string,
                                ],
                        ),
                ],
                hint: "首次部署保持默认；同机新增协议可复用已有服务器。",
            },
        );
    const primary = fields
        .filter((field) =>
            ["name", "protocol", ...(managed ? ["server_port"] : [])].includes(
                field.key,
            ),
        )
        .map((field, index) => ({
            ...field,
            section: index === 0 ? "节点信息" : undefined,
            columns: field.key === "name" ? 12 : 6,
            ...(field.key === "protocol" ? { hint: undefined } : {}),
            ...(field.key === "server_port"
                ? { label: "连接端口", hint: "同时用于服务监听。" }
                : {}),
        }));
    const excluded = [
        ...primary.map((field) => field.key),
        ...(managed
            ? [
                  "host",
                  "port",
                  ...(Number(values.tls) === 1
                      ? ["tls_settings.server_name", "disable_sni"]
                      : []),
              ]
            : []),
    ];
    const remaining = fields.filter((field) => !excluded.includes(field.key));
    if (remaining[0] && !remaining[0].section)
        remaining[0] = { ...remaining[0], section: "协议与展示" };
    return [...primary, ...setup, ...remaining];
}

export function nodeSetupPayload(values: Row): Row | undefined {
    if (values.setup_mode !== "managed") return;
    return {
        credential_id: Number(values.setup_credential_id),
        prefix: values.setup_prefix || "",
        family: values.setup_family || "ipv4",
        server_id: values.setup_server_id
            ? Number(values.setup_server_id)
            : null,
    };
}
