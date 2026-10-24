import { AdminRowMenu } from "./AdminRowMenu";
import {
    DefaultNodeLineEditor,
    serviceLineFields,
} from "./DefaultNodeLineEditor";
import { NodeSetupGuide } from "./NodeSetupGuide";
import { AdminChoiceGroup } from "./AdminChoices";
import { nodeConfigurationProblems, nodeChangeImpact } from "./node-guidance";
import { nodeSetupFields, nodeSetupPayload } from "./node-setup";
import { NodeConnectionEditor, NodeForwarding } from "./NodeConnections";
import { NodeTopology } from "./NodeTopology";
import { NodeDictionaryProvider } from "./node-dictionary";
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
    type NodeBackendType,
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
    nodeBackendInitial,
    nodeEditorPresentation,
    nodeSettingsFields,
    nodeSettingsInitial,
    nodeSettingsPayload,
} from "./node-settings";
const nodeTypes = [
    "v2node",
    "v2box",
] as const satisfies readonly NodeBackendType[];
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
        return /^(v2box|v2node):[1-9][0-9]*$/.test(value) ? value : "";
    };
    const [serviceFocus, setServiceFocus] = useState(serviceFocusFromHash);
    useEffect(() => {
        const update = () => setServiceFocus(serviceFocusFromHash());
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);
    const [managedLine, setManagedLine] = useState<Row | null>(null);
    const [creationMode, setCreationMode] = useState<"new" | "reuse">("new");
    const [creationLocked, setCreationLocked] = useState(false);
    const [defaultLine, setDefaultLine] = useState<Row | null>(null);
    const [connectionNode, setConnectionNode] = useState<Row | null>(null);
    const [nodeDirty, setNodeDirty] = useState(false);
    const [nodeBusy, setNodeBusy] = useState(false);
    const [conversionOpen, setConversionOpen] = useState(false);
    const [savedNodeNotice, setSavedNodeNotice] = useState("");
    const [preflightShown, setPreflightShown] = useState(false);

    const [diagnosticNode, setDiagnosticNode] = useState<Row | null>(null);
    const [credentialNode, setCredentialNode] = useState<Row | null>(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [nodeSearch, setNodeSearch] = useState("");
    const [backendFilter, setBackendFilter] = useState("");
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [onlyMaintenance, setOnlyMaintenance] = useState(false);
    const [quotaFilter, setQuotaFilter] = useState(false);

    const groups = useData<Row[]>(admin("server/group/fetch"));
    const routes = useData<Row[]>(admin("server/route/fetch"));
    const d = useData<Row[]>(admin("server/manage/getNodes"));
    const [type, setType] = useState("v2box"),
        [editing, setEditing] = useState<Row | null>(null);
    const topology = useData<Row>(editing ? admin("server/ddns/fetch") : "");
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
        setConversionOpen(false);
        setCreationMode("new");
        setCreationLocked(false);
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
        if (nodeBusy) return;
        if (nodeDirty && !window.confirm("节点配置尚未保存，确认放弃修改？"))
            return;
        setEditing(null);
    }
    const nodeRows = rows(d.data);
    const viewRows = nodeRows;
    const serviceMap = useMemo(
        () =>
            new Map(
                nodeRows
                    .filter((n) => !n.service_id)
                    .map((n) => [`${n.type}:${n.id}`, n]),
            ),
        [d.data],
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
            <div className="pad">
                <AdminChoiceGroup
                    label="节点编辑"
                    variant="navigation"
                    value={section}
                    disabled={busy || d.loading}
                    options={[
                        { value: "line", label: "线路信息" },
                        { value: "service", label: "服务配置" },
                        { value: "deploy", label: "部署" },
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
                {managedLine.service_id && section !== "line" && (
                    <p className="muted">
                        此线路复用「
                        {
                            serviceMap.get(
                                `${managedLine.type}:${managedLine.service_id}`,
                            )?.name
                        }
                        」的服务配置。更改协议、监听或证书将影响共用该服务的全部线路。
                    </p>
                )}
            </div>
        );
    }
    useEffect(() => {
        if (!serviceFocus || !nodeRows.length) return;
        const service = serviceMap.get(serviceFocus);
        if (service) openSection(service, "service");
        setServiceFocus("");
    }, [serviceFocus, d.data]);
    const filteredNodes = viewRows.filter(
        (n) =>
            (!onlyIssues || !!n.issues?.length) &&
            (!onlyMaintenance || !!n.maintenance) &&
            (!backendFilter || n.type === backendFilter) &&
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
                    "独立"
                ),
        ],
        ["server_port", "监听端口"],
        [
            "connections",
            "关联线路",
            (r) =>
                `${1 + (connectionCounts.get(`${r.type}:${r.id}`) || 0)} 条（含默认线路）`,
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
                    title={`${nodeRuntimeLabels[r.runtime_status] || nodeRuntimeLabels.unknown} · 最近通信：${date(Math.max(Number(r.last_check_at || 0), Number(r.last_push_at || 0)))}`}
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
            (r) =>
                r.service_id ? `${r.online ?? "—"}（共享）` : (r.online ?? "—"),
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
    const columnStorageKey = "admin.nodes.columns.v1";
    const [visibleColumns, setVisibleColumns] = useState<string[] | null>(
        () => {
            try {
                const saved = JSON.parse(
                    localStorage.getItem(columnStorageKey) || "null",
                );
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
    const selectedColumns = visibleColumns ?? columns.map(([key]) => key);
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
            {savedNodeNotice && (
                <p className="pad success-message" role="status">
                    {savedNodeNotice}
                </p>
            )}
            <p className="pad muted">
                统一管理线路信息、服务配置与部署。复用线路共用协议、监听和证书。{" "}
                <a href="#/servers">服务器管理</a> ·{" "}
                <a href="#/node-domains">域名与解析</a>
            </p>
            {tab === "nodes" && <NodeSetupGuide />}
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
                    edit={(node) => openSection(node, "line")}
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
                        <div
                            className="node-management-summary"
                            aria-label="节点概况"
                        >
                            <div>
                                <span>{"全部节点"}</span>
                                <strong>{viewRows.length}</strong>
                            </div>
                            <div>
                                <span>{"展示中"}</span>
                                <strong>
                                    {
                                        viewRows.filter(
                                            (n) => Number(n.show) === 1,
                                        ).length
                                    }
                                </strong>
                            </div>
                            <div>
                                <span>{"已隐藏"}</span>
                                <strong>
                                    {
                                        viewRows.filter(
                                            (n) => Number(n.show) !== 1,
                                        ).length
                                    }
                                </strong>
                            </div>
                            <div>
                                <span>{"复用线路"}</span>
                                <strong>
                                    {
                                        viewRows.filter((n) => !!n.service_id)
                                            .length
                                    }
                                </strong>
                            </div>
                        </div>
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
                            <label>
                                {"筛选节点类型"}
                                <select
                                    value={backendFilter}
                                    onChange={(e) =>
                                        setBackendFilter(e.target.value)
                                    }
                                >
                                    <option value="">全部类型</option>
                                    <option value="v2node">V2Node</option>
                                    <option value="v2box">V2Box</option>
                                </select>
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
                                显示 {filteredNodes.length} / {viewRows.length}{" "}
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
                    key={`${credentialNode.type}:${credentialNode.id}`}
                    navigation={(busy, dirty) =>
                        editorNavigation("deploy", busy, dirty)
                    }
                    editorName={managedLine?.name}
                    node={credentialNode}
                    scope={
                        credentialNode._domainOnly ? "connection" : "service"
                    }
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
                            : creationLocked
                              ? "节点线路配置"
                              : "新增节点"
                    }
                    variant="drawer"
                    wide
                    className={`node-editor-dialog${editing.id ? "" : " node-editor-create"}`}
                    dismissible={!nodeBusy}
                    close={closeNode}
                >
                    {editing.id &&
                        editorNavigation("service", nodeBusy, nodeDirty)}
                    {!editing.id && (
                        <div className="pad node-creation-mode">
                            <AdminChoiceGroup
                                label="新增方式"
                                value={creationMode}
                                disabled={nodeBusy || creationLocked}
                                options={[
                                    { value: "new", label: "新建代理服务" },
                                    { value: "reuse", label: "复用已有服务" },
                                ]}
                                onChange={(mode) => {
                                    if (
                                        mode === creationMode ||
                                        nodeBusy ||
                                        creationLocked
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
                            <p className="muted">
                                {creationMode === "new"
                                    ? "新建独立服务，配置协议与域名，保存后部署。"
                                    : "为已有服务添加直连或中转线路，共用用户认证与服务器额度，无需重复部署落地服务。"}
                            </p>
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
                                onCreated={() => setCreationLocked(true)}
                            />
                        </State>
                    ) : (
                        <>
                            {editing.id && (
                                <div className="pad node-editor-intro">
                                    <p>
                                        此处仅维护代理服务配置。节点名称、权限、倍率和展示信息请切换到“线路信息”修改。
                                    </p>
                                    <p>
                                        保存后请核对节点通信与运行状态，确认配置已应用。
                                    </p>
                                    <p className="muted">
                                        切换协议可能清除不兼容配置；高级扩展参数仍会保留。
                                    </p>
                                </div>
                            )}
                            <div className="pad node-editor-backend">
                                {editing.id && (
                                    <strong>
                                        节点服务：
                                        {type === "v2box"
                                            ? "V2Box / sing-box"
                                            : "V2Node / Xray"}
                                    </strong>
                                )}
                                {editing.id && !conversionOpen ? (
                                    <button
                                        type="button"
                                        disabled={nodeBusy}
                                        onClick={() => setConversionOpen(true)}
                                    >
                                        转换节点类型…
                                    </button>
                                ) : (
                                    <label>
                                        节点类型
                                        <select
                                            aria-label="节点类型"
                                            value={type}
                                            disabled={nodeBusy}
                                            onChange={(event) => {
                                                if (
                                                    nodeDirty &&
                                                    !window.confirm(
                                                        "切换节点类型将重新载入已保存配置，未保存修改会丢失，是否继续？",
                                                    )
                                                )
                                                    return;
                                                setType(event.target.value);
                                                setNodeDirty(true);
                                            }}
                                        >
                                            {nodeTypes.map((t) => (
                                                <option key={t} value={t}>
                                                    {t === "v2box"
                                                        ? "V2Box / sing-box"
                                                        : "V2Node / Xray"}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                {conversionOpen && (
                                    <p className="alert">
                                        类型转换会分配目标类型节点
                                        ID，并需要重新部署服务。保存前请重新选择路由并核对协议参数。
                                    </p>
                                )}
                            </div>
                            {editing.id && type !== editing.type && (
                                <p className="pad muted">
                                    保存后会将此节点转换为 {type}
                                    ，分配目标类型的节点
                                    ID。请重新选择对应路由并核对协议参数；保存后需要更换节点服务及安装配置。切换类型会重新载入已保存配置。
                                </p>
                            )}
                            <State
                                loading={
                                    schema.loading ||
                                    groups.loading ||
                                    routes.loading ||
                                    (!editing.id && topology.loading)
                                }
                                error={
                                    schema.error ||
                                    groups.error ||
                                    routes.error ||
                                    (!editing.id ? topology.error : "")
                                }
                                retry={() => {
                                    schema.reload();
                                    groups.reload();
                                    routes.reload();
                                    topology.reload();
                                }}
                            >
                                <Editor
                                    key={`${type}:${editing.id || "new"}`}
                                    onDirty={() => setNodeDirty(true)}
                                    onBusyChange={setNodeBusy}
                                    submit={
                                        editing.id && type !== editing.type
                                            ? "确认转换并保存"
                                            : "保存节点配置"
                                    }
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
                                        return editing.id
                                            ? presented.filter(
                                                  (field) =>
                                                      !serviceLineFields.has(
                                                          field.key,
                                                      ),
                                              )
                                            : nodeSetupFields(
                                                  presented,
                                                  values,
                                                  topology.data,
                                                  type,
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
                                                              connectionDomain,
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
                                        const changes = editing.id
                                            ? nodeChangeImpact(
                                                  nodeSettingsInitial(editing),
                                                  values,
                                              )
                                            : [];
                                        const affected = nodeRows.filter(
                                            (n) =>
                                                n.type === editing.type &&
                                                n.service_id === editing.id,
                                        ).length;
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
                                                {changes.length > 0 && (
                                                    <aside
                                                        className="node-config-impact"
                                                        aria-label="变更影响"
                                                    >
                                                        <strong>
                                                            待保存变更：
                                                            {changes.join("、")}
                                                        </strong>
                                                        <p>
                                                            将影响本服务
                                                            {affected
                                                                ? `及 ${affected} 条关联线路`
                                                                : "的默认线路"}
                                                            。监听、协议或证书调整可能中断连接；请安排维护时间，保存后核对配置应用结果。
                                                        </p>
                                                    </aside>
                                                )}
                                                <div className="node-config-preflight">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setPreflightShown(
                                                                true,
                                                            )
                                                        }
                                                    >
                                                        检查配置
                                                    </button>
                                                    <span className="muted">
                                                        保存前检查协议、域名、证书及服务器关联
                                                    </span>
                                                </div>
                                                {preflightShown && (
                                                    <section
                                                        className="node-config-problems"
                                                        aria-label="配置预检"
                                                        aria-live="polite"
                                                    >
                                                        <strong>
                                                            {problems.length
                                                                ? `请处理 ${problems.length} 项配置问题`
                                                                : "配置预检通过"}
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
                                                {editing.id ? (
                                                    topologyPreview
                                                ) : (
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
                                    linkValues={linkNode}
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
                                                                ? type ===
                                                                  "v2box"
                                                                    ? "sing-box 路由规则"
                                                                    : "Xray 路由规则"
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
                                                                        "v2node") ===
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
                                        ...nodeBackendInitial(editing, type),
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
                                        if (
                                            editing.id &&
                                            type !== editing.type &&
                                            !window.confirm(
                                                "确认转换节点类型并保存？此操作会更换节点 ID，之后需要更新节点服务和安装配置。",
                                            )
                                        )
                                            throw new Error(
                                                "已取消转换，配置尚未保存。",
                                            );
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
                                        const converting =
                                            editing.id && type !== editing.type;
                                        if (converting) {
                                            clean.source_type = editing.type;
                                            clean.source_id = editing.id;
                                        } else if (editing.id)
                                            clean.id = editing.id;
                                        if (["v2node", "v2box"].includes(type))
                                            clean.zero_rtt_handshake ??=
                                                editing.zero_rtt_handshake ?? 0;
                                        const saved = await request(
                                            admin(`server/${type}/save`),
                                            clean,
                                        );
                                        setNodeDirty(false);
                                        setSavedNodeNotice(
                                            clean.deployment_setup
                                                ? "节点、服务器与域名已一并保存。请生成一键部署命令，在服务器执行。"
                                                : "节点配置已保存。请检查节点最近通信和运行状态；协议、端口或内核变更可能需要同步部署配置。",
                                        );
                                        setEditing(null);
                                        d.reload();
                                        if (converting || !editing.id) {
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
    server_port: "服务端口",
    group_id: "权限组",
    route_id: "路由规则",
    rate: "流量倍率",
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
