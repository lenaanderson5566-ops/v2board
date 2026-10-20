import { NodeDictionaryProvider } from "./node-dictionary";
import { AdminChoiceGroup } from "./AdminChoices";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { field, nameColumn } from "./admin-fields";
import { useEffect, useState, type ComponentProps } from "react";
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
import { AdminDDNS } from "./AdminDDNS";
import { NodeDiagnostics, nodeRuntimeLabels } from "./AdminDiagnostics";
import { AdminLightsail } from "./AdminLightsail";
import { ServerTrafficBudgets } from "./ServerTrafficBudgets";
import { sortPayload } from "./admin-actions";
import { linkNode, nodeFields } from "./admin-linkage";
import { formPresentation } from "./admin-presentation";
import { AdminSwitch } from "./admin-switch";
import { SortButton } from "./admin-tools";
import { nodeDeploymentCommand, nodeIPCommand } from "./node-deployment";
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
export function Nodes(props: {initialTab?: "nodes" | "ddns" | "lightsail" | "traffic"}) { return <NodeDictionaryProvider><NodesContent {...props} /></NodeDictionaryProvider>; }
function NodesContent({
    initialTab = "nodes",
}: { initialTab?: "nodes" | "ddns" | "lightsail" | "traffic" } = {}) {
    const [tab, setTab] = useState(initialTab);
    const [nodeDirty, setNodeDirty] = useState(false);
    const [nodeBusy, setNodeBusy] = useState(false);
    const [conversionOpen, setConversionOpen] = useState(false);
    const [savedNodeNotice, setSavedNodeNotice] = useState("");

    const [diagnosticNode, setDiagnosticNode] = useState<Row | null>(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [nodeSearch, setNodeSearch] = useState("");
    const [backendFilter, setBackendFilter] = useState("");
    const [quotaFilter, setQuotaFilter] = useState(false);

    const groups = useData<Row[]>(admin("server/group/fetch"));
    const routes = useData<Row[]>(admin("server/route/fetch"));
    const d = useData<Row[]>(admin("server/manage/getNodes"));
    const [type, setType] = useState("v2node"),
        [editing, setEditing] = useState<Row | null>(null);
    const [error, setError] = useState("");
    const [command, setCommand] = useState<Row | null>(null);
    const schema = useData<Row>(query(admin("console/nodeSchema"), { type }));
    useEffect(() => {
        setNodeDirty(false);
        setConversionOpen(false);
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
    const filteredNodes = nodeRows.filter(
        (n) =>
            (!backendFilter || n.type === backendFilter) &&
            (!statusFilter ||
                (n.runtime_status || "unknown") === statusFilter) &&
            (!quotaFilter || n.traffic_budget?.blocked) &&
            `${n.id} ${n.name} ${n.host} ${n.current_ip || ""} ${n.protocol || ""}`
                .toLowerCase()
                .includes(nodeSearch.trim().toLowerCase()),
    );

    const columns: ComponentProps<typeof Table>["columns"] = [
        ["id", "ID"],
        nameColumn,
        ["type", "类型"],
        ["protocol", "协议"],
        [
            "runtime_status",
            "运行状态",
            (r) => (
                <span
                    title={`最近通信：${date(Math.max(Number(r.last_check_at || 0), Number(r.last_push_at || 0)))}`}
                >
                    {nodeRuntimeLabels[r.runtime_status] ||
                        nodeRuntimeLabels.unknown}
                </span>
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
        ["online", "在线用户"],
        ["last_push_at", "最近流量上报", (r) => date(r.last_push_at)],
    ];
    const [visibleColumns, setVisibleColumns] = useState<string[] | null>(
        () => {
            try {
                const saved = JSON.parse(
                    localStorage.getItem("admin.nodes.columns.v1") || "null",
                );
                return Array.isArray(saved) &&
                    saved.every((key) => typeof key === "string")
                    ? saved
                    : null;
            } catch {
                return null;
            }
        },
    );
    useEffect(() => {
        try {
            localStorage.setItem(
                "admin.nodes.columns.v1",
                JSON.stringify(visibleColumns),
            );
        } catch {
            /* Storage may be disabled. */
        }
    }, [visibleColumns]);
    const selectedColumns = visibleColumns ?? columns.map(([key]) => key);
    const [showDisplay, setShowDisplay] = useState(false);

    return (
        <>
            {showDisplay && (
                <AdminDisplaySettings
                    title="节点显示设置"
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
                />
            )}
            {savedNodeNotice && (
                <p className="pad success-message" role="status">
                    {savedNodeNotice}
                </p>
            )}
            <AdminChoiceGroup
                variant="navigation"
                label="节点管理功能"
                value={tab}
                onChange={(value) => {
                    setTab(value);
                    if (value === "nodes") d.reload();
                }}
                options={[
                    { value: "nodes", label: "节点列表" },
                    { value: "ddns", label: "Cloudflare DDNS" },
                    { value: "lightsail", label: "Lightsail IP" },
                    { value: "traffic", label: "服务器流量" },
                ]}
            />
            {tab === "ddns" && <AdminDDNS />}
            {tab === "lightsail" && <AdminLightsail nodes={rows(d.data)} />}
            {tab === "traffic" && (
                <ServerTrafficBudgets nodes={rows(d.data)} onSaved={d.reload} />
            )}
            {tab === "nodes" && (
                <Panel
                    title="节点管理"
                    actions={
                        <>
                            <Reload onClick={d.reload} loading={d.loading} />
                            <button
                                type="button"
                                onClick={() => setShowDisplay(true)}
                            >
                                显示设置
                            </button>
                            <SortButton
                                path={admin("server/manage/sort")}
                                kind="nodes"
                                items={rows(d.data)}
                                onSaved={d.reload}
                            />
                            <button
                                className="primary"
                                onClick={() =>
                                    setEditing({
                                        type,
                                        group_id: [],
                                        route_id: [],
                                        rate: 1,
                                        tls: 0,
                                        network: "tcp",
                                        disable_sni: 0,
                                        zero_rtt_handshake: 0,
                                    })
                                }
                            >
                                添加节点
                            </button>
                        </>
                    }
                >
                    <State {...d}>
                        {error && <div className="alert">{error}</div>}
                        <div
                            className="node-management-summary"
                            aria-label="节点概况"
                        >
                            <div>
                                <span>全部节点</span>
                                <strong>{nodeRows.length}</strong>
                            </div>
                            <div>
                                <span>V2Node</span>
                                <strong>
                                    {
                                        nodeRows.filter(
                                            (n) => n.type === "v2node",
                                        ).length
                                    }
                                </strong>
                            </div>
                            <div>
                                <span>V2Box</span>
                                <strong>
                                    {
                                        nodeRows.filter(
                                            (n) => n.type === "v2box",
                                        ).length
                                    }
                                </strong>
                            </div>
                            <div>
                                <span>额度受限</span>
                                <strong>
                                    {
                                        nodeRows.filter(
                                            (n) => n.traffic_budget?.blocked,
                                        ).length
                                    }
                                </strong>
                            </div>
                        </div>
                        <div className="node-management-tools">
                            <label>
                                搜索节点
                                <input
                                    placeholder="ID、名称、域名、IP 或协议"
                                    value={nodeSearch}
                                    onChange={(e) =>
                                        setNodeSearch(e.target.value)
                                    }
                                />
                            </label>
                            <label>
                                筛选节点类型
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
                            <label>
                                筛选运行状态
                                <select
                                    value={statusFilter}
                                    onChange={(e) =>
                                        setStatusFilter(e.target.value)
                                    }
                                >
                                    <option value="">全部状态</option>
                                    {Object.entries(nodeRuntimeLabels).map(
                                        ([key, label]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ),
                                    )}
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
                                仅显示额度受限节点
                            </label>
                            <span className="muted">
                                显示 {filteredNodes.length} / {nodeRows.length}{" "}
                                个节点
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
                                        onClick={() => setDiagnosticNode(r)}
                                    >
                                        运行状态
                                    </button>
                                    {r.install_command && (
                                        <button onClick={() => setCommand(r)}>
                                            安装命令
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            setType(r.type);
                                            setEditing(r);
                                        }}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await request(
                                                    admin(
                                                        `server/${r.type}/copy`,
                                                    ),
                                                    { id: r.id },
                                                );
                                                d.reload();
                                            } catch (e) {
                                                setError((e as Error).message);
                                            }
                                        }}
                                    >
                                        复制
                                    </button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await request(
                                                    admin(
                                                        `server/${r.type}/update`,
                                                    ),
                                                    {
                                                        id: r.id,
                                                        show: r.show ? 0 : 1,
                                                    },
                                                );
                                                d.reload();
                                            } catch (e) {
                                                setError((e as Error).message);
                                            }
                                        }}
                                    >
                                        切换展示
                                    </button>
                                    <button
                                        className="danger"
                                        onClick={async () => {
                                            if (confirm("确认删除节点？")) {
                                                try {
                                                    await request(
                                                        admin(
                                                            `server/${r.type}/drop`,
                                                        ),
                                                        { id: r.id },
                                                    );
                                                    d.reload();
                                                } catch (e) {
                                                    setError(
                                                        (e as Error).message,
                                                    );
                                                }
                                            }
                                        }}
                                    >
                                        删除
                                    </button>
                                </>
                            )}
                        />
                    </State>
                </Panel>
            )}
            {command && (
                <Modal title="节点安装命令" close={() => setCommand(null)}>
                    <div className="pad">
                        <p>
                            可选：在节点管理的“Cloudflare
                            DDNS”保存凭据并绑定此节点，然后配置节点 IP 上报。
                        </p>
                        <p className="muted">
                            查询部署服务器公网 IPv4 /
                            IPv6：在节点服务器执行以下命令。DDNS
                            默认关闭，Cloudflare Token 加密保存在面板。
                        </p>
                        <textarea
                            aria-label="查询服务器 IP 命令"
                            readOnly
                            rows={3}
                            value={nodeIPCommand}
                        />
                        <button
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        nodeIPCommand,
                                    );
                                    setCommand({ ...command, ipCopied: true });
                                } catch {
                                    setCommand({
                                        ...command,
                                        error: "复制失败，请手动复制命令",
                                    });
                                }
                            }}
                        >
                            {command.ipCopied
                                ? "IP 查询命令已复制"
                                : "复制 IP 查询命令"}
                        </button>
                    </div>
                    <div className="pad">
                        <p className="muted">
                            命令包含节点通讯凭据，仅在目标服务器使用。
                        </p>
                        <textarea
                            readOnly
                            aria-label="节点安装命令"
                            value={nodeDeploymentCommand(command)}
                        />
                        <button
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        nodeDeploymentCommand(command),
                                    );
                                    setCommand({ ...command, copied: true });
                                } catch (e) {
                                    setCommand({
                                        ...command,
                                        error: (e as Error).message,
                                    });
                                }
                            }}
                        >
                            复制命令
                        </button>
                        {command.copied && <p role="status">已复制</p>}
                        {command.error && (
                            <p className="alert">{command.error}</p>
                        )}
                    </div>
                </Modal>
            )}
            {editing && (
                <Modal
                    title={
                        editing.id
                            ? `编辑节点 #${editing.id} · ${editing.name || ""}`
                            : "添加节点"
                    }
                    variant="drawer"
                    wide
                    className="node-editor-dialog"
                    dismissible={!nodeBusy}
                    close={closeNode}
                >
                    <div className="pad node-editor-intro">
                        <p>
                            依次核对连接地址、协议及权限组。保存配置成功不代表节点已应用，请结合节点最近通信与运行状态确认。
                        </p>
                        <p className="muted">
                            切换协议可能清除不兼容配置；高级 JSON
                            中未单列的扩展参数仍会保留。
                        </p>
                    </div>
                    <div className="pad node-editor-backend">
                        <strong>
                            节点服务：
                            {type === "v2box"
                                ? "V2Box / sing-box"
                                : "V2Node / Xray"}
                        </strong>
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
                                        <option key={t}>{t}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {conversionOpen && (
                            <p className="alert">
                                类型转换会分配目标类型节点
                                ID，并需要重新部署服务；这不是普通协议修改。保存前请重新选择路由与父节点。
                            </p>
                        )}
                    </div>
                    {editing.id && type !== editing.type && (
                        <p className="pad muted">
                            保存后会将此节点转换为 {type}，分配目标类型的节点
                            ID。请重新选择对应路由和父节点，并核对协议参数；保存后需要更换节点服务及安装配置。切换类型会重新载入已保存配置。
                        </p>
                    )}
                    <State
                        loading={
                            schema.loading || groups.loading || routes.loading
                        }
                        error={schema.error || groups.error || routes.error}
                        retry={() => {
                            schema.reload();
                            groups.reload();
                            routes.reload();
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
                            resolveFields={(fields, values) =>
                                nodeEditorPresentation(
                                    formPresentation(
                                        nodeFields(
                                            type,
                                            fields.map((field) =>
                                                field.key === "parent_id"
                                                    ? {
                                                          ...field,
                                                          label: "父节点",
                                                          type: "select",
                                                          nullable: true,
                                                          options: [
                                                              [
                                                                  "",
                                                                  "不设置父节点",
                                                              ],
                                                              ...rows(d.data)
                                                                  .filter(
                                                                      (r) =>
                                                                          r.type ===
                                                                              type &&
                                                                          String(
                                                                              r.id,
                                                                          ) !==
                                                                              String(
                                                                                  editing.id,
                                                                              ) &&
                                                                          (![
                                                                              "v2node",
                                                                              "v2box",
                                                                          ].includes(
                                                                              type,
                                                                          ) ||
                                                                              r.protocol ===
                                                                                  values.protocol),
                                                                  )
                                                                  .map(
                                                                      (r) =>
                                                                          [
                                                                              String(
                                                                                  r.id,
                                                                              ),
                                                                              r.name,
                                                                          ] as [
                                                                              string,
                                                                              string,
                                                                          ],
                                                                  ),
                                                          ] as [
                                                              string,
                                                              string,
                                                          ][],
                                                          hint: "可选择同类型、同协议的节点。切换协议时会清除当前选择。",
                                                      }
                                                    : field,
                                            ),
                                            values,
                                        ),
                                        "nodes",
                                    ),
                                )
                            }
                            linkValues={linkNode}
                            fields={nodeSettingsFields(
                                Object.entries(schema.data || {})
                                    .filter(
                                        ([k]) => !k.includes(".") && k !== "id",
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
                                                        ? type === "v2box"
                                                            ? "sing-box 路由规则"
                                                            : "Xray 路由规则"
                                                        : nodeLabels[k] || k,
                                                hint:
                                                    k === "route_id"
                                                        ? "在路由管理中维护规则；仅显示当前内核的规则，按选择顺序应用。"
                                                        : undefined,
                                                type: "multiselect",
                                                required: k === "group_id",
                                                options: rows(
                                                    k === "group_id"
                                                        ? groups.data
                                                        : routes.data,
                                                )
                                                    .filter(
                                                        (r) =>
                                                            k !== "route_id" ||
                                                            (r.backend ||
                                                                "v2node") ===
                                                                type,
                                                    )
                                                    .map((r) => [
                                                        String(r.id),
                                                        r.name ||
                                                            r.remarks ||
                                                            String(r.id),
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
                                                    ["", "保留原节点名称"],
                                                    ...Object.entries(
                                                        nodeLocations,
                                                    ).map(([code, names]) => [
                                                        code,
                                                        `${names["zh-CN"]} (${code})`,
                                                    ]),
                                                ],
                                            } as Field;
                                        const enumRule =
                                            str.match(/(?:^|\|)in:([^|]+)/);
                                        if (enumRule)
                                            return {
                                                key: k,
                                                label: nodeLabels[k] || k,
                                                type:
                                                    enumRule[1] === "0,1" &&
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
                                                    str.includes("required"),
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
                                                : str.includes("integer") ||
                                                    str.includes("numeric")
                                                  ? "number"
                                                  : "text",
                                            str.includes("required"),
                                        );
                                    }),
                            )}
                            initial={nodeSettingsInitial(
                                nodeBackendInitial(editing, type),
                            )}
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
                                b = nodeSettingsPayload(b);
                                if (
                                    b.padding_scheme != null &&
                                    typeof b.padding_scheme !== "string"
                                )
                                    b.padding_scheme = JSON.stringify(
                                        b.padding_scheme,
                                    );
                                const clean: Row = {};
                                Object.keys(schema.data || {}).forEach((k) => {
                                    if (!k.includes(".") && b[k] !== undefined)
                                        clean[k] = b[k];
                                });
                                const converting =
                                    editing.id && type !== editing.type;
                                if (converting) {
                                    clean.source_type = editing.type;
                                    clean.source_id = editing.id;
                                } else if (editing.id) clean.id = editing.id;
                                if (["v2node", "v2box"].includes(type))
                                    clean.zero_rtt_handshake ??=
                                        editing.zero_rtt_handshake ?? 0;
                                const saved = await request(
                                    admin(`server/${type}/save`),
                                    clean,
                                );
                                setNodeDirty(false);
                                setSavedNodeNotice(
                                    "节点配置已保存。请检查节点最近通信和运行状态；协议、端口或内核变更可能需要同步部署配置。",
                                );
                                setEditing(null);
                                d.reload();
                                if (converting) {
                                    const updated = await request<Row[]>(
                                        admin("server/manage/getNodes"),
                                    );
                                    const converted = rows(updated.data).find(
                                        (r) =>
                                            r.type === type &&
                                            r.id === saved.data.id,
                                    );
                                    if (converted) setCommand(converted);
                                }
                            }}
                        />
                    </State>
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
    parent_id: "父节点 ID",
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
