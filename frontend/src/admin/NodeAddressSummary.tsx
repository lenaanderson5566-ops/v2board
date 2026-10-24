import type { Row } from "../shared/api";

function endpoint(host: unknown, port: unknown) {
    if (!host) return "尚未配置";
    const name = String(host);
    return port ? `${name.includes(":") && !name.startsWith("[") ? `[${name}]` : name}:${port}` : name;
}

/** Saved addresses only. A prepared DNS record is not a published endpoint. */
export function NodeAddressSummary({ node, binding, entry }: { node: Row; binding?: Row; entry?: Row }) {
    const relay = !!binding?.entry_id;
    const target = relay ? entry?.domain || binding?.connection_domain : binding?.domain;
    const targetPort = relay ? binding?.entry_port : node.server_port;
    const current = endpoint(binding?.published_domain || node.host, binding?.published_port || node.port);
    const planned = target ? endpoint(target, targetPort) : null;
    const tls = Number(node.tls);
    return <section className="node-address-summary" aria-label="地址与证书概览">
        <div className="node-address-heading"><h3>地址与证书</h3><span>{binding ? relay ? "中转连接" : "直连连接" : "按节点配置连接"}</span></div>
        <dl>
            <div><dt>连接地址</dt><dd>{current}</dd><small>当前订阅使用的地址</small>{planned && planned !== current && <p className="node-address-pending">待启用：{planned}</p>}</div>
            <div><dt>回源地址</dt><dd>{binding?.domain ? endpoint(binding.domain, node.server_port) : "未配置托管回源域名"}</dd><small>{relay ? "入口转发到代理服务器的地址" : "代理服务器地址；直连无需配置转发"}</small></div>
            <div><dt>{tls === 2 ? "Reality 身份域名" : "TLS 身份域名"}</dt><dd>{tls ? node.tls_settings?.server_name || "尚未配置" : "未启用 TLS"}</dd><small>{tls === 2 ? "由 Reality 服务独立管理" : "用于校验证书，与连接地址分别管理"}</small></div>
        </dl>
        {binding?.tls_transition_state === "pending" && <p className="muted">新配置验证中，以上为当前发布配置；成功后更新订阅。</p>}
    </section>;
}
