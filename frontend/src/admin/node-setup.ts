import type { Row } from "../shared/api";
import { defaultLineFields } from "./node-line-fields";
import type { Field } from "../shared/ui";

export function nodeSetupFields(
    fields: Field[],
    values: Row,
    network: Row | null | undefined,
    backend = "v2box",
    lineFields?: Field[],
): Field[] {
    const roots: Row[] = (network?.credentials || []).filter(
        (root: Row) => root.root_domain,
    );
    const managed = values.setup_mode === "managed";
    const relay = managed && values.setup_access_mode === "relay";
    const entries: Row[] = (network?.assignments || []).filter(
        (a: Row) =>
            a.purpose === "entry" &&
            a.enabled &&
            (network?.servers || []).some(
                (s: Row) => Number(s.id) === Number(a.server_id) && s.enabled,
            ),
    );
    const setup: Field[] = [
        {
            key: "setup_mode",
            section: "连接路径与域名",
            label: "配置方式",
            type: "select",
            options: [
                ["managed", "自动管理服务器与域名（推荐）"],
                ["manual", "手动维护连接地址"],
            ],
            hint: "先完成协议与证书配置，再设置下方连接路径；保存后在代理服务器执行部署命令。",
        },
    ];
    if (managed && backend === "v2box")
        setup.push({
            key: "setup_access_mode",
            section: "接入方式",
            label: "接入方式",
            type: "select",
            options: [
                ["direct", "直连"],
                ["relay", "入口中转"],
            ],
            hint: "直连直接连接代理服务器；中转经入口转发。普通 TLS 中转请先选择 DNS 申请并配置验证凭据，证书覆盖入口域名。",
        });
    if (managed && relay)
        setup.push(
            {
                key: "setup_entry_id",
                label: "入口域名",
                type: "select",
                required: true,
                options: [
                    ["", "选择服务器管理内已配置的入口"],
                    ...entries.map(
                        (a: Row) =>
                            [String(a.id), a.domain] as [string, string],
                    ),
                ],
                hint: entries.length
                    ? "入口域名解析到中转服务器，不能与回源使用同一台服务器。"
                    : "请先到服务器管理，在新建或已有服务器管理中配置入口域名。",
            },
            {
                key: "setup_entry_port",
                label: "入口端口",
                type: "number",
                required: true,
                hint: "客户端连接此端口；须在入口服务器加载转发配置。",
            },
        );
    if (managed)
        setup.push(
            {
                key: "setup_credential_id",
                columns: 6,
                label: relay ? "回源根域名" : "根域名",
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
                    ? relay
                        ? "回源域名解析到代理服务所在服务器；普通 TLS 的 SNI 使用入口域名。"
                        : "普通 TLS 的 SNI 自动同步。"
                    : "请先在域名与解析中维护 Cloudflare 根域名；也可选择手动维护连接地址。",
            },
            {
                key: "setup_prefix",
                columns: 6,
                label: "子域名前缀",
                hint: "留空自动生成。",
            },
            {
                key: "setup_family",
                columns: 6,
                label: "地址类型",
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
                label: relay ? "回源服务器" : "节点服务器",
                type: "select",
                options: [
                    ["", "自动创建（与节点同名）"],
                    ...(network?.servers || [])
                        .filter(
                            (server: Row) =>
                                server.enabled &&
                                Number(server.id) !==
                                    Number(
                                        entries.find(
                                            (a) =>
                                                Number(a.id) ===
                                                Number(values.setup_entry_id),
                                        )?.server_id,
                                    ) &&
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
    const line = (
        lineFields || fields.filter((f) => defaultLineFields.includes(f.key))
    )
        .filter((f) => fields.some((source) => source.key === f.key))
        .map((f, index) => ({
            ...f,
            section:
                index === 0
                    ? "节点信息"
                    : f.key === "region_code"
                      ? "展示信息"
                      : undefined,
        }));
    if (!managed)
        setup.push(
            ...fields
                .filter((f) => ["host", "port"].includes(f.key))
                .map((f) => ({
                    ...f,
                    section: undefined,
                    label: f.key === "host" ? "连接地址" : "连接端口",
                })),
        );
    const excluded = [
        ...defaultLineFields,
        "show",
        "sort",
        "host",
        "port",
        ...(managed
            ? [
                  ...(Number(values.tls) === 1
                      ? ["tls_settings.server_name", "disable_sni"]
                      : []),
              ]
            : []),
    ];
    const service = nodeServiceFields(
        fields.filter((f) => !excluded.includes(f.key)),
    ).map((f) => ({
        ...f,
        ...(f.key === "server_port"
            ? {
                  label: "监听端口",
                  hint: relay
                      ? "入口转发到此端口，与入口端口分别配置。"
                      : "节点服务在此端口接收连接；直连时连接端口同步使用此值。",
              }
            : {}),
    }));
    return [...line, ...service, ...setup];
}

export function nodeSetupPayload(values: Row): Row | undefined {
    if (values.setup_mode !== "managed") return;
    return {
        credential_id: Number(values.setup_credential_id),
        prefix: values.setup_prefix || "",
        family: values.setup_family || "ipv4",
        ...(values.setup_access_mode === "relay"
            ? {
                  entry_id: Number(values.setup_entry_id),
                  entry_port: Number(values.setup_entry_port),
              }
            : {}),
        server_id: values.setup_server_id
            ? Number(values.setup_server_id)
            : null,
    };
}

export function nodeServiceFields(fields: Field[]): Field[] {
    return [...fields].sort((a,b)=>{
        const order=["protocol","listen_ip","server_port","tls","network","route_id"];
        const rank=(key:string)=>{const index=order.indexOf(key);return index<0?order.length:index;};
        return rank(a.key)-rank(b.key);
    }).map((field, index) => ({
        ...field,
        section: index === 0 ? "代理服务" : field.section,
        ...(field.key === "server_port" ? { label: "监听端口" } : {}),
    }));
}
