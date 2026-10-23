import { NodeNetworkSetup } from "./NodeNetworkSetup";
import {
    NodeDomainBinding,
    NodeDomainTools,
    domainStatus,
    certificateTransitionStatus,
} from "./NodeDomains";
import { TableViewport } from "../shared/ui";
import { Pager } from "../shared/ui";
import { AdminLogTimeZone, logTime as date } from "./admin-log-time";
import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, Panel, State, useData } from "../shared/ui";
import { nodeReportCommand } from "./node-deployment";
const labels: Record<string, string> = {
    ...domainStatus,
    domain_activated: "连接域名已切换",
    certificate_transition_pending: "开始验证新域名证书",
    certificate_transition_failed: "域名切换未完成，原配置已保留",
    domain_prepared: "新域名已准备",
    dns_removed: "托管解析已清理",
    historical_dns_removed: "历史解析已清理",
    ready: "可用",
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
    const [domainNode, setDomainNode] = useState<Row | null>(null);
    const data = useData<Row>(admin("server/ddns/fetch"));
    const nodes = useData<Row[]>(admin("server/manage/getNodes"));
    const [editing, setEditing] = useState<Row | null>(null),
        [kind, setKind] = useState(""),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [deployment, setDeployment] = useState<Row | null>(null);
    const [page, setPage] = useState(1),
        [filter, setFilter] = useState("");
    const events = useData<Row[]>(
        admin(
            `server/ddns/events?page=${page}&pageSize=${pageSize}${filter ? `&assignmentId=${filter}` : ""}`,
        ),
    );
    const credentials: Row[] = data.data?.credentials || [],
        assignments: Row[] = data.data?.assignments || [];
    async function action(path: string, payload: Row) {
        if (busy) return;
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
            setBusy(false);
        }
    }
    function edit(k: string, row: Row) {
        setKind(k);
        setEditing({ ...row, token: "" });
        setError("");
    }
    return (
        <>
            <Panel
                title="Cloudflare DDNS"
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
                        Token 在面板加密保存。节点仅持有独立上报密钥，每 5
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
                        <button
                            onClick={() =>
                                edit("credentials", { name: "", zone_id: "" })
                            }
                        >
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
                                                <button
                                                    onClick={() =>
                                                        edit("credentials", c)
                                                    }
                                                >
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
                        <h3>节点绑定</h3>
                        <button
                            disabled={!credentials.some((c) => c.root_domain)}
                            onClick={() => setDomainNode({ select: true })}
                        >
                            配置节点域名
                        </button>
                        <TableViewport>
                            <table>
                                <thead>
                                    <tr>
                                        <th>节点 / 域名</th>
                                        <th>公网 IP / 上报时间</th>
                                        <th>状态 / 最近成功</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignments.map((a) => (
                                        <tr key={a.id}>
                                            <td>
                                                {a.node_type} #{a.node_id}
                                                <br />
                                                {a.domain}
                                                <br />
                                                {
                                                    credentials.find(
                                                        (c) =>
                                                            c.id ===
                                                            a.credential_id,
                                                    )?.name
                                                }
                                            </td>
                                            <td>
                                                {a.ipv4 || "—"} ·{" "}
                                                {date(a.ipv4_seen_at)}
                                                <br />
                                                {a.ipv6 || "—"} ·{" "}
                                                {date(a.ipv6_seen_at)}
                                            </td>
                                            <td>
                                                {a.enabled
                                                    ? labels[a.status] ||
                                                      a.status
                                                    : "已停用"}
                                                <br />
                                                {date(a.last_success)}
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
                                            <td>
                                                <button
                                                    onClick={() =>
                                                        a.managed
                                                            ? setDomainNode({
                                                                  type: a.node_type,
                                                                  id: a.node_id,
                                                                  host: a.published_domain,
                                                              })
                                                            : edit(
                                                                  "assignments",
                                                                  a,
                                                              )
                                                    }
                                                >
                                                    编辑 / 恢复
                                                </button>
                                                {a.node_type === "v2box" ? (
                                                    <NodeNetworkSetup
                                                        node={{ id: a.node_id }}
                                                        disabled={
                                                            busy || !a.enabled
                                                        }
                                                    />
                                                ) : (
                                                    <button
                                                        disabled={
                                                            busy || !a.enabled
                                                        }
                                                        onClick={async () => {
                                                            if (
                                                                !window.confirm(
                                                                    "生成新密钥将立即撤销旧密钥，需要在节点重新配置上报。继续？",
                                                                )
                                                            )
                                                                return;
                                                            const r =
                                                                await action(
                                                                    "assignments/rotate",
                                                                    {
                                                                        id: a.id,
                                                                    },
                                                                );
                                                            if (r)
                                                                setDeployment({
                                                                    ...r,
                                                                    domain: a.domain,
                                                                });
                                                        }}
                                                    >
                                                        配置节点上报
                                                    </button>
                                                )}
                                                <button
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (
                                                            window.confirm(
                                                                "删除绑定并撤销上报密钥？系统托管且无引用的解析将进入清理队列，未托管解析保留。",
                                                            )
                                                        )
                                                            void action(
                                                                "assignments/drop",
                                                                { id: a.id },
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
                    </div>
                </State>
            </Panel>
            <NodeDomainTools
                credentials={credentials}
                onChanged={data.reload}
            />
            {domainNode && (
                <Modal title="节点域名与解析" close={() => setDomainNode(null)}>
                    <div className="pad">
                        {domainNode.select ? (
                            <label>
                                选择节点
                                <select
                                    aria-label="配置节点域名"
                                    value=""
                                    onChange={(e) => {
                                        const n = nodes.data?.find(
                                            (n) =>
                                                `${n.type}:${n.id}` ===
                                                e.target.value,
                                        );
                                        if (n) setDomainNode(n);
                                    }}
                                >
                                    <option value="">选择父节点配置域名</option>
                                    {nodes.data
                                        ?.filter((n) => !n.parent_id)
                                        .map((n) => (
                                            <option
                                                key={`${n.type}:${n.id}`}
                                                value={`${n.type}:${n.id}`}
                                            >
                                                {n.name} · #{n.id}
                                            </option>
                                        ))}
                                </select>
                            </label>
                        ) : (
                            <NodeDomainBinding
                                node={domainNode}
                                onChanged={data.reload}
                            />
                        )}
                    </div>
                </Modal>
            )}
            <Panel title="DDNS 日志">
                <AdminLogTimeZone />
                <div className="pad">
                    <p className="muted">
                        默认保留 30
                        天，可在系统日志页面调整；只记录状态变化和实际 DNS
                        更新。
                    </p>
                    <label>
                        节点筛选
                        <select
                            aria-label="日志节点筛选"
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
                    title={
                        kind === "credentials"
                            ? "Cloudflare 凭据"
                            : "DDNS 节点绑定"
                    }
                    close={() => setEditing(null)}
                >
                    <form
                        className="pad"
                        onSubmit={async (e) => {
                            e.preventDefault();
                            const payload =
                                kind === "credentials"
                                    ? {
                                          id: editing.id,
                                          name: editing.name,
                                          zone_id: editing.zone_id,
                                          root_domain:
                                              editing.root_domain || undefined,
                                          token: editing.token || undefined,
                                      }
                                    : {
                                          id: editing.id,
                                          credential_id: Number(
                                              editing.credential_id,
                                          ),
                                          node_type: editing.node_type,
                                          node_id: Number(editing.node_id),
                                          domain: editing.domain,
                                          family: editing.family,
                                          enabled: Boolean(editing.enabled),
                                      };
                            if (await action(`${kind}/save`, payload))
                                setEditing(null);
                        }}
                    >
                        {kind === "credentials" ? (
                            <>
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
                                    保存时校验 Zone 与根域名。Token 仅需对应
                                    Zone 的读取及 DNS 编辑权限，不会下发至节点。
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
                                    已保存的 Token 不回显；留空保留原值。替换
                                    Token 后恢复认证失败的同步。
                                </p>
                            </>
                        ) : (
                            <>
                                <label>
                                    节点
                                    <select
                                        aria-label="DDNS 节点"
                                        required
                                        disabled={!!editing.id}
                                        value={
                                            editing.node_id
                                                ? `${editing.node_type}:${editing.node_id}`
                                                : ""
                                        }
                                        onChange={(e) => {
                                            const [type, id] =
                                                e.target.value.split(":");
                                            setEditing({
                                                ...editing,
                                                node_type: type,
                                                node_id: Number(id),
                                            });
                                        }}
                                    >
                                        <option value="">请选择节点</option>
                                        {nodes.data?.map((n) => (
                                            <option
                                                key={`${n.type}:${n.id}`}
                                                value={`${n.type}:${n.id}`}
                                            >
                                                {n.name} ({n.type} #{n.id})
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {nodes.error && (
                                    <p role="alert">{nodes.error}</p>
                                )}
                                <label>
                                    凭据
                                    <select
                                        value={editing.credential_id}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                credential_id: Number(
                                                    e.target.value,
                                                ),
                                            })
                                        }
                                    >
                                        {credentials.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    专用域名
                                    <input
                                        required
                                        value={editing.domain}
                                        placeholder="node.example.com"
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                domain: e.target.value.trim(),
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    地址类型
                                    <select
                                        value={editing.family}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                family: e.target.value,
                                            })
                                        }
                                    >
                                        <option value="ipv4">IPv4 / A</option>
                                        <option value="ipv6">
                                            IPv6 / AAAA
                                        </option>
                                        <option value="dual">双栈</option>
                                    </select>
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(editing.enabled)}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                enabled: e.target.checked,
                                            })
                                        }
                                    />{" "}
                                    启用
                                </label>
                                <p className="muted">
                                    保存会恢复此绑定的同步；凭据限流和认证暂停仍需等待或更换
                                    Token。更改地址类型后需重新配置节点上报。
                                </p>
                            </>
                        )}
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        <button className="primary" disabled={busy}>
                            保存
                        </button>
                    </form>
                </Modal>
            )}
            {deployment && (
                <Modal title="配置节点上报" close={() => setDeployment(null)}>
                    <div className="pad">
                        <p>
                            在 {deployment.domain} 的节点服务器执行以下命令（需
                            Python
                            3），按提示粘贴上报密钥。密钥仅显示本次，关闭后不能再次查看。
                        </p>
                        <textarea
                            aria-label="IP 上报配置命令"
                            readOnly
                            rows={4}
                            value={nodeReportCommand(deployment.family)}
                        />
                        <label>
                            独立上报密钥
                            <input
                                readOnly
                                autoComplete="off"
                                value={deployment.reportToken}
                            />
                        </label>
                        <p className="muted">
                            密钥仅允许此节点上报 IP，不具备 Cloudflare
                            或面板管理权限。
                        </p>
                    </div>
                </Modal>
            )}
        </>
    );
}
