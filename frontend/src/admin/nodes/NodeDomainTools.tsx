import { useRef, useState } from "react";
import { admin, request, type Row } from "../../shared/api";
import { Panel, Table } from "../../shared/ui";
import { logTime } from "../admin-log-time";
import { domainStatus } from "./domain-status";

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
                        type="button"
                        className={plan ? undefined : "primary"}
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
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                            const r = await act("cleanup", {});
                            if (r) setCleanup(r);
                        }}
                    >
                        检查待清理解析
                    </button>
                    <button type="button" disabled={busy || !from} onClick={() => inspect(1)}>
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
                            type="button"
                            className={plan.queued ? undefined : "primary"}
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
                                type="button"
                                className="primary"
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
                                            type="button"
                                            className="danger"
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
                                                type="button"
                                                className="danger"
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
