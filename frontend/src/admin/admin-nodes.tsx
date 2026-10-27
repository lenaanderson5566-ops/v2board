import { AdminRowMenu } from "./AdminRowMenu";
import { DefaultNodeLineEditor } from "./DefaultNodeLineEditor";
import { serviceLineFields,nodeLineFields } from "./node-line-fields";
import { AdminChoiceGroup } from "./AdminChoices";
import { nodeConfigurationProblems, nodeChangeImpact } from "./node-guidance";
import { nodeSetupFields, nodeSetupPayload,nodeServiceFields,certificateCredentialOptions } from "./node-setup";
import { NodeConnectionEditor, NodeForwarding } from "./NodeConnections";
import { NodeDomainBinding } from "./NodeDomains";
import { NodeTopology } from "./NodeTopology";
import { NodeDictionaryProvider,useNodeCatalog } from "./node-dictionary";
import { NodeDeployment } from "./NodeDeployment";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { field } from "./admin-fields";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
} from "react";
import nodeLocations from "../../../resources/client/node-countries.json";
import {
    admin,
    bytes,
    date,
    query,
    request,
    rows,
    type Row,
} from "../shared/api";
import {
    Editor,
    Modal,
    Panel,
    Reload,
    State,
    Table,
    useData,
    type Field,
} from "../shared/ui";
import {
    NodeDiagnostics,
    nodeRuntimeLabels,
    nodeIssueLabels,
} from "./AdminDiagnostics";
import { sortPayload } from "./admin-actions";
import { linkNode, nodeFields } from "./admin-linkage";
import { formPresentation } from "./admin-presentation";
import { AdminSwitch } from "./admin-switch";
import { SortButton } from "./admin-tools";
import {
    nodeEditorPresentation,
    nodeSettingsFields,
    nodeSettingsInitial,
    nodeSettingsPayload,
} from "./node-settings";
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
    const catalog=useNodeCatalog();
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
    const [creationMode, setCreationMode] = useState<"new" | "reuse">("new");
    const [defaultLine, setDefaultLine] = useState<Row | null>(null);
    const [connectionNode, setConnectionNode] = useState<Row | null>(null);
    const [nodeDirty, setNodeDirty] = useState(false);
    const [nodeBusy, setNodeBusy] = useState(false);
    const [connectionDirty,setConnectionDirty]=useState(false),[connectionBusy,setConnectionBusy]=useState(false);
    const [configurationVersion,setConfigurationVersion]=useState(0);
    const reloadConfigurationSource=useRef<Row[] | null | undefined>(undefined);
    const [savedNodeNotice, setSavedNodeNotice] = useState("");
    const [preflightShown, setPreflightShown] = useState(false);

    const [diagnosticNode, setDiagnosticNode] = useState<Row | null>(null);
    const [credentialNode, setCredentialNode] = useState<Row | null>(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [nodeSearch, setNodeSearch] = useState("");
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [onlyMaintenance, setOnlyMaintenance] = useState(false);
    const [quotaFilter, setQuotaFilter] = useState(false);

    const groups = useData<Row[]>(admin("server/group/fetch"));
    const routes = useData<Row[]>(admin("server/route/fetch"));
    const d = useData<Row[]>(admin("server/manage/getNodes"));
    const [type, setType] = useState("v2box"),
        [editing, setEditing] = useState<Row | null>(null);
    const topology = useData<Row>(editing ? admin("server/ddns/fetch") : "");
    const managedService=!!editing?.id && !!topology.data?.assignments?.some((a:Row)=>a.node_type===editing.type && Number(a.node_id)===Number(editing.id) && a.managed);
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

    const schema = useData<Row>(query(admin("console/nodeSchema"), { type }));
    useEffect(() => {
        setNodeDirty(false);
        setPreflightShown(false);
        setCreationMode("new");
    }, [editing]);
    useEffect(() => {
        if (!editing || !nodeDirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [editing, nodeDirty]);
    function closeNode() {
        if (nodeBusy || connectionBusy) return;
        if ((nodeDirty || connectionDirty) && !window.confirm("节点配置尚未保存，确认放弃修改？"))
            return;
        setEditing(null);
    }
    const activity=useNodeActivity(d.data,tab==="nodes" && !editing && !defaultLine && !connectionNode && !credentialNode && !diagnosticNode && !nodeBusy && !actionBusy);
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
    const currentManagedLine=managedLine ? nodeRows.find(n=>n.type===managedLine.type && Number(n.id)===Number(managedLine.id)):undefined;
    const serviceChanged=!!editing?.id && !!currentManagedLine && Number(currentManagedLine.service_id || currentManagedLine.id)!==Number(editing.id);
    const reloadConfiguration=()=>{reloadConfigurationSource.current=d.data;d.reload();topology.reload();};
    useEffect(()=>{
        if(!editing?.id || nodeDirty || nodeBusy || connectionBusy)return;
        const line=rows(d.data).find(n=>n.type===managedLine?.type && n.id===managedLine?.id);
        const owner=line ? Number(line.service_id || line.id):editing.id;
        const current=rows(d.data).find(n=>n.type===editing.type && Number(n.id)===owner);
        if(current && owner!==Number(editing.id)){
            setManagedLine(line!);setType(current.type);setEditing(current);setConfigurationVersion(version=>version+1);
            reloadConfigurationSource.current=undefined;return;
        }
        if(reloadConfigurationSource.current===undefined || d.data===reloadConfigurationSource.current)return;
        if(current){setEditing(current);setConfigurationVersion(version=>version+1);}
        reloadConfigurationSource.current=undefined;
    },[d.data,nodeDirty,nodeBusy,connectionBusy,editing?.id,managedLine?.id,managedLine?.type]);
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
        setConnectionDirty(false);setConnectionBusy(false);reloadConfigurationSource.current=undefined;
        if (section === "line")
            line.service_id ? setConnectionNode(line) : setDefaultLine(line);
        else if (section === "service") {
            setType(service.type);
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
        ["protocol", "协议"],
        [
            "runtime_status",
            "运行状态",
            (r) => (
                <button
                    type="button"
                    className="node-runtime-indicator"
                    data-state={r.runtime_status || "unknown"}
                    aria-label={`${r.name}：${nodeRuntimeLabels[r.runtime_status] || nodeRuntimeLabels.unknown}，查看运行详情`}
                    title={`${r.service_id ? "共用代理服务状态，不代表中转链路已验证 · " : ""}${nodeRuntimeLabels[r.runtime_status] || nodeRuntimeLabels.unknown} · 最近通信：${date(Math.max(Number(r.last_check_at || 0), Number(r.last_push_at || 0)))}`}
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
        ["rate", "倍率"],
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
            "服务在线用户",
            (r) => <span title={r.online_stale ? "上报已过期，当前在线人数未知" : r.service_id ? "所属代理服务的总人数，各共享线路不能相加；按最近流量上报周期统计活跃用户" : "按最近流量上报周期统计活跃用户"}>
                {r.service_id ? `${r.online ?? "—"}（共享）` : (r.online ?? "—")}
            </span>,
        ],
        ["last_push_at", "最近流量上报", (r) => date(r.last_push_at)],
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
                                            type,
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
                                    onChange={(e) =>
                                        setNodeSearch(e.target.value)
                                    }
                                />
                            </label>
                            {
                                <>
                                    <label>
                                        筛选运行状态
                                        <select
                                            value={statusFilter}
                                            onChange={(e) =>
                                                setStatusFilter(e.target.value)
                                            }
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
                                            onChange={(e) =>
                                                setQuotaFilter(e.target.checked)
                                            }
                                        />
                                        仅显示额度受限服务
                                    </label>
                                    <label className="node-quota-filter">
                                        <input
                                            type="checkbox"
                                            checked={onlyIssues}
                                            onChange={(e) =>
                                                setOnlyIssues(e.target.checked)
                                            }
                                        />
                                        仅显示异常服务
                                    </label>
                                    <label className="node-quota-filter">
                                        <input
                                            type="checkbox"
                                            checked={onlyMaintenance}
                                            onChange={(e) =>
                                                setOnlyMaintenance(
                                                    e.target.checked,
                                                )
                                            }
                                        />
                                        仅显示维护中服务
                                    </label>
                                </>
                            }
                            <span className="muted">
                                显示 {filteredNodes.length} / {nodeRows.length}{" "}
                                {"个节点"}
                            </span>
                        </div>
                        <Table
                            data={filteredNodes}
                            columns={columns.filter(([key]) =>
                                selectedColumns.includes(key),
                            )}
                            onReorder={async (items) => {
                                try {
                                    await request(
                                        admin("server/manage/sort"),
                                        sortPayload("nodes", items),
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
                    openConnection={managedLine ? () => openSection(managedLine, "service") : undefined}
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
                <Modal
                    title={
                        editing.id
                            ? `编辑节点 · ${managedLine?.name || editing.name || ""}`
                            : "新增节点"
                    }
                    variant="drawer"
                    wide
                    className={`node-editor-dialog${editing.id ? "" : " node-editor-create"}`}
                    dismissible={!nodeBusy && !connectionBusy}
                    close={closeNode}
                >
                    {editing.id &&
                        editorNavigation("service", nodeBusy || connectionBusy, nodeDirty || connectionDirty)}
                    {editing.id && type===editing.type && <section className="node-config-section" aria-label="连接与域名">
                        <fieldset disabled={nodeBusy}>
                            {managedLine?.service_id ? <NodeConnectionEditor key={`${managedLine.type}:${managedLine.id}`} embedded onPublished={reloadConfiguration} pauseRefresh={nodeDirty || nodeBusy} view="path" node={managedLine} nodes={nodeRows} groups={rows(groups.data)} close={()=>{}} onSaved={d.reload} onDirty={setConnectionDirty} onBusyChange={setConnectionBusy}/> :
                                <NodeDomainBinding key={`${editing.type}:${editing.id}`} pauseRefresh={nodeDirty || nodeBusy} node={editing} onChanged={reloadConfiguration} onPublished={reloadConfiguration} onDirty={setConnectionDirty} onBusyChange={setConnectionBusy}/>}
                        </fieldset>
                    </section>}
                    {serviceChanged && <div className="pad alert" role="alert">此节点的所属代理服务已变更，请重新载入后再保存协议配置。<button type="button" disabled={nodeBusy || connectionBusy} onClick={()=>{if((nodeDirty || connectionDirty) && !confirm("重新载入将放弃当前草稿，确认继续？"))return;if(managedLine)openSection(managedLine,"service");}}>重新载入所属服务</button></div>}
                    <fieldset className="node-config-section" disabled={connectionBusy || serviceChanged}>
                    {editing.id && <legend>协议与证书</legend>}
                    {!editing.id && (
                        <div className="pad node-creation-mode">
                            <details>
                            <summary>高级：共用现有节点的服务</summary>
                            <AdminChoiceGroup
                                label="新增方式"
                                value={creationMode}
                                disabled={nodeBusy}
                                options={[
                                    { value: "new", label: "独立部署新节点" },
                                    { value: "reuse", label: "为现有节点添加连接线路" },
                                ]}
                                onChange={(mode) => {
                                    if (
                                        mode === creationMode ||
                                        nodeBusy
                                    )
                                        return;
                                    if (
                                        nodeDirty &&
                                        !window.confirm(
                                            "切换新增方式将放弃尚未保存的配置，确认切换？",
                                        )
                                    )
                                        return;
                                    setNodeDirty(false);
                                    setPreflightShown(false);
                                    setCreationMode(mode);
                                }}
                            />

                            </details>
                            {creationMode === "reuse" && <p role="status">当前节点共用现有代理服务的协议、监听、证书和倍率，无需重复部署。</p>}
                        </div>
                    )}
                    {!editing.id && creationMode === "reuse" ? (
                        <State
                            loading={d.loading || groups.loading}
                            error={d.error || groups.error}
                            retry={() => {
                                d.reload();
                                groups.reload();
                            }}
                        >
                            <NodeConnectionEditor
                                embedded
                                node={{ type }}
                                nodes={nodeRows}
                                groups={rows(groups.data)}
                                close={closeNode}
                                onSaved={d.reload}
                                onDirty={setNodeDirty}
                                onBusyChange={setNodeBusy}
                                onCreated={node=>{const service=serviceMap.get(`${node.type}:${node.service_id}`);setNodeDirty(false);setManagedLine(node);setConnectionNode(null);if(service){setType(service.type);setEditing(service);}else setEditing(null);}}
                            />
                        </State>
                    ) : (
                        <>
                            {editing.id && (
                                <details className="pad node-editor-intro"><summary>配置说明与变更影响</summary>
                                    <p>
                                        此处维护协议、监听和证书。
                                    </p>

                                    <p className="muted">
                                        切换协议可能清除不兼容配置；高级扩展参数仍会保留。
                                    </p>
                                </details>
                            )}
                            <div className="pad node-editor-backend"><strong>节点服务：V2Box / sing-box</strong></div>
                            <State
                                data={schema.data && groups.data && routes.data && topology.data ? true : null}
                                loading={
                                    schema.loading ||
                                    groups.loading ||
                                    routes.loading ||
                                    topology.loading
                                }
                                error={
                                    schema.error ||
                                    groups.error ||
                                    routes.error ||
                                    topology.error
                                }
                                retry={() => {
                                    schema.reload();
                                    groups.reload();
                                    routes.reload();
                                    topology.reload();
                                }}
                            >
                                <Editor
                                    key={`${type}:${editing.id || "new"}:${configurationVersion}`}
                                    onDirty={() => setNodeDirty(true)}
                                    onBusyChange={setNodeBusy}
                                    submit="保存节点配置"
                                    resolveFields={(fields, values) => {
                                        const presented =
                                            nodeEditorPresentation(
                                                formPresentation(
                                                    nodeFields(
                                                        type,
                                                        fields,
                                                        values,
                                                    ),
                                                    "nodes",
                                                ),
                                            );
                                        for (const field of presented) if (field.key === "tls_settings.dns_credential_id") {
                                            field.options = certificateCredentialOptions(values, topology.data);
                                        }
                                        return editing.id
                                            ? nodeServiceFields(presented.filter(
                                                  (field) =>
                                                      !serviceLineFields.has(
                                                          field.key,
                                                      ) && !(managedService && Number(values.tls)===1 && ["disable_sni"].includes(field.key)),
                                              ))
                                            : nodeSetupFields(
                                                  presented,
                                                  values,
                                                  topology.data,
                                                  nodeLineFields(rows(groups.data),catalog),
                                              );
                                    }}
                                    preview={(values) => {
                                        const assignments: Row[] =
                                            topology.data?.assignments || [];
                                        const servers: Row[] =
                                            topology.data?.servers || [];
                                        const automatic =
                                            !editing.id &&
                                            values.setup_mode === "managed";
                                        const root = (
                                            topology.data?.credentials || []
                                        ).find(
                                            (r: Row) =>
                                                Number(r.id) ===
                                                Number(
                                                    values.setup_credential_id,
                                                ),
                                        );
                                        const domain = root
                                            ? `${values.setup_prefix || "自动生成子域名"}.${root.root_domain}`
                                            : "选择根域名后自动建立";
                                        const origin = automatic
                                            ? {
                                                  domain,
                                                  server_id: Number(
                                                      values.setup_server_id,
                                                  ),
                                                  entry_id:
                                                      values.setup_access_mode ===
                                                      "relay"
                                                          ? Number(
                                                                values.setup_entry_id,
                                                            )
                                                          : null,
                                              }
                                            : assignments.find(
                                                  (a) =>
                                                      a.node_type === type &&
                                                      a.node_id === editing.id,
                                              );
                                        const entry = assignments.find(
                                            (a) => a.id === origin?.entry_id,
                                        );
                                        const connectionDomain =
                                            entry?.domain || domain;
                                        const connectionPort = entry
                                            ? values.setup_entry_port
                                            : values.server_port;
                                        const service =
                                            automatic &&
                                            Number(values.tls) === 1
                                                ? {
                                                      ...values,
                                                      tls_settings: {
                                                          ...values.tls_settings,
                                                          server_name:
                                                              values["tls_settings.server_name"] || values.tls_settings?.server_name || domain,
                                                      },
                                                  }
                                                : values;
                                        const topologyPreview = (
                                            <NodeTopology
                                                service={service}
                                                origin={origin}
                                                entry={entry}
                                                server={
                                                    servers.find(
                                                        (s) =>
                                                            s.id ===
                                                            origin?.server_id,
                                                    ) ||
                                                    (automatic
                                                        ? {
                                                              name:
                                                                  values.name ||
                                                                  "自动创建服务器",
                                                          }
                                                        : undefined)
                                                }
                                                entryServer={servers.find(
                                                    (s) =>
                                                        s.id ===
                                                        entry?.server_id,
                                                )}
                                                host={
                                                    automatic
                                                        ? connectionDomain
                                                        : values.host
                                                }
                                                port={
                                                    automatic
                                                        ? connectionPort
                                                        : values.port
                                                }
                                                shared={
                                                    entry?.connection_count || 0
                                                }
                                                serviceConnections={
                                                    nodeRows.filter(
                                                        (n) =>
                                                            n.type === type &&
                                                            n.service_id ===
                                                                editing.id,
                                                    ).length
                                                }
                                            />
                                        );
                                        const problems =
                                            nodeConfigurationProblems(
                                                values,
                                                type,
                                                topology.data,
                                            ).filter(
                                                (problem) =>
                                                    (!editing.id ||
                                                        !serviceLineFields.has(
                                                            problem.key.split(
                                                                ".",
                                                            )[0],
                                                        )) &&
                                                    (problem.key.startsWith(
                                                        "setup_",
                                                    ) ||
                                                        !!schema.data?.[
                                                            problem.key.split(
                                                                ".",
                                                            )[0]
                                                        ]),
                                            );
                                        return (
                                            <>
                                                {preflightShown && problems.length > 0 && (
                                                    <section
                                                        className="node-config-problems"
                                                        aria-label="配置预检"
                                                        aria-live="polite"
                                                    >
                                                        <strong>
                                                            {`请处理 ${problems.length} 项配置问题`}
                                                        </strong>
                                                        {problems.length >
                                                            0 && (
                                                            <ul>
                                                                {problems.map(
                                                                    (
                                                                        problem,
                                                                    ) => (
                                                                        <li
                                                                            key={
                                                                                problem.key +
                                                                                problem.message
                                                                            }
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                className="link"
                                                                                onClick={(
                                                                                    event,
                                                                                ) => {
                                                                                    const label =
                                                                                        Array.from(
                                                                                            event.currentTarget
                                                                                                .closest(
                                                                                                    "form",
                                                                                                )
                                                                                                ?.querySelectorAll<HTMLElement>(
                                                                                                    "[data-field]",
                                                                                                ) ||
                                                                                                [],
                                                                                        ).find(
                                                                                            (
                                                                                                item,
                                                                                            ) =>
                                                                                                item
                                                                                                    .dataset
                                                                                                    .field ===
                                                                                                problem.key,
                                                                                        );
                                                                                    label?.scrollIntoView(
                                                                                        {
                                                                                            block: "center",
                                                                                            behavior:
                                                                                                "smooth",
                                                                                        },
                                                                                    );
                                                                                    label
                                                                                        ?.querySelector<HTMLElement>(
                                                                                            "input,select,textarea,button",
                                                                                        )
                                                                                        ?.focus();
                                                                                }}
                                                                            >
                                                                                {
                                                                                    problem.message
                                                                                }
                                                                            </button>
                                                                        </li>
                                                                    ),
                                                                )}
                                                            </ul>
                                                        )}
                                                    </section>
                                                )}
                                                {!editing.id && (
                                                    <details className="node-editor-path">
                                                        <summary>
                                                            <strong>
                                                                连接路径预览
                                                            </strong>
                                                            <span>
                                                                {automatic
                                                                    ? connectionDomain
                                                                    : values.host ||
                                                                      "待填写连接地址"}
                                                                :
                                                                {automatic
                                                                    ? connectionPort
                                                                    : values.port ||
                                                                      "—"}
                                                            </span>
                                                        </summary>
                                                        {topologyPreview}
                                                    </details>
                                                )}
                                            </>
                                        );
                                    }}
                                    validate={(values) => {
                                        const problems =
                                            nodeConfigurationProblems(
                                                values,
                                                type,
                                                topology.data,
                                            ).filter(
                                                (problem) =>
                                                    (!editing.id ||
                                                        !serviceLineFields.has(
                                                            problem.key.split(
                                                                ".",
                                                            )[0],
                                                        )) &&
                                                    (problem.key.startsWith(
                                                        "setup_",
                                                    ) ||
                                                        !!schema.data?.[
                                                            problem.key.split(
                                                                ".",
                                                            )[0]
                                                        ]),
                                            );
                                        if (problems.length) {
                                            setPreflightShown(true);
                                            return `配置预检发现 ${problems.length} 项问题，请按提示调整。`;
                                        }
                                    }}
                                    linkValues={(key, next, values) => {
                                        const linked = linkNode(key, next, values);
                                        if (!editing.id && ["setup_entry_id", "setup_credential_id", "setup_access_mode", "tls_settings.cert_mode"].includes(key)
                                            && linked["tls_settings.cert_mode"] === "dns" && !linked["tls_settings.dns_credential_id"] && !linked["tls_settings.dns_env"]) {
                                            const options = certificateCredentialOptions(linked, topology.data);
                                            if (options.length === 2) linked["tls_settings.dns_credential_id"] = options[1][0];
                                        }
                                        return linked;
                                    }}
                                    fields={nodeSettingsFields(
                                        Object.entries(schema.data || {})
                                            .filter(
                                                ([k]) =>
                                                    !k.includes(".") &&
                                                    k !== "id" &&
                                                    k !== "service_id",
                                            )
                                            .map(([k, rule]) => {
                                                if (
                                                    k === "group_id" ||
                                                    k === "route_id"
                                                )
                                                    return {
                                                        key: k,
                                                        label:
                                                            k === "route_id"
                                                                ? "sing-box 路由规则"
                                                                : nodeLabels[
                                                                      k
                                                                  ] || k,
                                                        hint:
                                                            k === "route_id"
                                                                ? "在路由管理中维护规则；仅显示当前内核的规则，按选择顺序应用。"
                                                                : undefined,
                                                        type: "multiselect",
                                                        required:
                                                            k === "group_id",
                                                        options: rows(
                                                            k === "group_id"
                                                                ? groups.data
                                                                : routes.data,
                                                        )
                                                            .filter(
                                                                (r) =>
                                                                    k !==
                                                                        "route_id" ||
                                                                    (r.backend ||
                                                                        "v2box") ===
                                                                        type,
                                                            )
                                                            .map((r) => [
                                                                String(r.id),
                                                                r.name ||
                                                                    r.remarks ||
                                                                    String(
                                                                        r.id,
                                                                    ),
                                                            ]),
                                                    } as Field;
                                                const str = Array.isArray(rule)
                                                    ? rule.join("|")
                                                    : String(rule);
                                                if (k === "flow")
                                                    return {
                                                        key: k,
                                                        label: "VLESS Flow",
                                                        type: "select",
                                                        nullable: true,
                                                        options: [
                                                            ["", "不设置"],
                                                            [
                                                                "xtls-rprx-vision",
                                                                "XTLS Vision",
                                                            ],
                                                        ],
                                                    } as Field;
                                                if (k === "region_code")
                                                    return {
                                                        key: k,
                                                        label: nodeLabels[k],
                                                        type: "select",
                                                        nullable: true,
                                                        options: [
                                                            [
                                                                "",
                                                                "保留原节点名称",
                                                            ],
                                                            ...Object.entries(
                                                                nodeLocations,
                                                            ).map(
                                                                ([
                                                                    code,
                                                                    names,
                                                                ]) => [
                                                                    code,
                                                                    `${names["zh-CN"]} (${code})`,
                                                                ],
                                                            ),
                                                        ],
                                                    } as Field;
                                                const enumRule =
                                                    str.match(
                                                        /(?:^|\|)in:([^|]+)/,
                                                    );
                                                if (enumRule)
                                                    return {
                                                        key: k,
                                                        label:
                                                            nodeLabels[k] || k,
                                                        type:
                                                            enumRule[1] ===
                                                                "0,1" &&
                                                            [
                                                                "show",
                                                                "tls",
                                                                "allow_insecure",
                                                                "tls_allow_insecure",
                                                                "is_shield",
                                                                "insecure",
                                                            ].includes(k)
                                                                ? "switch"
                                                                : "select",
                                                        required:
                                                            str.includes(
                                                                "required",
                                                            ),
                                                        options: enumRule[1]
                                                            .split(",")
                                                            .map((v) => [v, v]),
                                                    } as Field;
                                                return field(
                                                    k,
                                                    nodeLabels[k] || k,
                                                    str.includes("array") ||
                                                        k.endsWith("_settings")
                                                        ? "json"
                                                        : str.includes(
                                                                "integer",
                                                            ) ||
                                                            str.includes(
                                                                "numeric",
                                                            )
                                                          ? "number"
                                                          : "text",
                                                    str.includes("required"),
                                                );
                                            }),
                                    )}
                                    initial={nodeSettingsInitial({
                                        ...editing,
                                        ...(!editing.id
                                            ? {
                                                  setup_mode: "managed",
                                                  setup_access_mode: "direct",
                                                  setup_entry_id: "",
                                                  setup_entry_port: 443,
                                                  setup_credential_id: "",
                                                  "tls_settings.cert_mode":
                                                      "http",
                                                  setup_family: "ipv4",
                                                  setup_server_id: "",
                                                  server_port:
                                                      editing.server_port ||
                                                      443,
                                              }
                                            : {}),
                                    })}
                                    onSave={async (b) => {
                                        if(serviceChanged)throw new Error("节点所属代理服务已变更，请重新载入后再保存。");
                                        if(connectionBusy)throw new Error("连接与域名正在保存，请稍后再保存协议与证书。");
                                        if(editing.id && managedService && Number(b.tls)===1){b.disable_sni=0;}
                                        const impact =
                                            editing.id && type === editing.type
                                                ? nodeChangeImpact(
                                                      nodeSettingsInitial(
                                                          editing,
                                                      ),
                                                      b,
                                                  )
                                                : [];
                                        if (impact.length) {
                                            const count = nodeRows.filter(
                                                (n) =>
                                                    n.type === type &&
                                                    n.service_id === editing.id,
                                            ).length;
                                            if (
                                                !window.confirm(
                                                    `将修改${impact.join("、")}，影响本服务${count ? `及 ${count} 条关联线路` : "的默认线路"}，可能中断连接。确认保存？`,
                                                )
                                            )
                                                throw new Error(
                                                    "已取消保存，修改仍保留在表单中。",
                                                );
                                        }
                                        b = nodeSettingsPayload(b);
                                        if (
                                            b.padding_scheme != null &&
                                            typeof b.padding_scheme !== "string"
                                        )
                                            b.padding_scheme = JSON.stringify(
                                                b.padding_scheme,
                                            );
                                        const clean: Row = {};
                                        Object.keys(schema.data || {}).forEach(
                                            (k) => {
                                                if (
                                                    !k.includes(".") &&
                                                    b[k] !== undefined &&
                                                    (!editing.id ||
                                                        !serviceLineFields.has(
                                                            k,
                                                        ))
                                                )
                                                    clean[k] = b[k];
                                            },
                                        );
                                        if (!editing.id) {
                                            const setup = nodeSetupPayload(b);
                                            if (setup)
                                                clean.deployment_setup = setup;
                                        }
                                        if (editing.id) clean.id = editing.id;
                                        clean.zero_rtt_handshake ??=
                                                editing.zero_rtt_handshake ?? 0;
                                        const saved = await request(
                                            admin(`server/${type}/save`),
                                            clean,
                                        );
                                        if(editing.id)reloadConfigurationSource.current=d.data;
                                        setNodeDirty(false);
                                        setSavedNodeNotice(
                                            clean.deployment_setup
                                                ? "节点、服务器与域名已一并保存。请生成一键部署命令，在服务器执行。"
                                                : "节点配置已保存。请检查节点最近通信和运行状态；协议、端口或内核变更可能需要同步部署配置。",
                                        );
                                        setEditing(!editing.id ? null : {...editing,...b});
                                        d.reload();
                                        if(editing.id && managedService && Number(b.server_port)!==Number(editing.server_port)){
                                            setSavedNodeNotice("监听端口已保存。等待节点应用后将自动验证并同步连接端口；中转线路请确认转发配置。");
                                            setEditing({...editing,...b,type:editing.type,id:editing.id});
                                        }
                                        if (!editing.id) {
                                            const updated = await request<
                                                Row[]
                                            >(admin("server/manage/getNodes"));
                                            const converted = rows(
                                                updated.data,
                                            ).find(
                                                (r) =>
                                                    r.type === type &&
                                                    r.id === saved.data.id,
                                            );
                                            if (converted) {
                                                setManagedLine(converted);
                                                setCredentialNode({
                                                    ...converted,
                                                    _new: !editing.id,
                                                    _domainConfigured:
                                                        !!clean.deployment_setup,
                                                });
                                            }
                                        }
                                    }}
                                />
                            </State>
                        </>
                    )}
                    </fieldset>
                </Modal>
            )}
        </>
    );
}
const nodeLabels: Record<string, string> = {
    listen_ip: "监听地址",
    disable_sni: "禁用 SNI",
    cipher: "加密算法",
    encryption: "VLESS 加密方式",
    encryption_settings: "VLESS 加密设置",
    zero_rtt_handshake: "启用 0-RTT 握手",
    congestion_control: "拥塞控制算法",
    udp_relay_mode: "UDP 中继模式",
    padding_scheme: "填充策略",
    version: "协议版本",
    server_name: "TLS 服务器名称（SNI）",
    insecure: "跳过证书校验",
    allow_insecure: "跳过证书校验",
    obfs_password: "混淆密码",
    networkSettings: "传输设置",
    tlsSettings: "TLS 设置",
    ruleSettings: "路由设置",
    dnsSettings: "DNS 设置",
    name: "节点名称",
    host: "连接主机",
    port: "连接端口",
    server_port: "监听端口",
    group_id: "权限组",
    route_id: "路由规则",
    rate: "计费倍率",
    tags: "标签数组",
    region_code: "国家 / 地区",
    city_code: "州 / 省或城市",
    display_label: "线路编号 / 后缀（例如 A）",
    service_id: "代理服务 ID",
    protocol: "协议",
    network: "传输方式",
    network_settings: "传输设置",
    tls: "TLS 模式",
    tls_settings: "TLS 设置",
    reality_settings: "Reality 设置",
    security: "加密方式",
    obfs: "混淆方式",
    obfs_settings: "混淆设置",
    show: "展示",
    sort: "排序",
    up_mbps: "上传 Mbps",
    down_mbps: "下载 Mbps",
    trusted_x_forwarded_for: "信任的 X-Forwarded-For",
    udp: "启用 UDP",
};
