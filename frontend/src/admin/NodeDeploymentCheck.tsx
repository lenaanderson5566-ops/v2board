import { useEffect, useRef, useState } from "react";
import { admin, date, request, type Row } from "../shared/api";

const checkReasons: Record<string, string> = {
    dns_empty: "未查到公网地址",
    dns_unavailable: "公共 DNS 查询服务不可用",
    dns_mismatch: "解析与服务器上报 IP 不一致",
    unsafe_target: "非公网目标，未探测",
    invalid_port: "端口不支持单端口检查",
    udp_client_required: "需协议客户端验证",
    too_many_addresses: "多地址超出本次探测范围",
    unreachable: "从面板不可达，请检查网络策略",
    certificate_invalid: "证书信任链或域名校验失败",
    certificate_unavailable: "未获取到在线证书",
    probe_unavailable: "面板探测组件暂不可用",
    tls_verified: "TLS 握手与证书校验通过",
    tcp_connected: "TCP 连接成功，未验证代理协议",
};

export function NodeDeploymentCheck({
    node,
    disabled = false,
}: {
    node: Row;
    disabled?: boolean;
}) {
    const [result, setResult] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const generation = useRef(0);
    const pending = useRef(false);
    useEffect(() => {
        generation.current++;
        setResult(null);
        setError("");
        setBusy(false);
        pending.current = false;
        return () => {
            generation.current++;
        };
    }, [node.id, node.type, node.updated_at]);
    async function check() {
        if (pending.current) return;
        pending.current = true;
        const current = generation.current;
        setBusy(true);
        setError("");
        setResult(null);
        try {
            const response = await request(
                admin("server/manage/check-deployment"),
                { type: node.type, id: node.id },
            );
            if (current === generation.current) setResult(response.data);
        } catch (e) {
            if (current === generation.current) setError((e as Error).message);
        } finally {
            if (current === generation.current) {
                pending.current = false;
                setBusy(false);
            }
        }
    }
    const checks = (result?.items || []).filter((item: Row) => item.state !== "skip" && item.key !== "renewal");
    const clientOnly = result?.origin?.code === "udp_client_required";
    const protocolChecks = checks.filter((item: Row) => ["listener", "certificate", "relay"].includes(item.key));
    const visibleChecks = clientOnly && protocolChecks.length && protocolChecks.every((item: Row) => item.state === "unknown")
        ? [...checks.filter((item: Row) => !["listener", "certificate", "relay"].includes(item.key)),
           {...protocolChecks[0], key: "client", label: "客户端验证"}]
        : checks;
    const issues = visibleChecks.filter((item: Row) => item.state !== "pass" || !!item.next);
    const passed = visibleChecks.filter((item: Row) => item.state === "pass" && !item.next);
    return (
        <section
            className="admin-deployment-card"
            aria-label="部署连通性检查"
            aria-busy={busy}
        >
            <div className="deployment-check-heading">
                <h3>连接排查</h3>
                <button
                    className="primary"
                    disabled={disabled || busy}
                    onClick={check}
                >
                    {busy ? "正在检查…" : "一键检查"}
                </button>
            </div>
            <p className="muted">
                连接异常时检查 DNS、端口和证书；不会修改配置或重启服务。
            </p>
            {busy && (
                <p role="status">
                    正在从面板验证连接，请稍候。UDP
                    与受防火墙限制的回源连接会单独说明。
                </p>
            )}
            {error && <p role="alert">检查未完成：{error}。请稍后重试。</p>}
            {result && (
                <>
                    <p className="muted">
                        检查时间：{date(result.checkedAt)} ·
                        连接探测：面板服务器 · DNS 查询：Google Public DNS，服务不可用时切换 Cloudflare。设置变更后请重新检查。
                    </p>
                    {issues.length === 0 && passed.length > 0 && <p role="status">本次可检查项目均已通过。</p>}
                    {[{label: "需要确认", items: issues, expanded: true}, {label: "已通过", items: passed, expanded: false}].filter(group => group.items.length > 0).map(group => (
                    <details key={group.label} open={group.expanded}>
                    <summary>{group.label}（{group.items.length}）</summary>
                    <ul className="deployment-check-list">
                        {group.items.map((item: Row) => (
                            <li key={item.key}>
                                <div className="deployment-check-heading">
                                    <strong>{item.label}</strong>
                                    <span
                                        className={`deployment-check-state is-${item.state}`}
                                    >
                                        {item.state === "pass"
                                            ? "已验证"
                                            : item.state === "skip"
                                              ? "不适用"
                                              : item.state === "fail"
                                                ? "检查异常"
                                                : "待确认"}
                                    </span>
                                </div>
                                <p>{item.detail}</p>
                                {item.expiresAt && (
                                    <p>证书到期：{date(item.expiresAt)}</p>
                                )}
                                {item.next && (
                                    <p className="muted">下一步：{item.next}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                    </details>
                    ))}
                    <details>
                        <summary>检查地址与范围</summary>
                        <p>自动续期由节点执行，本次检查不发起续期。在线证书有效不代表已验证下一次续期。</p>
                        <p>
                            代理监听：{result.origin.host}:{result.origin.port}
                        </p>
                        {result.entry && (
                            <p>
                                中转入口：{result.entry.host}:
                                {result.entry.port}
                            </p>
                        )}
                        {result.connection && (
                            <p>
                                连接地址：{result.connection.host}:
                                {result.connection.port}
                            </p>
                        )}
                        {[result.origin, result.entry, result.connection]
                            .filter((endpoint: Row | null, index: number, endpoints: (Row | null)[]) => endpoint && endpoints.findIndex(other => other?.host === endpoint.host && other?.port === endpoint.port) === index)
                            .map((endpoint: Row, index: number) => (
                                <p key={index}>
                                    {endpoint.host}:{endpoint.port} ·{" "}
                                    {checkReasons[endpoint.code] || "尚未确认"}
                                    {endpoint.addresses?.map((address: Row) => (
                                        <span
                                            className="deployment-check-address"
                                            key={address.ip}
                                        >
                                            {address.ip}：
                                            {checkReasons[address.code] ||
                                                "尚未确认"}
                                        </span>
                                    ))}
                                </p>
                            ))}
                        {result.identity && (
                            <p>TLS 身份域名：{result.identity}</p>
                        )}
                        <p className="muted">{result.note}</p>
                    </details>
                </>
            )}
        </section>
    );
}

export function NodeDnsObservation({observation}:{observation?:Row | null}) {
    return <>{observation && observation.state !== "verified" && <div role="status" className="node-domain-progress">
                            <strong>节点端 DNS 检查 · {({origin:"回源域名",entry:"入口域名",certificate:"证书域名"} as Record<string,string>)[observation.role]}</strong>
                            <p>{({checking:"正在查询公网解析。",verified:"节点最近一次公网解析检查已通过。",mismatch:"解析与预期 IP 不一致。请核对 A/AAAA、遗留记录与 DNS only 设置，再恢复部署。",unavailable:"公共 DNS 查询服务均不可用。请检查节点的出站 HTTPS 与本机 DNS，再恢复部署；无需重装或更换证书凭据。"} as Record<string,string>)[observation.state]}</p>
                            <small>节点上报：{date(observation.checkedAt)} · 此结果不代表证书或部署已完成。</small>
                        </div>}</>;
}
