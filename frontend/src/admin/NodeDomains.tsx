import { relayStreamConfig } from "./node-relay";
import { useEffect, useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Panel, State, Table, useData } from "../shared/ui";
import { AdminLogTimeZone, logTime } from "./admin-log-time";
import { NodeNetworkSetup } from "./NodeNetworkSetup";
import { nodeDomainProgress } from "./node-domain-progress";

export const domainStatus: Record<string, string> = {
    awaiting_report: "等待 IP 上报",
    healthy: "解析正常",
    ready_to_switch: "解析就绪，待切换地址",
    ownership_conflict: "同名解析归属不符",
    pending_cleanup: "等待清理",
    still_in_use: "仍被节点或证书引用",
    network_error: "网络异常，等待重试",
    credential_rejected: "凭据无效或权限不足",
    rate_limited: "Cloudflare 限流",
    host_changed: "节点地址已变化，请重新保存域名绑定",
    ambiguous_records: "同名解析不唯一，请核查",
    unexpected_record: "解析响应异常，等待重试",
    provider_error: "Cloudflare 服务异常",
    dns_adopted: "已接管现有解析",
};

export const certificateTransitionStatus: Record<string, string> = {
    pending: "正在验证证书与节点就绪状态，当前地址继续保留",
    failed: "切换未完成，已保留原配置。请检查节点日志后重试",
    applied: "域名与证书已同步",
};

