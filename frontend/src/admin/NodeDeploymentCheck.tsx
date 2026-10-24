import { useEffect, useRef, useState } from "react";
import { admin, date, request, type Row } from "../shared/api";

const checkReasons: Record<string, string> = {
    dns_empty: "未查到公网地址",
    dns_unavailable: "DNS 查询未完成",
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
    return (
        <section
            className="admin-deployment-card"
            aria-label="部署连通性检查"
            aria-busy={busy}
        >
            <div className="deployment-check-heading">
                <h3>部署检查</h3>
                <button
                    className="primary"
                    disabled={disabled || busy}
                    onClick={check}
                >
                    {busy ? "正在检查…" : "一键检查"}
                </button>
            </div>
            <p className="muted">
                检查公网
                DNS、在线证书、节点端口及中转入口。仅检查，不会重启服务或修改配置。
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
                        连接探测：面板服务器 · DNS 查询：Google Public
                        DNS。设置变更后请重新检查。
                    </p>
                    <ul className="deployment-check-list">
                        {result.items.map((item: Row) => (
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
                    <details>
                        <summary>检查地址与范围</summary>
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
                            .filter(Boolean)
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
