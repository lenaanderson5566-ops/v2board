import { certificateCredentialOptions } from "./node-setup";
import type { Row } from "../shared/api";
import { nodeDomainProgress } from "./node-domain-progress";
import { nodeSettingsPayload } from "./node-settings";

export type NodeProblem = { key: string; message: string };
export function nodeConfigurationProblems(
    values: Row,
    backend: string,
    network?: Row | null,
): NodeProblem[] {
    const problems: NodeProblem[] = [];
    const add = (key: string, message: string) =>
        problems.push({ key, message });
    const v = nodeSettingsPayload(values);
    const managed = values.setup_mode === "managed";
    const tls = Number(v.tls),
        cert = v.tls_settings || {};
    for (const key of ["server_port", ...(!managed ? ["port"] : [])])
        if (
            key in v &&
            (!Number.isInteger(Number(v[key])) ||
                Number(v[key]) < 1 ||
                Number(v[key]) > 65535)
        )
            add(
                key,
                `${key === "port" ? "连接" : "监听"}端口应为 1–65535 的整数`,
            );
    if ("group_id" in v && !v.group_id?.length)
        add("group_id", "请选择至少一个权限组");
    if ("name" in v && !String(v.name || "").trim())
        add("name", "请填写节点名称");
    if (
        !managed &&
        "host" in v &&
        (!String(v.host || "").trim() ||
            /[\s/?#]/.test(String(v.host)) ||
            String(v.host).includes("://"))
    )
        add("host", "连接主机只填写域名或 IP，不包含协议和路径");
    if (managed && values.setup_access_mode === "relay") {
        const entry=(network?.assignments || []).find((a:Row)=>Number(a.id)===Number(values.setup_entry_id) && a.purpose==="entry" && a.enabled);
        if(backend!=="v2box")add("setup_access_mode","中转一体化部署仅支持 V2Box");
        if(!entry)add("setup_entry_id","请选择已配置的中转入口域名");
        if(entry && network && !(network.servers || []).some((s:Row)=>Number(s.id)===Number(entry.server_id) && s.enabled))add("setup_entry_id","入口服务器已停用，请先启用服务器");
        if(entry && values.setup_server_id && Number(entry.server_id)===Number(values.setup_server_id))add("setup_server_id","入口和回源须使用不同服务器");
        const port=Number(values.setup_entry_port);
        if(!Number.isInteger(port) || port<1 || port>65535)add("setup_entry_port","入口端口应为 1–65535 的整数");
        if(tls===1 && !["dns","file","remote"].includes(cert.cert_mode))add("tls_settings.cert_mode","中转 TLS 请使用 DNS 申请或已签发证书");
    }
    if (managed) {
        if (!values.setup_credential_id)
            add("setup_credential_id", "请选择已验证的根域名");
        const prefix = String(values.setup_prefix || "");
        if (prefix && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(prefix))
            add(
                "setup_prefix",
                "子域名前缀仅支持字母、数字和连字符，最长 63 位",
            );
        if (values.setup_server_id && network) {
            const server = (network.servers || []).find(
                (s: Row) => Number(s.id) === Number(values.setup_server_id),
            );
            if (
                !server?.enabled ||
                (server.family !== "dual" &&
                    server.family !== values.setup_family)
            )
                add("setup_server_id", "请选择支持当前地址类型的已启用服务器");
        }
    }
    if (
        ["trojan", "tuic", "hysteria2", "anytls", "naive"].includes(
            v.protocol,
        ) &&
        tls !== 1
    )
        add("tls", "当前协议需要启用 TLS");
    if (tls === 2 && v.protocol !== "vless")
        add("tls", "Reality 仅适用于 VLESS");
    if (
        backend === "v2box" &&
        ["shadowsocks", "tuic", "hysteria2", "anytls", "naive"].includes(
            v.protocol,
        ) &&
        v.network !== "tcp"
    )
        add("network", "当前内核与协议使用原生传输，请选择 TCP 配置项");
    if (tls === 1) {
        if (backend === "v2box" && values.setup_mode === "manual" && ["http","dns"].includes(cert.cert_mode)) add("setup_mode","自动申请证书需要自动管理服务器与域名；手动地址请使用已有证书或自签名证书");
        if ("tls_settings.cert_mode" in values && !cert.cert_mode)
            add("tls_settings.cert_mode", "请选择证书模式");
        if (
            !managed &&
            "tls_settings.server_name" in values &&
            !cert.server_name
        )
            add("tls_settings.server_name", "请填写 TLS 身份域名");
        if (cert.cert_mode === "http" && Number(v.server_port) === 80)
            add("server_port", "HTTP 证书验证占用 TCP 80，请使用其他监听端口");
        if (cert.cert_mode === "dns" && cert.dns_credential_id && network) {
            const options = certificateCredentialOptions(values, network, false);
            if (!options.some(([id]) => id === String(cert.dns_credential_id)))
                add("tls_settings.dns_credential_id", "证书凭据与当前证书域名不匹配或已停用，请重新选择");
        }
        if (cert.cert_mode === "dns" && !cert.dns_credential_id && !cert.provider)
            add("tls_settings.provider", "DNS 证书申请需要配置 DNS 提供商");
        if (cert.cert_mode === "dns" && !cert.dns_credential_id && !cert.dns_env)
            add("tls_settings.dns_env", "DNS 证书申请需要独立验证凭据");
        if (cert.cert_mode === "file" && (!cert.cert_file || !cert.key_file))
            add("tls_settings.cert_file", "请同时填写证书和私钥文件路径");
    }
    return problems;
}
function stable(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value))
        return JSON.stringify(
            Object.keys(value)
                .sort()
                .map((key) => [key, stable((value as Row)[key])]),
        );
    return JSON.stringify(value ?? null);
}
export function nodeChangeImpact(before: Row, after: Row): string[] {
    const normalize = (value: Row) => {
        const result = nodeSettingsPayload(value);
        for (const key of ["tls", "disable_sni", "port", "server_port"]) if (result[key] != null) result[key] = Number(result[key]);
        if (result.route_id) result.route_id = result.route_id.map(String);
        for (const key of ["tls_settings", "network_settings"]) {
            result[key] = Object.fromEntries(Object.entries(result[key] || {}).filter(([field, val]) => val != null && val !== "" && val !== false && val !== 0 && val !== "0" && !(field === "fingerprint" && val === "chrome") && !(field === "cert_mode" && val === "self")));
        }
        return result;
    };
    const previous = normalize(before), next = normalize(after);
    const groups: [string, string[]][] = [
        [
            "协议",
            ["protocol", "cipher", "flow", "encryption", "encryption_settings"],
        ],
        ["连接地址", ["host", "port"]],
        ["监听", ["listen_ip", "server_port"]],
        ["TLS 与证书", ["tls", "tls_settings", "disable_sni"]],
        ["传输与路由", ["network", "network_settings", "route_id"]],
    ];
    return groups
        .filter(([, keys]) =>
            keys.some(
                (key) =>
                    key in previous &&
                    stable(previous[key]) !== stable(next[key]),
            ),
        )
        .map(([label]) => label);
}
export function nodeDeploymentStage(
    node: Row,
    runtime: Row | null | undefined,
    binding: Row | undefined,
    authenticated: boolean,
) {
    const managed = !!binding?.managed;
    const dns = managed && binding ? nodeDomainProgress(binding, node) : null;
    const base = {
        dnsReady: !managed || !!dns?.dnsReady,
        terminal: false,
        target: "deploy",
    };
    if (runtime?.configurationState === "invalid")
        return { ...base, terminal: true, title: "当前配置无法下发", description: "请检查协议与证书中的配置及 Cloudflare 凭据。保存成功不代表节点已应用。", target: "logs" };
    if (runtime?.configurationState === "pending" && base.dnsReady)
        return { ...base, title: "设置已保存，等待节点获取", description: "节点尚未获取最新配置。请等待下一次同步；持续未更新时检查节点与面板的通信。", target: "logs" };
    if (runtime?.applicationState === "failed")
        return {
            ...base,
            terminal: true,
            title: "配置应用失败",
            description: "请查看节点日志，处理证书、协议或监听错误后恢复部署。",
            target: "logs",
        };
    if (runtime?.maintenance)
        return {
            ...base,
            terminal: true,
            title: "服务维护中",
            description: "请先在运行诊断中确认维护设置。",
            target: "runtime",
        };
    if (managed && binding && (!binding.enabled || binding.server_enabled === false || binding.server_enabled === 0)) return { ...base, terminal: true, title: dns?.title || "域名绑定已停用", description: dns?.description || "请启用服务器和域名绑定后继续。", target: "domain" };
    if (runtime?.runtimeStatus === "offline" && authenticated)
        return {
            ...base,
            terminal: true,
            title: "节点通信中断",
            description: "请检查本机服务和到面板的连接，再刷新状态。",
            target: "logs",
        };
    if (managed && binding && !dns?.reportsReady)
        return {
            ...base,
            title: "等待服务器 IP 上报",
            description:
                "新节点执行一键部署；已开始部署则按终端提示恢复，无需重复生成命令。",
        };
    if (managed && binding && !dns?.dnsReady)
        return {
            ...base,
            title: dns?.title || "等待 DNS 同步",
            description: dns?.description || "请检查域名解析。",
            target: "domain",
        };
    if (dns?.pending)
        return {
            ...base,
            title: "正在验证证书与监听",
            description: "保留当前连接，等待验证结果。请勿重复部署。",
            target: "logs",
        };
    if(managed && binding && dns && !dns.active && runtime?.runtimeStatus==="online" && runtime?.applicationState==="applied")
        return {...base,title:"服务已就绪，待启用连接地址",description:dns.description,target:"domain"};
    if (
        runtime?.runtimeStatus === "online" &&
        runtime?.applicationState === "applied"
    )
        return {
            ...base,
            terminal: true,
            title: binding?.entry_id && !binding.relay_verified_at ? "代理服务已就绪，待验证入口转发" : "服务运行正常",
            description: binding?.entry_id
                ? "本机配置已应用。仍需完成入口转发及实际客户端连接检查。"
                : "节点已确认应用当前配置；建议完成一次实际客户端连接检查。",
            target: binding?.entry_id && !binding.relay_verified_at ? "domain" : "runtime",
        };
    if (runtime?.runtimeStatus === "online" && runtime?.configurationState === "provided" && node.type === "v2node") return { ...base, terminal: true, title: "节点已接入，待实际验证", description: "配置已下发；当前内核不提供应用回执，请结合服务日志和客户端连接确认。", target: "logs" };
    if (runtime?.runtimeStatus === "online" && runtime?.receiptSupported === false && authenticated && node.type === "v2box") return { ...base, terminal: true, title: "节点已接入，缺少应用回执", description: "请升级节点以支持配置应用确认，或结合日志检查当前服务。", target: "upgrade" };
    if (!authenticated)
        return {
            ...base,
            title: "等待节点接入",
            description: "复制部署命令到目标服务器执行，接入后自动更新状态。",
        };
    return {
        ...base,
        title: "等待配置应用确认",
        description:
            "凭据已认证，等待节点完成证书和监听初始化。可查看日志确认进度。",
        target: "logs",
    };
}
