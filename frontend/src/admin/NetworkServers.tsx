import { domainStatus } from "./NodeDomains";
import { AdminSwitch } from "./admin-switch";
import { useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, Panel, Table } from "../shared/ui";
import { logTime } from "./admin-log-time";

export function NetworkServers({
    data,
    reload,
}: {
    data: Row;
    reload: () => void;
}) {
    const servers: Row[] = data.servers || [];
    const entries: Row[] = (data.assignments || []).filter(
        (a: Row) => a.purpose === "entry",
    );
    const roots: Row[] = (data.credentials || []).filter(
        (a: Row) => a.root_domain,
    );
    const [editing, setEditing] = useState<Row | null>(null);
    const [kind, setKind] = useState("save");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [command, setCommand] = useState("");
    const [adoption, setAdoption] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    async function act(path: string, body: Row, domain = false) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const r = await request<Row>(
                admin(`server/${domain ? "domains" : "network"}/${path}`),
                body,
            );
            if (path === "adopt")
                setAdoption(r.data?.rows ? { ...r.data, id: body.id } : null);
            if (r.data?.command) setCommand(r.data.command);
            reload();
            if (path === "retry") setNotice("已安排 DNS 同步，将由下一轮后台调度执行。同步使用服务器最近上报的 IP，不重启节点或切换线路。");
            setEditing(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <>
            <Panel
                title="服务器与共享入口"
                actions={
                    <div className="actions">
                        <button
                            onClick={() => {
                                setKind("save");
                                setEditing({
                                    name: "",
                                    family: "ipv4",
                                    enabled: true,
                                });
                            }}
                        >
                            添加服务器
                        </button>
                        <button
                            disabled={!servers.length || !roots.length}
                            onClick={() => {
                                setKind("entry");
                                setEditing({
                                    server_id: servers[0]?.id,
                                    credential_id: roots[0]?.id,
                                    prefix: "",
                                    family: "ipv4",
                                });
                            }}
                        >
                            添加入口域名
                        </button>
                    </div>
                }
            >
                <div className="pad">
                    <p className="muted">
                        每台实际服务器维护一条记录。入口服务器上报入口
                        IP，节点服务器上报回源
                        IP；同一入口可被不同端口的节点共享。
                    </p>
                    <Table
                        data={servers}
                        columns={[
                            ["name", "服务器"],
                            ["family", "地址类型"],
                            ["ipv4", "IPv4"],
                            ["ipv6", "IPv6"],
                            [
                                "enabled",
                                "状态",
                                (r: Row) => (r.enabled ? "已启用" : "已停用"),
                            ],
                            [
                                "ipv4_seen_at",
                                "最近上报",
                                (r: Row) =>
                                    Math.max(r.ipv4_seen_at, r.ipv6_seen_at)
                                        ? logTime(
                                              Math.max(
                                                  r.ipv4_seen_at,
                                                  r.ipv6_seen_at,
                                              ),
                                          )
                                        : "尚未上报",
                            ],
                            [
                                "actions",
                                "操作",
                                (r: Row) => (
                                    <div className="actions">
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                setKind("save");
                                                setEditing(r);
                                            }}
                                        >
                                            编辑
                                        </button>
                                        <button
                                            disabled={busy || !r.enabled}
                                            onClick={() =>
                                                act("enroll", { id: r.id })
                                            }
                                        >
                                            配置服务器上报
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                if (
                                                    confirm(
                                                        `删除服务器「${r.name}」？有关联域名时将禁止删除。`,
                                                    )
                                                )
                                                    act("drop", { id: r.id });
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ),
                            ],
                        ]}
                    />
                    <h3>共享入口域名</h3>
                    <Table
                        data={entries}
                        columns={[
                            ["domain", "入口域名"],
                            [
                                "server_id",
                                "入口服务器",
                                (r: Row) =>
                                    servers.find((s) => s.id === r.server_id)
                                        ?.name || "—",
                            ],
                            [
                                "status",
                                "解析状态",
                                (r: Row) => domainStatus[r.status] || r.status,
                            ],
                            [
                                "references",
                                "关联线路",
                                (r: Row) =>
                                    r.connection_count ?? (data.assignments || []).filter(
                                        (a: Row) => a.entry_id === r.id,
                                    ).length,
                            ],
                            [
                                "actions",
                                "操作",
                                (r: Row) => (
                                    <div className="actions">
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                setKind("entry");
                                                setEditing({
                                                    ...r,
                                                    prefix: r.domain.slice(
                                                        0,
                                                        -(
                                                            roots.find(
                                                                (c) =>
                                                                    c.id ===
                                                                    r.credential_id,
                                                            )?.root_domain
                                                                ?.length || 0
                                                        ) - 1,
                                                    ),
                                                });
                                            }}
                                        >
                                            编辑
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                act("retry", { id: r.id }, true)
                                            }
                                        >
                                            重试 DNS 同步
                                        </button>
                                        {r.status === "ownership_conflict" && (
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    act(
                                                        "adopt",
                                                        { id: r.id },
                                                        true,
                                                    )
                                                }
                                            >
                                                预览现有解析
                                            </button>
                                        )}
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                if (
                                                    confirm(
                                                        "删除此入口域名及其托管解析？存在关联节点时禁止删除。",
                                                    )
                                                )
                                                    act("entry-drop", {
                                                        id: r.id,
                                                    });
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ),
                            ],
                        ]}
                    />
                    <p className="muted">
                        已有节点的一键部署会配置所属服务器的上报。独立入口服务器只需配置上报，不安装或重启
                        V2Box。
                    </p>
                </div>
            </Panel>
            {adoption && (
                <Modal
                    title="接管入口解析"
                    close={() => !busy && setAdoption(null)}
                >
                    <Table
                        data={adoption.rows}
                        columns={[
                            ["name", "域名"],
                            ["type", "类型"],
                            ["content", "当前 IP"],
                        ]}
                    />
                    <p>
                        确认以上记录属于所选入口服务器后接管，后续仅按入口服务器上报的
                        IP 更新。
                    </p>
                    <button
                        disabled={busy || !adoption.rows?.length}
                        onClick={() =>
                            act(
                                "adopt",
                                { id: adoption.id, proof: adoption.proof },
                                true,
                            )
                        }
                    >
                        确认接管
                    </button>
                    {error && <p role="alert">{error}</p>}
                </Modal>
            )}
            {command && (
                <Modal title="配置服务器 IP 上报" close={() => setCommand("")}>
                    <p>
                        请在选中的实际服务器执行。授权限时、一次有效；配置失败时可重复执行原命令恢复。
                    </p>
                    <pre className="admin-network-command">{command}</pre>
                    <button
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(command);
                            } catch {
                                setError("复制失败，请手动选择命令复制");
                            }
                        }}
                    >
                        复制命令
                    </button>
                </Modal>
            )}
            {editing && (
                <Modal
                    title={kind === "save" ? "服务器信息" : "入口域名"}
                    close={() => !busy && setEditing(null)}
                >
                    <form
                        className="node-domain-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            act(
                                kind,
                                kind === "save"
                                    ? {
                                          id: editing.id,
                                          name: editing.name,
                                          family: editing.family,
                                          enabled: !!editing.enabled,
                                      }
                                    : {
                                          id: editing.id,
                                          server_id: Number(editing.server_id),
                                          credential_id: Number(
                                              editing.credential_id,
                                          ),
                                          prefix: editing.prefix,
                                          family: editing.family,
                                      },
                            );
                        }}
                    >
                        {kind === "save" ? (
                            <>
                                <label>
                                    服务器名称
                                    <input
                                        required
                                        maxLength={100}
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
                                    允许 IP 上报与解析同步
                                    <AdminSwitch
                                        label="允许 IP 上报与解析同步"
                                        checked={!!editing.enabled}
                                        onChange={async (checked) => {
                                            setEditing({
                                                ...editing,
                                                enabled: checked,
                                            });
                                        }}
                                    />
                                </label>
                            </>
                        ) : (
                            <>
                                <label>
                                    入口服务器
                                    <select
                                        value={editing.server_id}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                server_id: e.target.value,
                                            })
                                        }
                                    >
                                        {servers
                                            .filter((s) => s.enabled)
                                            .map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                    </select>
                                </label>
                                <label>
                                    根域名
                                    <select
                                        value={editing.credential_id}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                credential_id: e.target.value,
                                            })
                                        }
                                    >
                                        {roots.map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.root_domain}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    子域名前缀
                                    <input
                                        required
                                        maxLength={63}
                                        pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                                        value={editing.prefix}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                prefix: e.target.value.toLowerCase(),
                                            })
                                        }
                                    />
                                </label>
                            </>
                        )}
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
                                <option value="ipv4">IPv4</option>
                                <option value="ipv6">IPv6</option>
                                <option value="dual">双栈</option>
                            </select>
                        </label>
                        <button className="primary" disabled={busy}>
                            保存
                        </button>
                        {kind === "save" && editing.id && (
                            <button
                                type="button"
                                disabled={busy || !editing.enabled}
                                onClick={() => {
                                    if (
                                        confirm(
                                            "重置会使此服务器的旧上报凭据立即失效。需重新执行生成的命令，现有 DNS 记录保留。确认继续？",
                                        )
                                    )
                                        act("reset", {
                                            id: editing.id,
                                            confirm: true,
                                        });
                                }}
                            >
                                重置上报凭据
                            </button>
                        )}
                        {error && <p role="alert">{error}</p>}
                    </form>
                </Modal>
            )}
            {error && !editing && !adoption && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
        </>
    );
}
