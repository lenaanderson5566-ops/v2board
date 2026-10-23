import type { Row } from "../shared/api";

export function NodeTopology({ service, entry, origin, server, entryServer, host, port, preview = true, shared = 0, serviceConnections = 0 }: {
    service?: Row; entry?: Row; origin?: Row; server?: Row; entryServer?: Row;
    host?: string; port?: number | string; preview?: boolean; shared?: number; serviceConnections?: number;
}) {
    const steps = [
        { title: "用户", detail: "客户端连接" },
        { title: entry ? "入口转发" : "直连地址", detail: `${host || entry?.domain || origin?.domain || "待配置域名"}:${port || "—"}`, sub: entry ? `${entryServer?.name || "入口服务器"}${shared ? ` · 关联 ${shared} 条线路` : ""}` : undefined },
        ...(entry ? [{ title: "回源地址", detail: `${origin?.domain || "待配置回源域名"}:${service?.server_port || "—"}` }] : []),
        { title: "代理服务", detail: service?.name || "待选择代理服务", sub: `${server?.name || "服务器待关联"} · ${service?.protocol || "协议待配置"} :${service?.server_port || "—"}` },
    ];
    const tlsName = service?.["tls_settings.server_name"] || service?.tls_settings?.server_name;
    return <section className="node-topology" aria-label="线路拓扑">
        <div className="node-topology-heading"><strong>连接路径</strong><span className="muted">{preview ? "待保存预览" : "已保存配置"}</span></div>
        <ol>{steps.map((step, index) => <li key={index}><strong>{step.title}</strong><span>{step.detail}</span>{step.sub && <small>{step.sub}</small>}</li>)}</ol>
        {Number(service?.tls) === 1 && <p className="muted">TLS 在代理服务终止 · SNI／证书身份：{tlsName || "待配置"}</p>}
        {Number(service?.tls) === 2 && <p className="muted">Reality 身份由代理服务独立管理：{tlsName || "待配置"}</p>}
        {serviceConnections > 0 && <p className="muted">此代理服务另有关联线路 {serviceConnections} 条。修改协议、监听或证书会影响这些线路。</p>}
        {(server || entryServer) && <details><summary>服务器地址与解析状态</summary>
            {[entryServer && { label: "入口服务器", value: entryServer, binding: entry }, server && { label: "服务所在服务器", value: server, binding: origin }].filter(Boolean).map((item: any) => <p key={item.label}>{item.label}：{item.value.name} · {[item.value.ipv4, item.value.ipv6].filter(Boolean).join(" / ") || "等待 IP 上报"} · {item.value.enabled === false || item.value.enabled === 0 ? "服务器已停用" : ["healthy", "ready_to_switch"].includes(item.binding?.status) ? "最近解析同步成功" : "解析待检查"}</p>)}
        </details>}
    </section>;
}
