import { useEffect, useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Panel, State, Table, useData } from "../shared/ui";
import { logTime } from "./admin-log-time";

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

export function NodeDomainBinding({
    node,
    onChanged,
}: {
    node: Row;
    onChanged?: () => void;
}) {
    const data = useData<Row>(admin("server/ddns/fetch"));
    const roots: Row[] = (data.data?.credentials || []).filter(
        (c: Row) => c.root_domain,
    );
    const binding: Row | undefined = (data.data?.assignments || []).find(
        (a: Row) => a.node_type === node.type && a.node_id === node.id,
    );
    const [root, setRoot] = useState(""),
        [prefix, setPrefix] = useState(""),
        [family, setFamily] = useState("ipv4");
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    const [adoption, setAdoption] = useState<Row | null>(null);
    const pending = useRef(false);
    useEffect(() => {
        if (binding) {
            setRoot(String(binding.credential_id));
            setFamily(binding.family);
            const c = (data.data?.credentials || []).find(
                (r: Row) => r.id === binding.credential_id,
            );
            if (c?.root_domain && binding.domain.endsWith("." + c.root_domain))
                setPrefix(binding.domain.slice(0, -c.root_domain.length - 1));
        }
    }, [binding?.id, binding?.domain, binding?.family]);
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
                {!roots.length ? (
                    <p>请先在 Cloudflare DDNS 中添加并验证根域名。</p>
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
                            });
                        }}
                    >
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
                {binding && (
                    <div>
                        <p>目标域名：{binding.domain}</p>
                        <p>
                            当前地址：{binding.published_domain || node.host} ·{" "}
                            {domainStatus[binding.status] || binding.status}
                        </p>
                        <p>
                            IPv4：{binding.ipv4 || "—"} · IPv6：
                            {binding.ipv6 || "—"}
                        </p>
                        <div className="actions">
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

                            <button disabled={busy} onClick={data.reload}>
                                检查解析状态
                            </button>
                            <button
                                disabled={busy || !binding.managed}
                                onClick={() => act("retry", { id: binding.id })}
                            >
                                重试同步
                            </button>
                            {binding.status === "ready_to_switch" && (
                                <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                `确认将节点连接地址切换为 ${binding.domain}？请先确认解析和 TLS 证书可用。证书名称与 Reality SNI 保持不变，旧托管解析至少保留 24 小时。`,
                                            )
                                        )
                                            void act("activate", {
                                                id: binding.id,
                                                confirm: true,
                                            });
                                    }}
                                >
                                    启用新域名
                                </button>
                            )}
                        </div>
                    </div>
                )}
                <p className="muted">
                    解析使用 DNS
                    only。域名同步成功后启用新地址；同址子节点一并更新。证书与
                    Reality SNI 独立配置。
                </p>
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
                                            "确认启用本批次所有已就绪域名？请先核实 TLS 证书。未就绪或校验失败的节点保持原地址。",
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
