import { AdminRowMenu } from "./AdminRowMenu";
import { NodeApiMigration } from "./NodeApiMigration";
import { ServerForwarding, serverPurpose } from "./ServerForwarding";
import {
    ServerTrafficFields,
    trafficDraft,
    trafficPayload,
} from "./ServerTrafficFields";
import { ServerTrafficSummary, ServerStatus, quotaState, serverReportStatus } from "./ServerTrafficSummary";
import { ServerTrafficBudgets } from "./ServerTrafficBudgets";
import {
    ServerEntryDomains,
    ServerEntryFields,
    entryPayload,
} from "./ServerEntryDomains";
import { AdminSwitch } from "./admin-switch";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { admin, request, rows, bytes, type Row } from "../shared/api";
import { Modal, Panel, Table, State, useData } from "../shared/ui";
import { logTime } from "./admin-log-time";

export function NetworkServers({
    data,
    reload,
}: {
    data: Row;
    reload: () => void;
}) {
    const servers: Row[] = data.servers || [];
    const sectionId = useId();
    function jumpTo(section: string) {
        const target = document.getElementById(`${sectionId}-${section}`);
        target?.scrollIntoView?.({ behavior: "auto", block: "start" });
        target?.focus({ preventScroll: true });
    }

    const budgets = useData<Row[]>(admin("server/traffic-budget/fetch"));
    const budgetMap = useMemo(() => {
        const result = new Map<number, Row>(),
            owners = new Map<string, number>(),
            candidates = new Map<number, Row[]>();
        for (const a of data.assignments || [])
            if (a.node_type === "v2box" || a.node_type === "v2node")
                owners.set(`${a.node_type}:${a.node_id}`, Number(a.server_id));
        for (const b of rows(budgets.data)) {
            if (b.networkServerId) {
                result.set(Number(b.networkServerId), b);
                continue;
            }
            const ids = new Set<number>(
                (b.nodes || []).map(
                    (n: Row) => owners.get(`${n.type}:${n.id}`) || 0,
                ),
            );
            if (ids.size === 1 && !ids.has(0)) {
                const id = [...ids][0];
                candidates.set(id, [...(candidates.get(id) || []), b]);
            }
        }
        for (const [id, list] of candidates)
            if (!result.has(id) && list.length === 1) result.set(id, list[0]);
        return result;
    }, [budgets.data, data.assignments]);
    const budgetFor = (id: number) => budgetMap.get(Number(id));
    const [detailBusy, setDetailBusy] = useState(false),
        [detailDirty, setDetailDirty] = useState(false),
        [serverDirty, setServerDirty] = useState(false);
    useEffect(()=>{
        if(!serverDirty && !detailDirty)return;
        const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
        window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
    },[serverDirty,detailDirty]);
    const [summaryRevision,setSummaryRevision]=useState(0);
    const [legacyOpen, setLegacyOpen] = useState(false);
    const legacyNodes = useData<Row[]>(
        legacyOpen ? admin("server/manage/getNodes") : "",
    );
    function editServer(server: Row) {
        setCommand("");
        if (budgets.loading || budgets.error) {
            setError("请先成功加载流量额度后再编辑服务器");
            return false;
        }
        setServerDirty(false);setDetailDirty(false);setDetailBusy(false);
        setEditing({ ...server, ...trafficDraft(budgetFor(server.id)) });
        return true;
    }

    const roots: Row[] = (data.credentials || []).filter(
        (a: Row) => a.root_domain,
    );
    const [editing, setEditing] = useState<Row | null>(null);
    const liveServer = servers.find(s => Number(s.id) === Number(editing?.id)) || editing;
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [command, setCommand] = useState("");
    const [commandExpires, setCommandExpires] = useState("");
    useEffect(() => {
        if (serverDirty) setCommand("");
    }, [serverDirty]);
    useEffect(() => {
        if (!command || !commandExpires) return;
        const expires = Date.parse(commandExpires);
        if (!Number.isFinite(expires)) return;
        const timer = window.setTimeout(
            () => {
                setCommand("");
                setNotice(
                    "上报命令已过期，请重新生成。已配置的上报服务不受影响。",
                );
            },
            Math.max(0, expires - Date.now()),
        );
        return () => window.clearTimeout(timer);
    }, [command, commandExpires]);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const refresh = useRef(reload);
    refresh.current = reload;
    useEffect(() => {
        if (!editing?.id || serverDirty || detailDirty || detailBusy) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible" && !pending.current) refresh.current();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [editing?.id, serverDirty, detailDirty, detailBusy]);

    async function act(path: string, body: Row) {
        if (pending.current || detailBusy) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        if (path === "enroll" || path === "reset") setCommand("");
        try {
            if (path === "save") {
                if (budgets.loading || budgets.error)
                    throw new Error("请先成功加载流量额度后再保存");
                const traffic = trafficPayload(editing || {});
                const old = budgetFor(Number(body.id));
                if (
                    old &&
                    (old.resetDay !== traffic.resetDay ||
                        old.countingMode !== traffic.countingMode ||
                        (Number(old.limitBytes) !== traffic.limitBytes && traffic.limitBytes > 0 &&
                            traffic.limitBytes <= Number(old.usedBytes))) &&
                    !confirm(
                        "此变更会重新计算当前周期用量，或立即限制达到额度的服务。确认保存？",
                    )
                )
                    return;
                body = {
                    ...body,
                    traffic,
                    ...(!body.id && editing?.configureEntry
                        ? { entry: entryPayload(editing) }
                        : {}),
                };
            }
            const r = await request<Row>(admin(`server/network/${path}`), body);
            if (r.data?.command) {
                setCommand(r.data.command);
                setCommandExpires(r.data.expiresAt || "");
            }
            reload();
            if (path === "save") {budgets.reload();setSummaryRevision(v=>v+1);}
            if (path === "save")
                setNotice(
                    r.data?.entryId
                        ? "服务器与入口域名已保存，请配置服务器 IP 上报并等待解析同步。"
                        : "服务器已保存，可继续在当前管理界面配置 IP 上报。",
                );
            if (path === "save" || path === "drop") {
                setServerDirty(false);
                if(path==="drop" || !body.id)setEditing(null);
            }
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
                title="服务器列表"
                actions={
                    <div className="actions">
                        <button
                            onClick={() => {
                                setCommand("");
                                setServerDirty(false);
                                setEditing({
                                    name: "",
                                    family: "ipv4",
                                    enabled: true,
                                    ...trafficDraft(),
                                    configureEntry: false,
                                    entry_credential_id: "",
                                    entry_prefix: "",
                                    entry_family: "ipv4",
                                });
                            }}
                        >
                            添加服务器
                        </button>
                    </div>
                }
            >
                <div className="pad">
                    <p className="muted">
                        直连节点可自动创建服务器记录，无需重复添加。独立中转服务器在此配置
                        IP 上报与共享入口。 <a href="#/nodes">配置节点</a> ·{" "}
                        <a href="#/node-domains">管理根域名与解析</a>
                    </p>
                    <Table
                        data={servers}
                        columns={[
                            [
                                "name",
                                "服务器",
                                (r) => (
                                    <span>
                                        <button className="link" disabled={busy || budgets.loading || !!budgets.error} onClick={()=>editServer(r)}>{r.name}</button>
                                        {!r.enabled && (
                                            <small className="muted">
                                                {" "}
                                                · 已停用
                                            </small>
                                        )}
                                    </span>
                                ),
                            ],
                            [
                                "purpose", "服务器用途", r=>serverPurpose(Number(r.id),data),
                            ],
                            [
                                "quota",
                                "周期用量 / 额度",
                                (r: Row) => {
                                    const b = budgetFor(r.id);
                                    return budgets.loading ? (
                                        "加载中"
                                    ) : budgets.error ? (
                                        "加载失败"
                                    ) : !b ? (
                                        "未设置"
                                    ) : (
                                        <span className="server-quota-usage">
                                            {bytes(b.usedBytes || 0)} /{" "}
                                            {Number(b.limitBytes) > 0
                                                ? bytes(b.limitBytes)
                                                : "不限量"}
                                            <small
                                                className={
                                                    b.blocked ||
                                                    quotaState(b) === "接近额度"
                                                        ? "server-quota-warning"
                                                        : "muted"
                                                }
                                            >
                                                {quotaState(b)}
                                            </small>
                                            {Number(b.limitBytes) > 0 && (
                                                <progress
                                                    aria-label={`${r.name} 额度使用比例`}
                                                    max={100}
                                                    value={Math.min(
                                                        100,
                                                        (Number(b.usedBytes) /
                                                            Number(
                                                                b.limitBytes,
                                                            )) *
                                                            100,
                                                    )}
                                                />
                                            )}
                                        </span>
                                    );
                                },
                            ],
                            [
                                "cycle",
                                "周期起始日",
                                (r: Row) =>
                                    budgetFor(r.id)
                                        ? `每月 ${budgetFor(r.id)!.resetDay} 日`
                                        : "—",
                            ],
                            [
                                "usage",
                                "关联用途",
                                (r: Row) => {
                                    const bindings = (
                                        data.assignments || []
                                    ).filter(
                                        (a: Row) =>
                                            Number(a.server_id) ===
                                            Number(r.id),
                                    );
                                    const origins = new Set(
                                        bindings
                                            .filter(
                                                (a: Row) =>
                                                    a.purpose !== "entry",
                                            )
                                            .map(
                                                (a: Row) =>
                                                    `${a.node_type}:${a.node_id}`,
                                            ),
                                    ).size;
                                    const entryCount = bindings.filter(
                                        (a: Row) => a.purpose === "entry",
                                    ).length;
                                    return (
                                        [
                                            origins
                                                ? `${origins} 个代理服务`
                                                : "",
                                            entryCount
                                                ? `${entryCount} 个入口域名`
                                                : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" · ") || "尚未关联"
                                    );
                                },
                            ],
                            [
                                "address",
                                "IP 地址",
                                (r) => (
                                    <span>
                                        {r.ipv4 || "—"}
                                        {r.ipv6 && (
                                            <small
                                                className="muted"
                                                style={{ display: "block" }}
                                            >
                                                {r.ipv6}
                                            </small>
                                        )}
                                    </span>
                                ),
                            ],
                            ["reportStatus", "上报状态", r => serverReportStatus(r)],
                            [
                                "ipv4_seen_at",
                                "最近上报",
                                (r: Row) =>
                                    Math.max(
                                        Number(r.ipv4_seen_at) || 0,
                                        Number(r.ipv6_seen_at) || 0,
                                    )
                                        ? logTime(
                                              Math.max(
                                                  Number(r.ipv4_seen_at) || 0,
                                                  Number(r.ipv6_seen_at) || 0,
                                              ),
                                          )
                                        : "尚未上报",
                            ],
                            [
                                "actions",
                                "操作",
                                (r: Row) => (
                                    <div className="actions">
                                        <button disabled={busy || budgets.loading || !!budgets.error} onClick={()=>editServer(r)}>管理</button>
                                        <AdminRowMenu label={`${r.name} 更多操作`}>
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
                                            删除服务器
                                        </button>
                                        </AdminRowMenu>
                                    </div>
                                ),
                            ],
                        ]}
                    />
                    <p className="muted">
                        已有节点的一键部署会配置所属服务器的上报。独立入口服务器只需配置上报，不安装或重启
                        V2Box。
                    </p>
                    {budgets.error && (
                        <p role="alert">
                            流量额度加载失败，
                            <button onClick={budgets.reload}>重试</button>
                        </p>
                    )}
                    {rows(budgets.data).some((b) => !b.networkServerId) && (
                        <details>
                            <summary>历史未关联额度</summary>
                            <p>
                                保留历史用量。整理服务绑定后，编辑对应服务器即可自动关联；不会自动合并不同额度。
                            </p>
                            <button onClick={() => setLegacyOpen(true)}>
                                整理历史额度
                            </button>
                        </details>
                    )}
                </div>
            </Panel>
            {legacyOpen && (
                <Modal
                    title="历史未关联额度"
                    close={() => setLegacyOpen(false)}
                >
                    <State {...legacyNodes} retry={legacyNodes.reload}>
                        <ServerTrafficBudgets
                            legacyOnly
                            nodes={rows(legacyNodes.data)}
                            onSaved={() => {
                                budgets.reload();
                                reload();
                            }}
                        />
                    </State>
                </Modal>
            )}
            {editing && (
                <Modal
                    variant="drawer"
                    wide
                    className="server-management-drawer"
                    title={editing.id ? `${editing.name} · 服务器管理` : "添加服务器"}
                    dismissible={!busy && !detailBusy}
                    close={() => {
                        if (
                            !busy && !detailBusy &&
                            (!(serverDirty || detailDirty) ||
                                confirm("服务器或入口配置尚未保存，确认放弃修改？"))
                        ) {
                            setEditing(null);
                            setCommand("");
                        }
                    }}
                >
                    {editing.id && <nav className="node-management-jumps" aria-label="服务器管理分区">
                        {[['config','基本配置'],['report','IP 上报'],['entry','入口与转发'],['usage','用量与关联节点']].map(([key,label]) => <button key={key} type="button" onClick={() => jumpTo(key)}>{label}</button>)}
                    </nav>}
                    {editing.id && <div className="pad server-traffic-details"><p>服务器用途：{serverPurpose(Number(editing.id),data)}</p><ServerStatus server={servers.find(s=>Number(s.id)===Number(editing.id)) || editing}/></div>}
                    <form
                        className="node-domain-form server-config-form"
                        data-unsaved={serverDirty || undefined}
                        data-saving={busy || undefined}
                        onSubmit={(e) => {
                            e.preventDefault();
                            act("save", {
                                id: editing.id,
                                name: editing.name,
                                family: editing.family,
                                enabled: !!editing.enabled,
                            });
                        }}
                    >
                        <h3 id={`${sectionId}-config`} tabIndex={-1}>基本配置</h3><p className="server-management-guide">管理本机名称、地址类型与流量额度。节点协议和证书在节点管理中配置。</p>
                        <label>
                            服务器名称
                            <input
                                required
                                maxLength={100}
                                value={editing.name}
                                onChange={(e) => {
                                    setEditing({
                                        ...editing,
                                        name: e.target.value,
                                    });
                                    setServerDirty(true);
                                }}
                            />
                        </label>
                        <label>
                            允许 IP 上报与解析同步
                            <AdminSwitch
                                label="允许 IP 上报与解析同步"
                                checked={!!editing.enabled}
                                onChange={async (enabled) => {
                                    setEditing({
                                        ...editing,
                                        enabled,
                                        configureEntry: enabled
                                            ? editing.configureEntry
                                            : false,
                                    });
                                    setServerDirty(true);
                                }}
                            />
                        </label>
                        <label>
                            地址类型
                            <select
                                value={editing.family}
                                onChange={(e) => {
                                    setEditing({
                                        ...editing,
                                        family: e.target.value,
                                        entry_family:
                                            e.target.value === "dual"
                                                ? editing.entry_family
                                                : e.target.value,
                                    });
                                    setServerDirty(true);
                                }}
                            >
                                <option value="ipv4">IPv4</option>
                                <option value="ipv6">IPv6</option>
                                <option value="dual">双栈</option>
                            </select>
                        </label>
                        <details className="server-management-quota"><summary>流量额度与计费周期</summary>
                        <ServerTrafficFields
                            value={editing}
                            onChange={(value) => {
                                setEditing(value);
                                setServerDirty(true);
                            }}
                        />

                        </details>
                        {!editing.id && (
                            <fieldset>
                                <legend>服务器用途</legend>
                                <p className="muted">代理服务器运行 V2Box；中转入口服务器配置入口域名与四层转发。用途根据实际关联自动更新，支持混合使用。</p>
                                <label>预设用途<select aria-label="预设用途" disabled={!editing.enabled || busy} value={editing.configureEntry ? "entry" : "proxy"} onChange={e=>{setEditing({...editing,configureEntry:e.target.value==="entry"});setServerDirty(true);}}><option value="proxy">代理服务器</option><option value="entry">中转入口服务器</option></select></label>
                                {editing.configureEntry && (
                                    <ServerEntryFields
                                        value={editing}
                                        roots={roots}
                                        family={editing.family}
                                        disabled={busy}
                                        onChange={(value) => {
                                            setEditing(value);
                                            setServerDirty(true);
                                        }}
                                    />
                                )}
                                {!editing.enabled && (
                                    <p className="muted">
                                        启用 IP 上报与解析同步后可配置入口。
                                    </p>
                                )}
                            </fieldset>
                        )}
                        <button
                            className="primary"
                            disabled={
                                busy || detailBusy ||
                                budgets.loading ||
                                !!budgets.error ||
                                (!!editing.configureEntry && !roots.length)
                            }
                        >
                            {editing.id ? "保存服务器配置" : "保存"}
                        </button>
                        {editing.id && (
                            <fieldset id={`${sectionId}-report`} tabIndex={-1}>
                                <legend>服务器 IP 上报</legend>
                                <p className="muted">
                                    代理服务器安装 V2Box 时自动配置上报。独立中转服务器需在本机执行下方命令，不能在代理服务器代为执行。上报成功后自动同步关联域名的解析。
                                </p>
                                <p><strong>{liveServer && serverReportStatus(liveServer)}</strong></p>
                                <p role="status">{!liveServer?.enabled ? "上报已停用，请先启用并保存服务器配置。" : !liveServer?.ipv4 && !liveServer?.ipv6 ? "尚未收到本机 IP：请生成上报命令，并在此服务器执行。" : "已收到服务器 IP。双栈域名需要 IPv4 和 IPv6 均有效。"}</p>
                                <p>
                                    最近上报：
                                    {Math.max(
                                        Number(liveServer?.ipv4_seen_at) || 0,
                                        Number(liveServer?.ipv6_seen_at) || 0,
                                    )
                                        ? logTime(
                                              Math.max(
                                                  Number(
                                                      liveServer?.ipv4_seen_at,
                                                  ) || 0,
                                                  Number(
                                                      liveServer?.ipv6_seen_at,
                                                  ) || 0,
                                              ),
                                          )
                                        : "尚未上报"}
                                </p>
                                {serverDirty && (
                                    <p className="muted">
                                        请先保存服务器修改，再生成上报命令。
                                    </p>
                                )}
                                <button
                                    type="button"
                                    disabled={
                                        busy || serverDirty || !editing.enabled
                                    }
                                    onClick={() =>
                                        act("enroll", { id: editing.id })
                                    }
                                >
                                    配置服务器上报
                                </button>
                                <NodeApiMigration serverId={Number(editing.id)} />
                                <details>
                                    <summary>凭据维护</summary>
                                    <p className="muted">
                                        仅在上报凭据泄露或需要撤销时重置。
                                    </p>
                                    <button
                                        type="button"
                                        disabled={
                                            busy ||
                                            serverDirty ||
                                            !editing.enabled
                                        }
                                        onClick={() => {
                                            if (
                                                confirm(
                                                    "重置会使旧上报凭据立即失效。需重新执行生成的命令，现有 DNS 记录保留。确认继续？",
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
                                </details>
                            </fieldset>
                        )}
                        {command && (
                            <section aria-label="服务器上报配置命令">
                                {" "}
                                <p>
                                    请在选中的实际服务器执行。授权限时、一次有效；配置失败时可重复执行原命令恢复。
                                </p>
                                <pre className="admin-network-command">
                                    {command}
                                </pre>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                command,
                                            );
                                        } catch {
                                            setError(
                                                "复制失败，请手动选择命令复制",
                                            );
                                        }
                                    }}
                                >
                                    复制命令
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCommand("")}
                                >
                                    收起命令
                                </button>
                            </section>
                        )}
                        {error && <p role="alert">{error}</p>}
                        {notice && <p role="status">{notice}</p>}
                    </form>
                    {editing.id && <div className="pad server-management-sections">
                        <h3 id={`${sectionId}-entry`} tabIndex={-1}>入口与转发</h3><p className="muted">仅中转服务器需要配置。先添加入口域名，再在节点中选择此入口，最后在本机配置并验证转发。</p>
                        {serverDirty && <p className="muted">请先保存服务器配置，再修改入口或转发。</p>}
                        <fieldset disabled={busy || serverDirty}>
                        <ServerEntryDomains key={editing.id} server={servers.find(s=>Number(s.id)===Number(editing.id)) || editing} data={data} reload={reload} onBusy={setDetailBusy} onDirty={setDetailDirty}/>
                        </fieldset>
                        <fieldset disabled={busy || serverDirty || detailBusy || detailDirty}><ServerForwarding server={editing} data={data} reload={reload}/></fieldset>
                        <div id={`${sectionId}-usage`} tabIndex={-1}><ServerTrafficSummary key={`${editing.id}:${summaryRevision}`} server={editing} onNavigate={()=>!busy && !detailBusy && (!(serverDirty || detailDirty) || confirm("配置尚未保存，确认放弃修改并前往节点管理？"))}/></div>
                    </div>}
                </Modal>
            )}
            {error && !editing && <p role="alert">{error}</p>}
            {notice && !editing && <p role="status">{notice}</p>}
        </>
    );
}
