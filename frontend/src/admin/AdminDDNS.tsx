import {
    NodeDomainTools,
    domainStatus,
    certificateTransitionStatus,
} from "./NodeDomains";
import { TableViewport } from "../shared/ui";
import { Pager } from "../shared/ui";
import { AdminLogTimeZone, logTime as date } from "./admin-log-time";
import { useMemo, useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, Panel, State, useData } from "../shared/ui";
const labels: Record<string, string> = {
    ...domainStatus,
    domain_activated: "连接域名已切换",
    certificate_transition_pending: "开始验证新域名证书",
    certificate_transition_failed: "域名切换未完成，原配置已保留",
    domain_prepared: "新域名已准备",
    dns_removed: "托管解析已清理",
    historical_dns_removed: "历史解析已清理",
    ready: "可用",
    manual_address_enabled: "已改为手动维护",
    awaiting_report: "等待有效 IP 上报",
    healthy: "正常",
    credential_rejected: "Token 无效或权限不足，已暂停",
    credential_unreadable: "凭据无法解密，已暂停",
    rate_limited: "服务限流，等待重试",
    provider_unavailable: "Cloudflare 暂不可用",
    configuration_rejected: "DNS 配置被拒绝，已暂停",
    ambiguous_records: "同名记录不唯一，已暂停",
    unexpected_record: "DNS 记录异常，已暂停",
    provider_rejected: "Cloudflare 拒绝请求，已暂停",
    network_error: "网络错误，等待重试",
    node_missing: "节点已删除，已暂停",
    dns_updated: "DNS 已更新",
    configuration_saved: "配置已保存",
    configuration_removed: "配置已删除",
    report_key_rotated: "上报密钥已更换",
};