export function NodeDomainBinding({
    node,
    onChanged,
    onPublished,
    onUpgrade,
}: {
    node: Row;
    onChanged?: () => void;
    onPublished?: () => void;
    onUpgrade?: () => void;
}) {
    const data = useData<Row>(admin("server/ddns/fetch"));
    const roots: Row[] = (data.data?.credentials || []).filter(
        (c: Row) => c.root_domain,
    );
    const binding: Row | undefined = (data.data?.assignments || []).find(
        (a: Row) => a.node_type === node.type && a.node_id === node.id,
    );
    const servers: Row[] = data.data?.servers || [];
    const entries: Row[] = (data.data?.assignments || []).filter(
        (a: Row) => a.purpose === "entry" && a.enabled,
    );
    const [serverId, setServerId] = useState("");
    const [mode, setMode] = useState("direct");
    const [entryId, setEntryId] = useState("");
    const [entryPort, setEntryPort] = useState(String(node.port || 443));
    const entry = entries.find((a) => a.id === binding?.entry_id);
    const [root, setRoot] = useState(""),
        [prefix, setPrefix] = useState(""),
        [family, setFamily] = useState("ipv4");
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    const [adoption, setAdoption] = useState<Row | null>(null);
    const pending = useRef(false);
    const progress = binding ? nodeDomainProgress(binding, node) : null;
    const lastPublished = useRef({ domain: node.host, port: node.port });
    useEffect(() => {
        if (
            !binding?.published_domain ||
            (binding.published_domain === lastPublished.current.domain &&
                (!binding.published_port ||
                    Number(binding.published_port) ===
                        Number(lastPublished.current.port)))
        )
            return;
        lastPublished.current = {
            domain: binding.published_domain,
            port: binding.published_port || lastPublished.current.port,
        };
        onPublished?.();
    }, [binding?.published_domain, binding?.published_port, onPublished]);
    useEffect(() => {
        if (!binding?.enabled || data.loading || data.error || busy || adoption)
            return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") data.reload();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [
        binding?.enabled,
        data.loading,
        data.error,
        data.reload,
        busy,
        adoption,
    ]);
    useEffect(() => {
        if (binding) {
            setServerId(String(binding.server_id || ""));
            setMode(binding.entry_id ? "relay" : "direct");
            setEntryId(String(binding.entry_id || ""));
            setEntryPort(String(binding.entry_port || node.port || 443));
            setRoot(String(binding.credential_id));
            setFamily(binding.family);
            const c = (data.data?.credentials || []).find(
                (r: Row) => r.id === binding.credential_id,
            );
            if (c?.root_domain && binding.domain.endsWith("." + c.root_domain))
                setPrefix(binding.domain.slice(0, -c.root_domain.length - 1));
        }
    }, [
        binding?.id,
        binding?.domain,
        binding?.family,
        binding?.server_id,
        binding?.entry_id,
        binding?.entry_port,
    ]);
    async function act(path: string, payload: Row) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const r = await request<Row>(
                admin(`server/domains/${path}`),
                payload,
            );
            data.reload();
            onChanged?.();
            setNotice(
                path === "bind"
                    ? "域名已保存。新安装会等待解析并验证节点后启用；已有节点请先配置上报，再确认切换。"
                    : path === "activate"
                      ? "已提交启用请求，请查看上方进度；验证成功后会自动更新生效域名。"
                      : path === "retry"
                        ? "已安排 DNS 同步，将由下一轮后台调度执行。同步使用最近上报的服务器 IP，不会重启节点或切换订阅地址。"
                      : "操作已完成",
            );
            return r.data;
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <section className="admin-deployment-card">
            <h3>域名与解析</h3>
            <State {...data} retry={data.reload}>
                {binding && (
                    <div>
                        {progress && (
                            <div className="node-domain-progress">
                                <ol aria-label="域名启用进度">
                                    {[
                                        ["保存域名", true],
                                        ["IP 上报", progress.reportsReady],
                                        ["解析同步", progress.dnsReady],
                                        ["启用域名", progress.active],
                                    ].map(([label, done], index) => (
                                        <li
                                            key={String(label)}
                                            data-done={done ? "true" : "false"}
                                        >
                                            <span>
                                                {done ? "✓" : index + 1}
                                            </span>
                                            {label}
                                            <small>
                                                {done
                                                    ? "已完成"
                                                    : index === 3 &&
                                                        progress.pending
                                                      ? "验证中"
                                                      : "待完成"}
                                            </small>
                                        </li>
                                    ))}
                                </ol>
                                <h4>{progress.title}</h4>
                                <p>{progress.description}</p>
                            </div>
                        )}
                        <p>
                            {binding.entry_id ? "回源域名" : "目标域名"}：
                            {binding.domain}
                        </p>
                        {entry && (
                            <>
                                <p>
                                    连接入口：{entry.domain}:
                                    {binding.entry_port} ·{" "}
                                    {domainStatus[entry.status] || entry.status}
                                </p>
                                <p>
                                    入口服务器：
                                    {servers.find(
                                        (s) => s.id === entry.server_id,
                                    )?.name || "—"}{" "}
                                    · 回源服务器：
                                    {servers.find(
                                        (s) => s.id === binding.server_id,
                                    )?.name || "—"}
                                </p>
                                <p>
                                    已确认回源：
                                    {binding.published_origin || "尚未确认"}
                                    {binding.published_origin &&
                                    binding.published_origin !== binding.domain
                                        ? " · 请将转发配置更新到新回源域名，完成测试后确认。旧解析继续保留。"
                                        : ""}
                                </p>
                                <p className="muted">
                                    TLS
                                    在节点终止。证书覆盖入口域名，回源域名仅用于中转服务器定位节点。请在入口配置四层转发至{" "}
                                    {binding.domain}:{node.server_port}。
                                </p>
                                <details>
                                    <summary>入口转发配置</summary>
                                    <p className="muted">
                                        适用于 Nginx 1.27.3 及以上版本，并需启用
                                        stream 模块。将以下片段放入已有 stream
                                        配置，确认监听端口未被占用，再执行 nginx
                                        -t，检查通过后重载。DNS
                                        解析变化会自动更新回源地址。
                                    </p>
                                    <pre className="admin-network-command">
                                        {relayStreamConfig(
                                            binding,
                                            node,
                                            entry,
                                        ) || "请先设置有效的节点监听端口。"}
                                    </pre>
                                    <p className="muted">
                                        入口按节点协议开放 TCP／UDP
                                        端口。节点防火墙需允许入口服务器访问监听端口；此配置不启用
                                        PROXY protocol。
                                    </p>
                                </details>
                                <p>
                                    {binding.relay_verified_at
                                        ? `转发链路由管理员确认于 ${logTime(binding.relay_verified_at)}`
                                        : "下一步：配置入口转发，并通过入口进行实际客户端连接测试。节点就绪不代表转发链路已连通。"}
                                </p>
                                {progress?.active &&
                                    !binding.relay_verified_at && (
                                        <button
                                            disabled={busy}
                                            onClick={async () => {
                                                if (
                                                    !confirm(
                                                        "已通过此入口使用客户端完成连接测试？此操作仅记录管理员确认，不执行自动探测。",
                                                    )
                                                )
                                                    return;
                                                setBusy(true);
                                                setError("");
                                                try {
                                                    await request(
                                                        admin(
                                                            "server/network/confirm-relay",
                                                        ),
                                                        {
                                                            id: binding.id,
                                                            confirm: true,
                                                        },
                                                    );
                                                    data.reload();
                                                } catch (e) {
                                                    setError(
                                                        (e as Error).message,
                                                    );
                                                } finally {
                                                    setBusy(false);
                                                }
                                            }}
                                        >
                                            确认转发测试完成
                                        </button>
                                    )}
                            </>
                        )}
                        <p>
                            当前生效域名：
                            {binding.published_domain || node.host} ·{" "}
                            {domainStatus[binding.status] || binding.status}
                        </p>
                        <AdminLogTimeZone />
                        {(binding.family === "dual"
                            ? ["ipv4", "ipv6"]
                            : [binding.family]
                        ).map((family) => {
                            const seen = Number(binding[`${family}_seen_at`]);
                            return (
                                <p key={family}>
                                    {family === "ipv4" ? "IPv4" : "IPv6"} 上报：
                                    {binding[family] || "尚未收到"} · 最近上报：
                                    {seen ? logTime(seen) : "—"}
                                    {seen > 0 && seen < Date.now() / 1000 - 900
                                        ? " · 已超过 15 分钟，请检查上报服务"
                                        : ""}
                                </p>
                            );
                        })}
                        <p>
                            最近解析同步：
                            {binding.last_success
                                ? logTime(binding.last_success)
                                : "—"}
                        </p>
                        {!binding.ipv4 && !binding.ipv6 && (
                            <p className="muted">
                                尚未收到独立 IP 上报。节点列表的 IP
                                也可能来自连接面板时的出口地址。
                                {node.type === "v2box"
                                    ? "新节点请执行一键部署；已部署节点可在高级维护中修复上报。若部署尚未完成，请先执行恢复命令。"
                                    : "请在 服务器与域名 中配置节点上报。"}
                            </p>
                        )}
                        <div className="actions">
                            {progress?.needsUpgrade && onUpgrade && (
                                <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={onUpgrade}
                                >
                                    查看节点升级命令
                                </button>
                            )}
                            {binding.managed &&
                                binding.status === "ownership_conflict" && (
                                    <button
                                        disabled={busy}
                                        onClick={async () => {
                                            const r = await act("adopt", {
                                                id: binding.id,
                                            });
                                            if (r) setAdoption(r);
                                        }}
                                    >
                                        预览接管现有解析
                                    </button>
                                )}

                            <button
                                disabled={busy || data.loading}
                                onClick={data.reload}
                            >
                                刷新状态
                            </button>
                            {!progress?.dnsReady && !progress?.pending && (
                                <button
                                    disabled={
                                        busy ||
                                        !binding.managed ||
                                        !binding.enabled ||
                                        !progress?.reportsReady
                                    }
                                    onClick={() =>
                                        act("retry", { id: binding.id })
                                    }
                                >
                                    重试 DNS 同步
                                </button>
                            )}
                            {progress?.canActivate && (
                                <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                `确认将节点连接地址切换为 ${binding.domain}？普通 TLS 节点将先验证新证书与监听，再同步连接地址、SNI 和证书域名；失败保留原配置。Reality 仅更新连接地址，旧托管解析至少保留 24 小时。`,
                                            )
                                        )
                                            void act("activate", {
                                                id: binding.id,
                                                confirm: true,
                                            });
                                    }}
                                >
                                    验证并切换地址
                                </button>
                            )}
                        </div>
                        <details className="admin-deployment-tools">
                            <summary>操作说明</summary>
                            <p>刷新状态：读取面板记录，不执行 DNS 查询或修改配置。页面每 15 秒自动更新。</p>
                            <p>重试 DNS 同步：按服务器最近上报的 IP 更新 Cloudflare 解析，不重启节点、不切换订阅地址。</p>
                            <p>验证并切换地址：普通 TLS 服务先验证证书和监听，成功后更新节点列表及订阅地址；Reality 保持原有 SNI。</p>
                            <p>新安装由一键部署完成上述步骤。终端等待就绪时，请查看服务状态及日志；中断后使用恢复命令继续。</p>
                        </details>
                        {node.type === "v2box" &&
                            !node._new &&
                            !progress?.pending &&
                            !progress?.reportsReady && (
                                <details className="admin-deployment-tools">
                                    <summary>高级维护</summary>
                                    <div>
                                        <p className="muted">
                                            仅用于已安装节点缺少上报或上报异常。一键部署已包含此步骤；未完成部署请先执行{" "}
                                            <code>
                                                sh install-v2box.sh --resume
                                            </code>
                                            。
                                        </p>
                                        <NodeNetworkSetup
                                            node={node}
                                            disabled={busy || !binding.enabled}
                                        />
                                    </div>
                                </details>
                            )}
                    </div>
                )}
                <details className="node-domain-settings" open={!binding}>
                    <summary>
                        {binding ? "修改域名设置" : "设置节点域名"}
                    </summary>
                    {!roots.length ? (
                        <p>请先在 服务器与域名 中添加并验证根域名。</p>
                    ) : (
                        <form
                            className="node-domain-form"
                            onSubmit={(e) => {
                                e.preventDefault();
                                void act("bind", {
                                    node_type: node.type,
                                    node_id: node.id,
                                    credential_id: Number(root || roots[0]?.id),
                                    prefix,
                                    family,
                                    server_id: serverId
                                        ? Number(serverId)
                                        : null,
                                    entry_id:
                                        mode === "relay"
                                            ? Number(entryId)
                                            : null,
                                    entry_port:
                                        mode === "relay"
                                            ? Number(entryPort)
                                            : null,
                                });
                            }}
                        >
                            <label>
                                接入方式
                                <select
                                    aria-label="接入方式"
                                    disabled={busy}
                                    value={mode}
                                    onChange={(e) => setMode(e.target.value)}
                                >
                                    <option value="direct">直连节点</option>
                                    {node.type === "v2box" && (
                                        <option value="relay">
                                            四层中转 · TLS 在节点终止
                                        </option>
                                    )}
                                </select>
                            </label>
                            <label>
                                {mode === "relay" ? "回源服务器" : "节点服务器"}
                                <select
                                    aria-label="节点服务器"
                                    disabled={busy}
                                    value={serverId}
                                    onChange={(e) =>
                                        setServerId(e.target.value)
                                    }
                                >
                                    <option value="">
                                        为此节点新建服务器记录
                                    </option>
                                    {servers
                                        .filter((s) => s.enabled)
                                        .map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                </select>
                            </label>
                            {mode === "relay" && (
                                <>
                                    <label>
                                        共享入口域名
                                        <select
                                            aria-label="共享入口域名"
                                            required
                                            disabled={busy}
                                            value={entryId}
                                            onChange={(e) =>
                                                setEntryId(e.target.value)
                                            }
                                        >
                                            <option value="">选择入口</option>
                                            {entries.map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.domain}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        入口端口
                                        <input
                                            aria-label="入口端口"
                                            type="number"
                                            min={1}
                                            max={65535}
                                            required
                                            value={entryPort}
                                            disabled={busy}
                                            onChange={(e) =>
                                                setEntryPort(e.target.value)
                                            }
                                        />
                                    </label>
                                    <p className="muted">
                                        先在服务器与共享入口中添加入口服务器和域名。下方配置回源域名。自动证书申请须使用
                                        DNS 验证；节点监听端口保持独立。
                                    </p>
                                </>
                            )}
                            <label>
                                根域名
                                <select
                                    aria-label="根域名"
                                    disabled={busy}
                                    value={root || roots[0]?.id || ""}
                                    onChange={(e) => setRoot(e.target.value)}
                                >
                                    {roots.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.root_domain}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                子域名前缀
                                <input
                                    aria-label="子域名前缀"
                                    disabled={busy}
                                    value={prefix}
                                    maxLength={63}
                                    pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                                    placeholder="留空自动生成"
                                    onChange={(e) =>
                                        setPrefix(e.target.value.toLowerCase())
                                    }
                                />
                            </label>
                            <label>
                                地址类型
                                <select
                                    aria-label="地址类型"
                                    disabled={busy}
                                    value={family}
                                    onChange={(e) => setFamily(e.target.value)}
                                >
                                    <option value="ipv4">IPv4 / A</option>
                                    <option value="ipv6">IPv6 / AAAA</option>
                                    <option value="dual">双栈</option>
                                </select>
                            </label>
                            {prefix && (
                                <p>
                                    {prefix}.
                                    {
                                        roots.find(
                                            (c) =>
                                                String(c.id) ===
                                                (root || String(roots[0]?.id)),
                                        )?.root_domain
                                    }
                                </p>
                            )}
                            <button disabled={busy} className="primary">
                                保存域名
                            </button>
                        </form>
                    )}
                </details>
            </State>
            {adoption && binding && (
                <div>
                    <h4>接管解析预览</h4>
                    <Table
                        data={adoption.rows}
                        columns={[
                            ["name", "域名"],
                            ["type", "类型"],
                            ["content", "当前 IP"],
                        ]}
                    />
                    <p>接管后按节点上报 IP 更新，删除节点时纳入自动清理。</p>
                    <button
                        disabled={busy || !adoption.rows?.length}
                        onClick={async () => {
                            if (
                                !window.confirm(
                                    "确认将上述解析交由此节点管理？",
                                )
                            )
                                return;
                            const r = await act("adopt", {
                                id: binding.id,
                                proof: adoption.proof,
                            });
                            if (r) setAdoption(null);
                        }}
                    >
                        确认接管
                    </button>
                    <button disabled={busy} onClick={() => setAdoption(null)}>
                        取消
                    </button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
        </section>
    );
}

export function NodeDomainTools({
    credentials,
    onChanged,
}: {
    credentials: Row[];
    onChanged: () => void;
}) {
    const roots = credentials.filter((c) => c.root_domain);
    const [from, setFrom] = useState(""),
        [to, setTo] = useState(""),
        [plan, setPlan] = useState<Row | null>(null);
    const [cleanup, setCleanup] = useState<Row[] | null>(null),
        [scan, setScan] = useState<Row | null>(null),
        [page, setPage] = useState(1);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    const pending = useRef(false);
    async function act(path: string, body: Row): Promise<any> {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            return (await request<Row>(admin(`server/domains/${path}`), body))
                .data;
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    async function inspect(p: number) {
        const r = await act("inspect", {
            credential_id: Number(from),
            page: p,
        });
        if (r) {
            setScan(r);
            setPage(p);
        }
    }
    return (
        <Panel title="域名迁移与清理">
            <div className="pad">
                <div className="actions">
                    <label>
                        原根域名
                        <select
                            aria-label="原根域名"
                            value={from}
                            disabled={busy}
                            onChange={(e) => {
                                setFrom(e.target.value);
                                setPlan(null);
                                setScan(null);
                                setNotice("");
                            }}
                        >
                            <option value="">请选择</option>
                            {roots.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.root_domain}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        新根域名
                        <select
                            aria-label="新根域名"
                            value={to}
                            disabled={busy}
                            onChange={(e) => {
                                setTo(e.target.value);
                                setPlan(null);
                            }}
                        >
                            <option value="">请选择</option>
                            {roots
                                .filter((c) => String(c.id) !== from)
                                .map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.root_domain}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <button
                        disabled={busy || !from || !to || from === to}
                        onClick={async () => {
                            const p = await act("migrate", {
                                from: Number(from),
                                to: Number(to),
                            });
                            if (p) setPlan(p);
                        }}
                    >
                        预览域名迁移
                    </button>
                    <button
                        disabled={busy}
                        onClick={async () => {
                            const r = await act("cleanup", {});
                            if (r) setCleanup(r);
                        }}
                    >
                        检查待清理解析
                    </button>
                    <button disabled={busy || !from} onClick={() => inspect(1)}>
                        检查历史解析
                    </button>
                </div>
                <p className="muted">
                    迁移先创建新解析，节点地址保持不变。同步就绪后可逐节点或批量确认启用，旧托管解析至少保留
                    24 小时；仍被节点或证书引用时保留。
                </p>
                {notice && <p role="status">{notice}</p>}
                {error && <p role="alert">{error}</p>}
                {plan && (
                    <>
                        <Table
                            data={plan.rows}
                            columns={[
                                ["node_id", "节点 ID"],
                                ["old", "原域名"],
                                ["new", "新域名"],
                            ]}
                        />
                        <button
                            disabled={busy || !plan.rows?.length || plan.queued}
                            onClick={async () => {
                                const r = await act("migrate", {
                                    from: Number(from),
                                    to: Number(to),
                                    proof: plan.proof,
                                });
                                if (r?.queued) {
                                    setPlan({ ...plan, queued: true });
                                    setNotice(
                                        "新域名已加入同步队列，请在节点域名设置中确认启用。",
                                    );
                                    onChanged();
                                }
                            }}
                        >
                            确认准备新域名
                        </button>
                        {plan.queued && (
                            <button
                                disabled={busy}
                                onClick={async () => {
                                    if (
                                        !window.confirm(
                                            "确认启用本批次所有已就绪域名？普通 TLS 节点验证新证书及监听后切换；未就绪或校验失败的节点保留原配置。",
                                        )
                                    )
                                        return;
                                    const result = await act("activate-batch", {
                                        ids: plan.rows.map((r: Row) => r.id),
                                        confirm: true,
                                    });
                                    if (result) {
                                        setPlan({ ...plan, results: result });
                                        onChanged();
                                    }
                                }}
                            >
                                批量启用已就绪域名
                            </button>
                        )}
                        {plan.results && (
                            <Table
                                data={plan.results}
                                columns={[
                                    ["id", "绑定编号"],
                                    [
                                        "success",
                                        "结果",
                                        (r) =>
                                            r.success
                                                ? "已切换"
                                                : r.message || "未切换",
                                    ],
                                ]}
                            />
                        )}
                    </>
                )}
                {cleanup && (
                    <>
                        <h3>待清理解析</h3>
                        <Table
                            data={cleanup}
                            columns={[
                                ["domain", "域名"],
                                ["type", "类型"],
                                [
                                    "delete_after",
                                    "计划清理",
                                    (r) => logTime(r.delete_after),
                                ],
                                [
                                    "status",
                                    "状态",
                                    (r) => domainStatus[r.status] || r.status,
                                ],
                                [
                                    "id",
                                    "操作",
                                    (r) => (
                                        <button
                                            disabled={busy}
                                            onClick={async () => {
                                                const rows = await act(
                                                    "cleanup",
                                                    { id: r.id },
                                                );
                                                if (rows) setCleanup(rows);
                                            }}
                                        >
                                            重试清理
                                        </button>
                                    ),
                                ],
                            ]}
                        />
                    </>
                )}
                {scan && (
                    <>
                        <h3>历史解析检查</h3>
                        <p>
                            未关联节点不代表无用途。删除前请确认未用于网站、邮件或其他服务；有归属备注的记录不在此处清理。
                        </p>
                        <Table
                            data={scan.rows}
                            columns={[
                                ["domain", "域名"],
                                ["type", "类型"],
                                ["content", "IP"],
                                [
                                    "inUse",
                                    "状态",
                                    (r) =>
                                        r.inUse
                                            ? "使用中"
                                            : r.managed
                                              ? "系统托管"
                                              : "待人工核查",
                                ],
                                [
                                    "cleanupToken",
                                    "操作",
                                    (r) =>
                                        r.cleanupToken ? (
                                            <button
                                                disabled={busy}
                                                onClick={async () => {
                                                    if (
                                                        !window.confirm(
                                                            `永久删除 ${r.domain} 的 ${r.type} 解析（${r.content}）？请确认它确属历史部署且已无用途。`,
                                                        )
                                                    )
                                                        return;
                                                    const ok = await act(
                                                        "remove-historical",
                                                        {
                                                            token: r.cleanupToken,
                                                            domain: r.domain,
                                                            confirm: true,
                                                        },
                                                    );
                                                    if (ok) await inspect(page);
                                                }}
                                            >
                                                删除此解析
                                            </button>
                                        ) : (
                                            "—"
                                        ),
                                ],
                            ]}
                        />
                        <div className="actions">
                            <button
                                disabled={busy || page <= 1}
                                onClick={() => inspect(page - 1)}
                            >
                                上一页
                            </button>
                            <span>
                                {page} / {scan.pages}
                            </span>
                            <button
                                disabled={busy || page >= scan.pages}
                                onClick={() => inspect(page + 1)}
                            >
                                下一页
                            </button>
                        </div>
                    </>
                )}
            </div>
        </Panel>
    );
}
