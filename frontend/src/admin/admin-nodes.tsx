import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { admin, bytes, date, request, rows, type Row } from "../shared/api";
import { Panel, Reload, State, Table, useData } from "../shared/ui";
import { instantDate } from "../shared/timezone";
import { formatMultiplier } from "../shared/number-format";
import { AdminRowMenu } from "./AdminRowMenu";
import { ProtocolBadge } from "./ProtocolBadge";
import { DefaultNodeLineEditor } from "./DefaultNodeLineEditor";
import { AdminChoiceGroup } from "./AdminChoices";
import { NodeConnectionEditor, NodeForwarding } from "./NodeConnections";
import { NodeDictionaryProvider } from "./node-dictionary";
import { NodeDeployment } from "./NodeDeployment";
import { NodeEditorDrawer } from "./nodes/NodeEditorDrawer";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { NodeDiagnostics, nodeRuntimeLabels, nodeIssueLabels } from "./AdminDiagnostics";
import { mergePageOrder, sortPayload } from "./admin-actions";
import { AdminPager } from "./AdminPager";
import { AdminSwitch } from "./admin-switch";
import { SortButton } from "./admin-tools";

// Report endpoints use zero when the node has never communicated.
function nodeReportTime(...values: unknown[]): string {
    const reports = values.map(value => instantDate(value)?.getTime() ?? 0).filter(value => value > 0);
    return reports.length ? date(new Date(Math.max(...reports))) : "—";
}

// Refresh counters only: completion-based scheduling prevents overlapping requests.
function useNodeActivity(nodes: Row[] | null, enabled: boolean) {
    const [snapshot,setSnapshot]=useState<{source:Row[]; data:Row[]} | null>(null);
    const [unavailable,setUnavailable]=useState(false);
    useEffect(()=>{
        if (!enabled || !nodes?.length) return;
        let live=true, pending=false, failures=0, lastAttempt=Date.now();
        const interval=60000;
        let timer:ReturnType<typeof setTimeout>;
        const schedule=(delay=interval)=>{clearTimeout(timer);if(live && document.visibilityState!=="hidden" && navigator.onLine!==false)timer=setTimeout(update,delay);};
        const update=async()=>{
            if(!live || pending)return;
            if(document.visibilityState==="hidden" || navigator.onLine===false)return;
            pending=true;lastAttempt=Date.now();
            try {
                const result=await request<Row[]>(admin("server/manage/activity"));
                if(live){setSnapshot({source:nodes,data:result.data});setUnavailable(false);failures=0;}
            } catch {if(live){setUnavailable(true);failures++;}}
            finally {pending=false;schedule(Math.min(300000,interval*2**failures));}
        };
        const resume=()=>{
            clearTimeout(timer);
            if(pending || document.visibilityState==="hidden" || navigator.onLine===false)return;
            const remaining=Math.min(300000,interval*2**failures)-(Date.now()-lastAttempt);
            if(remaining<=0)void update();else schedule(remaining);
        };
        document.addEventListener("visibilitychange",resume);
        window.addEventListener("online",resume);
        window.addEventListener("offline",resume);
        schedule();
        return ()=>{live=false;clearTimeout(timer);document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);window.removeEventListener("offline",resume);};
    },[nodes,enabled]);
    const data=useMemo<Row[]>(()=>{
        if(snapshot?.source!==nodes)return rows(nodes);
        const activity=new Map(snapshot.data.map(row=>[`${row.type}:${row.id}`,row]));
        return rows(nodes).map(node=>{
            const current=activity.get(`${node.type}:${node.id}`);
            if (!current || Number(current.service_id||0)!==Number(node.service_id||0))
                return {...node,online:null,online_stale:true,runtime_status:"unknown"};
            const runtime=current.runtime_status==="online" && node.traffic_budget?.blocked ? "limited" : current.runtime_status || "unknown";
            const issues=(node.issues || []).filter((issue:string)=>issue!=="offline");
            if(runtime==="offline" && !node.maintenance)issues.push("offline");
            return {...node,...current,runtime_status:runtime,issues};
        });
    },[nodes,snapshot]);
    return {data,unavailable};
}