export function AdminDDNS() {
    const [pageSize, setPageSize] = useState(20);
    const [domainPage, setDomainPage] = useState(1),
        [domainQuery, setDomainQuery] = useState("");
    const pending = useRef(false);
    const data = useData<Row>(admin("server/ddns/fetch"));
    const [editing, setEditing] = useState<Row | null>(null),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
    const [page, setPage] = useState(1),
        [filter, setFilter] = useState("");
    const events = useData<Row[]>(
        admin(
            `server/ddns/events?page=${page}&pageSize=${pageSize}${filter ? `&assignmentId=${filter}` : ""}`,
        ),
    );
    const credentials: Row[] = data.data?.credentials || [],
        assignments: Row[] = data.data?.assignments || [];
    const serverNames = useMemo(
        () =>
            new Map<number, string>(
                (data.data?.servers || []).map((s: Row) => [
                    Number(s.id),
                    s.name,
                ]),
            ),
        [data.data?.servers],
    );
    const matching = assignments.filter((a) =>
        String(a.domain)
            .toLowerCase()
            .includes(domainQuery.trim().toLowerCase()),
    );
    const currentDomainPage = Math.min(
        domainPage,
        Math.max(1, Math.ceil(matching.length / 20)),
    );
    async function action(path: string, payload: Row) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<Row>(
                admin(`server/ddns/${path}`),
                payload,
            );
            data.reload();
            events.reload();
            return result.data;
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    function edit(row: Row) {
        setEditing({ ...row, token: "" });
        setError("");
    }
    return (
        <>
            <p className="pad muted">
                维护 Cloudflare 根域名、节点解析与同步记录。共享入口域名在{" "}
                <a href="#/servers">服务器管理</a> 中配置；节点的域名切换在{" "}
                <a href="#/nodes">部署与接入</a> 中完成。
            </p>
            <Panel
                title="域名与解析"
                actions={
                    <button
                        onClick={() => {
                            data.reload();
                            events.reload();
                        }}
                    >
                        刷新状态
                    </button>
                }
            >
                <div className="pad">
                    <p>
                        Token 在面板加密保存。服务器仅持有独立上报凭据，每 5
                        分钟上报公网 IP；面板更新 A / AAAA 记录，关闭 Cloudflare
                        代理。
                    </p>
                    <p className="muted">
                        为专用域名配置 DNS 编辑及 Zone
                        读取权限。托管解析在删除节点后自动清理；旧版未托管解析保留，可在历史解析检查中核查。
                    </p>
                </div>
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <State {...data} retry={data.reload}>
                    <div className="pad">
                        <h3>Cloudflare 凭据</h3>
                        <button onClick={() => edit({ name: "", zone_id: "" })}>
                            新增凭据
                        </button>
                        <TableViewport>
                            <table>
                                <thead>
                                    <tr>
                                        <th>名称</th>
                                        <th>根域名 / Zone ID</th>
                                        <th>状态</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {credentials.map((c) => (
                                        <tr key={c.id}>
                                            <td>{c.name}</td>
                                            <td>
                                                {c.root_domain ||
                                                    "尚未验证根域名"}
                                                <br />
                                                {c.zone_id}
                                            </td>
                                            <td>
                                                {labels[c.status] || c.status}
                                                {c.next_run > 0 &&
                                                    ` · ${date(c.next_run)}`}
                                            </td>
                                            <td>
                                                <button onClick={() => edit(c)}>
                                                    编辑
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (
                                                            window.confirm(
                                                                "删除此凭据？",
                                                            )
                                                        )
                                                            void action(
                                                                "credentials/drop",
                                                                { id: c.id },
                                                            );
                                                    }}
                                                >
                                                    删除
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableViewport>
                        <h3>解析状态</h3>
                        <p className="muted">
                            节点域名在 <a href="#/nodes">节点管理</a>{" "}
                            的“部署与接入”中配置；共享入口在{" "}
                            <a href="#/servers">服务器管理</a> 中管理。
                        </p>
                        <label>
                            搜索域名
                            <input
                                type="search"
                                value={domainQuery}
                                onChange={(e) => {
                                    setDomainQuery(e.target.value);
                                    setDomainPage(1);
                                }}
                            />
                        </label>
                        <TableViewport>
                            <table>
                                <thead>
                                    <tr>
                                        <th>域名 / 用途</th>
                                        <th>服务器</th>
                                        <th>状态</th>
                                        <th>最近成功</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matching
                                        .slice(
                                            (currentDomainPage - 1) * 20,
                                            currentDomainPage * 20,
                                        )
                                        .map((a) => (
                                            <tr key={a.id}>
                                                <td>
                                                    {a.domain}
                                                    <br />
                                                    <small className="muted">
                                                        {a.purpose === "entry"
                                                            ? "中转入口"
                                                            : "节点回源 / 直连"}
                                                    </small>
                                                </td>
                                                <td>
                                                    {serverNames.get(
                                                        Number(a.server_id),
                                                    ) || "尚未关联"}
                                                </td>
                                                <td>
                                                    {a.enabled
                                                        ? labels[a.status] ||
                                                          a.status
                                                        : "已停用"}
                                                    {certificateTransitionStatus[
                                                        a.tls_transition_state
                                                    ] && (
                                                        <p className="muted">
                                                            {
                                                                certificateTransitionStatus[
                                                                    a
                                                                        .tls_transition_state
                                                                ]
                                                            }
                                                        </p>
                                                    )}
                                                </td>
                                                <td>{date(a.last_success)}</td>
                                            </tr>
                                        ))}
                                    {!matching.length && (
                                        <tr>
                                            <td colSpan={4}>
                                                {assignments.length
                                                    ? "没有匹配的域名。"
                                                    : "暂无托管解析，请先配置节点域名或服务器入口。"}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </TableViewport>
                        <Pager
                            page={currentDomainPage}
                            total={matching.length}
                            size={20}
                            onChange={setDomainPage}
                        />
                    </div>
                </State>
            </Panel>
            <NodeDomainTools
                credentials={credentials}
                onChanged={data.reload}
            />
            <Panel title="DDNS 日志">
                <AdminLogTimeZone />
                <div className="pad">
                    <p className="muted">
                        默认保留 30
                        天，可在系统日志页面调整；只记录状态变化和实际 DNS
                        更新。
                    </p>
                    <label>
                        域名筛选
                        <select
                            aria-label="日志域名筛选"
                            value={filter}
                            onChange={(e) => {
                                setFilter(e.target.value);
                                setPage(1);
                            }}
                        >
                            <option value="">全部</option>
                            {assignments.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.domain}
                                </option>
                            ))}
                        </select>
                    </label>
                    <State {...events} retry={events.reload}>
                        <TableViewport>
                            <table>
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>绑定编号</th>
                                        <th>事件</th>
                                        <th>HTTP</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.data?.map((e) => (
                                        <tr key={e.id}>
                                            <td>{date(e.created_at)}</td>
                                            <td>{e.assignment_id}</td>
                                            <td>{labels[e.code] || e.code}</td>
                                            <td>{e.http_status || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableViewport>
                    </State>
                    <Pager
                        page={page}
                        total={events.total}
                        size={pageSize}
                        loading={events.loading}
                        onChange={setPage}
                        onSizeChange={(size) => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </Panel>
            {editing && (
                <Modal
                    title="Cloudflare 凭据"
                    dismissible={!busy}
                    close={() => {
                        if (!busy) setEditing(null);
                    }}
                >
                    <form
                        className="pad"
                        onSubmit={async (e) => {
                            e.preventDefault();
                            if (
                                await action("credentials/save", {
                                    id: editing.id,
                                    name: editing.name,
                                    zone_id: editing.zone_id,
                                    root_domain:
                                        editing.root_domain || undefined,
                                    token: editing.token || undefined,
                                })
                            )
                                setEditing(null);
                        }}
                    >
                        <label>
                            名称
                            <input
                                required
                                value={editing.name}
                                onChange={(e) =>
                                    setEditing({
                                        ...editing,
                                        name: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <label>
                            根域名
                            <input
                                aria-label="根域名"
                                required={!editing.id}
                                placeholder="example.com"
                                value={editing.root_domain || ""}
                                onChange={(e) =>
                                    setEditing({
                                        ...editing,
                                        root_domain: e.target.value
                                            .trim()
                                            .toLowerCase(),
                                    })
                                }
                            />
                        </label>
                        <p className="muted">
                            保存时校验 Zone 与根域名。Token 仅需对应 Zone
                            的读取及 DNS 编辑权限，不会下发至节点。
                        </p>
                        <label>
                            Zone ID
                            <input
                                required
                                pattern="[a-fA-F0-9]{32}"
                                value={editing.zone_id}
                                onChange={(e) =>
                                    setEditing({
                                        ...editing,
                                        zone_id: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <label>
                            API Token
                            <input
                                type="password"
                                autoComplete="new-password"
                                required={!editing.id}
                                value={editing.token}
                                onChange={(e) =>
                                    setEditing({
                                        ...editing,
                                        token: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <p className="muted">
                            已保存的 Token 不回显；留空保留原值。替换 Token
                            后恢复认证失败的同步。
                        </p>
                        {error && <p role="alert">{error}</p>}
                        <button className="primary" disabled={busy}>
                            保存
                        </button>
                    </form>
                </Modal>
            )}
        </>
    );
}