export function Nodes(props: { initialTab?: "nodes" | "forwarding" }) {
    return (
        <NodeDictionaryProvider>
            <NodesContent key={props.initialTab || "nodes"} {...props} />
        </NodeDictionaryProvider>
    );
}
function NodesContent({
    initialTab = "nodes",
}: { initialTab?: "nodes" | "forwarding" } = {}) {
    const tab = initialTab;
    const serviceFocusFromHash = () => {
        const value =
            new URLSearchParams(location.hash.split("?")[1]).get("service") ||
            "";
        return /^v2box:[1-9][0-9]*$/.test(value) ? value : "";
    };
    const [serviceFocus, setServiceFocus] = useState(serviceFocusFromHash);
    useEffect(() => {
        const update = () => setServiceFocus(serviceFocusFromHash());
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);
    const [managedLine, setManagedLine] = useState<Row | null>(null);
    const [defaultLine, setDefaultLine] = useState<Row | null>(null);
    const [connectionNode, setConnectionNode] = useState<Row | null>(null);
    const [savedNodeNotice, setSavedNodeNotice] = useState("");

    const [diagnosticNode, setDiagnosticNode] = useState<Row | null>(null);
    const [credentialNode, setCredentialNode] = useState<Row | null>(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [nodeSearch, setNodeSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [onlyMaintenance, setOnlyMaintenance] = useState(false);
    const [quotaFilter, setQuotaFilter] = useState(false);

    const groups = useData<Row[]>(admin("server/group/fetch"));
    const d = useData<Row[]>(admin("server/manage/getNodes"));
    const [editing, setEditing] = useState<Row | null>(null);
    const [error, setError] = useState("");
    const actionPending = useRef(false);
    const [actionBusy, setActionBusy] = useState(false);
    async function nodeAction(row: Row, kind: "copy" | "drop") {
        if (
            actionPending.current ||
            (kind === "drop" &&
                !confirm(
                    row.service_id
                        ? `确认删除接入线路「${row.name}」？共享代理服务和服务器程序继续保留。`
                        : `确认删除节点「${row.name}」及其代理服务？存在复用线路时将禁止删除。服务凭据将撤销，托管 DNS 解析将进入清理队列；服务器程序不会自动卸载。`,
                ))
        )
            return;
        actionPending.current = true;
        setActionBusy(true);
        setError("");
        try {
            await request(admin(`server/${row.type}/${kind}`), { id: row.id });
            d.reload();
        } catch (error) {
            setError((error as Error).message);
        } finally {
            actionPending.current = false;
            setActionBusy(false);
        }
    }

    const activity=useNodeActivity(d.data,tab==="nodes" && !editing && !defaultLine && !connectionNode && !credentialNode && !diagnosticNode && !actionBusy);
    const nodeRows = activity.data;
    const serviceMap = useMemo(
        () =>
            new Map(
                nodeRows
                    .filter((n) => !n.service_id)
                    .map((n) => [`${n.type}:${n.id}`, n]),
            ),
        [nodeRows],
    );
    const connectionCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const n of nodeRows)
            if (n.service_id) {
                const key = `${n.type}:${n.service_id}`;
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        return counts;
    }, [d.data]);
    const associatedNodes=useMemo(()=>managedLine ? nodeRows.filter(n=>n.type===managedLine.type && Number(n.service_id || n.id)===Number(managedLine.service_id || managedLine.id)) : [],[nodeRows,managedLine]);
    type EditSection = "line" | "service" | "deploy";
    function openSection(line: Row, section: EditSection) {
        const current=nodeRows.find(n=>n.type===line.type && Number(n.id)===Number(line.id));
        if(!current){setError("节点已变化，请重新加载节点列表");return;}
        line=current;
        const service = serviceMap.get(
            `${line.type}:${line.service_id || line.id}`,
        );
        if (!service) {
            setError("关联服务不可用，请重新加载节点列表");
            return;
        }
        setManagedLine(line);
        setDefaultLine(null);
        setConnectionNode(null);
        setCredentialNode(null);
        setEditing(null);
        if (section === "line")
            line.service_id ? setConnectionNode(line) : setDefaultLine(line);
        else if (section === "service") {
            setEditing(service);
        } else setCredentialNode(service);
    }
    function editorNavigation(
        section: EditSection,
        busy = false,
        dirty = false,
    ) {
        if (!managedLine) return null;
        return (
            <div className="pad node-editor-navigation">
                <AdminChoiceGroup
                    label="节点编辑"
                    variant="navigation"
                    className="node-workflow-navigation"
                    value={section}
                    disabled={busy || d.loading}
                    options={[
                        { value: "line", label: "节点信息" },
                        { value: "service", label: "连接与协议" },
                        { value: "deploy", label: "部署与状态" },
                    ]}
                    onChange={(next) => {
                        if (
                            next === section ||
                            (dirty &&
                                !confirm(
                                    "当前配置尚未保存，确认放弃修改并切换？",
                                ))
                        )
                            return;
                        openSection(managedLine, next);
                    }}
                />
                {associatedNodes.length > 1 && <details className="admin-deployment-tools"><summary>代理服务关联节点（{associatedNodes.length} 个）</summary>
                    <ul>{associatedNodes.map(n=><li key={`${n.type}:${n.id}`}>{n.name}{Number(n.id)===Number(managedLine.id)?"（当前节点）":""}</li>)}</ul>
                    <p className="muted">修改代理服务的协议、监听、证书或部署会影响以上节点。计费倍率沿用同一服务的统计，暂不按入口分别计费。</p>
                </details>}
            </div>
        );
    }
    useEffect(() => {
        if (!serviceFocus || !nodeRows.length) return;
        const service = serviceMap.get(serviceFocus);
        if (service) openSection(service, "service");
        setServiceFocus("");
    }, [serviceFocus, d.data]);
    const filteredNodes = nodeRows.filter(
        (n) =>
            (!onlyIssues || !!n.issues?.length) &&
            (!onlyMaintenance || !!n.maintenance) &&
            (!statusFilter ||
                (n.runtime_status || "unknown") === statusFilter) &&
            (!quotaFilter || n.traffic_budget?.blocked) &&
            `${n.id} ${n.name} ${n.host} ${n.current_ip || ""} ${n.protocol || ""}`
                .toLowerCase()
                .includes(nodeSearch.trim().toLowerCase()),
    );

    const currentPage = Math.min(page, Math.max(1, Math.ceil(filteredNodes.length / pageSize)));
    const offset = (currentPage - 1) * pageSize;
    useEffect(() => {
        if (d.data && !d.loading && !d.error && currentPage !== page) setPage(currentPage);
    }, [currentPage, page, d.data, d.loading, d.error]);

    const allColumns: ComponentProps<typeof Table>["columns"] = [
        ["id", "ID"],
        [
            "name",
            "名称",
            (r) => (
                <button className="link" onClick={() => setDiagnosticNode(r)}>
                    {r.name}
                </button>
            ),
        ],
        [
            "management",
            "管理状态",
            (r) =>
                r.maintenance
                    ? "维护中"
                    : r.issues?.length
                      ? r.issues
                            .map((key: string) => nodeIssueLabels[key] || key)
                            .join(" · ")
                      : "—",
        ],
        ["type", "类型"],
        [
            "service_id",
            "共用服务",
            (r) =>
                r.service_id ? (
                    <button
                        className="link"
                        onClick={() => openSection(r, "service")}
                    >
                        {serviceMap.get(`${r.type}:${r.service_id}`)?.name ||
                            `服务 #${r.service_id}`}
                    </button>
                ) : (
                    (connectionCounts.get(`${r.type}:${r.id}`) || 0)>0 ? `共用（${1+(connectionCounts.get(`${r.type}:${r.id}`) || 0)} 个节点）` : "独享"
                ),
        ],
        ["server_port", "监听端口"],
        [
            "connections",
            "关联节点",
            (r) =>
                `${1 + (connectionCounts.get(`${r.type}:${r.service_id || r.id}`) || 0)} 个节点`,
        ],
        ["protocol", "协议", (r) => <ProtocolBadge protocol={r.protocol} />],
        [
            "runtime_status",
            "运行状态",
            (r) => (
                <button
                    type="button"
                    className="node-runtime-indicator"
                    data-state={r.runtime_status || "unknown"}
                    aria-label={`${r.name}：${nodeRuntimeLabels[r.runtime_status] || nodeRuntimeLabels.unknown}，查看运行详情`}
                    title={`${r.service_id ? "共用代理服务状态，不代表中转链路已验证 · " : ""}${nodeRuntimeLabels[r.runtime_status] || nodeRuntimeLabels.unknown} · 最近通信：${nodeReportTime(r.last_check_at, r.last_push_at)}`}
                    onClick={() => setDiagnosticNode(r)}
                >
                    <span aria-hidden="true" />
                </button>
            ),
        ],
        ["host", "主机"],
        [
            "current_ip",
            "当前 IP",
            (r) => (
                <span title="优先显示公网 IP 上报；否则显示节点连接面板的来源 IP">
                    {r.current_ip || "未获取"}
                </span>
            ),
        ],
        [
            "traffic_budget",
            "服务器额度",
            (r) =>
                r.traffic_budget
                    ? `${bytes(r.traffic_budget.usedBytes)} / ${r.traffic_budget.limitBytes ? bytes(r.traffic_budget.limitBytes) : "不限"}${r.traffic_budget.blocked ? " · 已限制" : ""}`
                    : "未设置",
        ],
        ["port", "端口"],
        ["rate", "倍率", (row: Row) => formatMultiplier(row.rate)],
        [
            "show",
            "显隐",
            (r) => (
                <AdminSwitch
                    label={`${r.name} 显示`}
                    checked={Number(r.show) === 1}
                    onChange={async (checked) => {
                        await request(admin(`server/${r.type}/update`), {
                            id: r.id,
                            show: checked ? 1 : 0,
                        });
                        d.reload();
                    }}
                />
            ),
        ],
        [
            "group_id",
            "权限组",
            (r) =>
                (r.group_id || [])
                    .map(
                        (id: number) =>
                            rows(groups.data).find(
                                (g) => String(g.id) === String(id),
                            )?.name || `未知权限组（${id}）`,
                    )
                    .join(" / "),
        ],
        [
            "online",
            "服务活跃用户",
            (r) => <span title={r.online_stale ? "流量上报已过期，当前活跃人数未知" : r.service_id ? "所属代理服务最近流量上报周期的活跃人数，各共享线路不能相加" : "最近流量上报周期的活跃人数"}>
                {r.service_id ? `${r.online ?? "—"}（共享）` : (r.online ?? "—")}
            </span>,
        ],
        ["last_push_at", "最近流量上报", (r) => nodeReportTime(r.last_push_at)],
    ];
    const viewColumnKeys = [
        "id",
        "name",
        "service_id",
        "host",
        "port",
        "protocol",
        "runtime_status",
        "online",
        "last_push_at",
        "rate",
        "show",
        "group_id",
    ];
    const columns = allColumns
        .filter(([key]) => viewColumnKeys.includes(key))
        .map(
            ([key, label, ...rest]) =>
                [
                    key,
                    key === "host"
                        ? "连接地址"
                        : key === "port"
                          ? "连接端口"
                          : label,
                    ...rest,
                ] as (typeof allColumns)[number],
        );
    const columnStorageKey = "admin.nodes.columns.v2";
    const [visibleColumns, setVisibleColumns] = useState<string[] | null>(
        () => {
            try {
                const current = localStorage.getItem(columnStorageKey);
                const previous = localStorage.getItem("admin.nodes.columns.v1");
                let saved = JSON.parse(current ?? previous ?? "null");
                // Restore the removed operational columns once, preserving other choices.
                if (current === null && Array.isArray(saved) && saved.every(key => typeof key === "string")) {
                    saved = [...new Set([...saved, "online", "last_push_at"])];
                }
                return Array.isArray(saved) &&
                    saved.every((key) => typeof key === "string")
                    ? saved.length &&
                      !saved.some((key) =>
                          columns.some(([available]) => available === key),
                      )
                        ? null
                        : saved.filter((key) =>
                              columns.some(([available]) => available === key),
                          )
                    : null;
            } catch {
                return null;
            }
        },
    );
    useEffect(() => {
        try {
            localStorage.setItem(
                columnStorageKey,
                JSON.stringify(visibleColumns),
            );
        } catch {
            /* Storage may be disabled. */
        }
    }, [visibleColumns, columnStorageKey]);
    const selectedColumns = visibleColumns ?? columns.map(([key]) => key).filter(key => !["id", "service_id", "group_id"].includes(key));
    const [showDisplay, setShowDisplay] = useState(false);

    return (
        <>
            {showDisplay && (
                <AdminDisplaySettings
                    title={"节点显示设置"}
                    columns={columns}
                    selected={selectedColumns}
                    onChange={setVisibleColumns}
                    onReset={() => setVisibleColumns(null)}
                    close={() => setShowDisplay(false)}
                />
            )}
            {diagnosticNode && (
                <NodeDiagnostics
                    node={diagnosticNode}
                    close={() => setDiagnosticNode(null)}
                    onSaved={d.reload}
                    deploy={() => {
                        const target = diagnosticNode.service_id
                            ? nodeRows.find(
                                  (n) =>
                                      n.type === diagnosticNode.type &&
                                      Number(n.id) ===
                                          Number(diagnosticNode.service_id),
                              )
                            : diagnosticNode;
                        if (!target) {
                            setError("代理服务不可用，请先检查节点配置");
                            return;
                        }
                        setDiagnosticNode(null);
                        setManagedLine(target);
                        setCredentialNode(target);
                    }}
                />
            )}
            {tab==="nodes" && activity.unavailable && <p className="pad muted" role="status">运行状态、在线人数与上报时间暂未更新，系统将自动重试。</p>}
            {savedNodeNotice && (
                <p className="pad success-message" role="status">
                    {savedNodeNotice}
                </p>
            )}
            <p className="pad muted">
                管理用户订阅中的节点。{" "}
                <a href="#/servers">服务器管理</a> ·{" "}
                <a href="#/node-domains">域名与解析</a>
            </p>
            {defaultLine && (
                <DefaultNodeLineEditor
                    navigation={(busy, dirty) =>
                        editorNavigation("line", busy, dirty)
                    }
                    node={defaultLine}
                    groups={rows(groups.data)}
                    close={() => setDefaultLine(null)}
                    onSaved={d.reload}
                />
            )}
            {connectionNode && (
                <NodeConnectionEditor
                    navigation={(busy, dirty) =>
                        editorNavigation("line", busy, dirty)
                    }
                    view="line"
                    key={`${connectionNode.type}:${connectionNode.id || "new"}`}
                    node={connectionNode}
                    nodes={nodeRows}
                    groups={rows(groups.data)}
                    close={() => setConnectionNode(null)}
                    onSaved={d.reload}
                />
            )}
            {tab === "forwarding" && (
                <NodeForwarding
                    nodes={nodeRows}
                    edit={(node) => openSection(node, "service")}
                />
            )}
            {tab === "nodes" && (
                <Panel
                    title={"节点列表"}
                    actions={
                        <>
                            <Reload onClick={d.reload} loading={d.loading} />
                            <button
                                type="button"
                                onClick={() => setShowDisplay(true)}
                            >
                                显示设置
                            </button>
                            {
                                <SortButton
                                    path={admin("server/manage/sort")}
                                    kind="nodes"
                                    items={rows(d.data)}
                                    onSaved={d.reload}
                                />
                            }
                            {
                                <button
                                    className="primary"
                                    onClick={() => {
                                        setManagedLine(null);
                                        setEditing({
                                            type: "v2box",
                                            group_id: [],
                                            route_id: [],
                                            rate: 1,
                                            tls: 0,
                                            network: "tcp",
                                            disable_sni: 0,
                                            zero_rtt_handshake: 0,
                                        });
                                    }}
                                >
                                    新增节点
                                </button>
                            }
                        </>
                    }
                >
                    {actionBusy && (
                        <div
                            className="admin-refresh-note"
                            role="status"
                            data-saving="true"
                        >
                            正在提交节点操作…
                        </div>
                    )}
                    <State {...d} retry={d.reload}>
                        {error && <div className="alert">{error}</div>}
                        <div className="node-management-tools">
                            <label>
                                {"搜索节点"}
                                <input
                                    placeholder="ID、名称、域名、IP 或协议"
                                    value={nodeSearch}
                                    onChange={(e) => { setNodeSearch(e.target.value); setPage(1); }}
                                />
                            </label>
                            {
                                <>
                                    <label>
                                        筛选运行状态
                                        <select
                                            value={statusFilter}
                                            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                                        >
                                            <option value="">全部状态</option>
                                            {Object.entries(
                                                nodeRuntimeLabels,
                                            ).map(([key, label]) => (
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="node-quota-filter">
                                        <input
                                            type="checkbox"
                                            checked={quotaFilter}
                                            onChange={(e) => { setQuotaFilter(e.target.checked); setPage(1); }}
                                        />
                                        仅显示额度受限服务
                                    </label>
                                    <label className="node-quota-filter">
                                        <input
                                            type="checkbox"
                                            checked={onlyIssues}
                                            onChange={(e) => { setOnlyIssues(e.target.checked); setPage(1); }}
                                        />
                                        仅显示异常服务
                                    </label>
                                    <label className="node-quota-filter">
                                        <input
                                            type="checkbox"
                                            checked={onlyMaintenance}
                                            onChange={(e) => { setOnlyMaintenance(e.target.checked); setPage(1); }}
                                        />
                                        仅显示维护中服务
                                    </label>
                                </>
                            }
                            <span className="muted">
                                {filteredNodes.length === nodeRows.length ? `共 ${nodeRows.length} 个节点` : `筛选出 ${filteredNodes.length} 个，共 ${nodeRows.length} 个节点`}
                            </span>
                        </div>
                        <Table
                            data={filteredNodes.slice(offset, offset + pageSize)}
                            columns={columns.filter(([key]) =>
                                selectedColumns.includes(key),
                            )}
                            onReorder={async (items) => {
                                try {
                                    await request(
                                        admin("server/manage/sort"),
                                        sortPayload("nodes", mergePageOrder(nodeRows, items)),
                                    );
                                    d.reload();
                                } catch (e) {
                                    setError((e as Error).message);
                                }
                            }}
                            actions={(r) => (
                                <>
                                    <button
                                        onClick={() => openSection(r, "line")}
                                    >
                                        编辑
                                    </button>
                                    <AdminRowMenu label={`${r.name} 更多操作`}>
                                        {!r.service_id && (
                                            <button
                                                disabled={
                                                    actionBusy || d.loading
                                                }
                                                onClick={() =>
                                                    nodeAction(r, "copy")
                                                }
                                            >
                                                复制节点
                                            </button>
                                        )}
                                        <button
                                            className="danger"
                                            disabled={
                                                actionBusy ||
                                                d.loading ||
                                                (!r.service_id &&
                                                    (connectionCounts.get(
                                                        `${r.type}:${r.id}`,
                                                    ) || 0) > 0)
                                            }
                                            title={
                                                !r.service_id &&
                                                (connectionCounts.get(
                                                    `${r.type}:${r.id}`,
                                                ) || 0) > 0
                                                    ? "请先删除或迁移复用线路"
                                                    : undefined
                                            }
                                            onClick={() =>
                                                nodeAction(r, "drop")
                                            }
                                        >
                                            {r.service_id
                                                ? "删除线路"
                                                : "删除节点"}
                                        </button>
                                    </AdminRowMenu>
                                </>
                            )}
                        />
                        {(filteredNodes.length > 20 || pageSize !== 20) && (
                            <AdminPager page={currentPage} size={pageSize} total={filteredNodes.length}
                                loading={d.loading} onChange={setPage}
                                onSizeChange={size => { setPageSize(size); setPage(1); }} />
                        )}
                    </State>
                </Panel>
            )}
            {credentialNode && (
                <NodeDeployment
                    key={`${credentialNode.type}:${credentialNode.id}:deploy`}
                    navigation={(busy, dirty) =>
                        editorNavigation("deploy", busy, dirty)
                    }
                    editorName={managedLine?.name}
                    openConnection={managedLine ? (defaultEndpoint) => openSection(defaultEndpoint ? credentialNode : managedLine, "service") : undefined}
                    node={credentialNode}
                    scope="service"
                    inspect={() => {
                        setDiagnosticNode(credentialNode);
                        setCredentialNode(null);
                    }}
                    onChanged={d.reload}
                    close={() => {
                        setCredentialNode(null);
                        d.reload();
                    }}
                />
            )}
            {editing && (
                <NodeEditorDrawer
                    editing={editing}
                    managedLine={managedLine}
                    nodeList={d}
                    nodeRows={nodeRows}
                    groups={groups}
                    navigation={(busy, dirty) => editorNavigation("service", busy, dirty)}
                    reopenService={() => { if (managedLine) openSection(managedLine, "service"); }}
                    onEdit={setEditing}
                    onSelectService={(line, service) => {
                        setManagedLine(line);
                        setEditing(service);
                    }}
                    onCreated={(node, domainConfigured) => {
                        setManagedLine(node);
                        setCredentialNode({ ...node, _new: true, _domainConfigured: domainConfigured });
                    }}
                    onNotice={setSavedNodeNotice}
                />
            )}
        </>
    );
}
