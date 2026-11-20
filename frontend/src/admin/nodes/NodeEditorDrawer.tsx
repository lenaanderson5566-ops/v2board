import { useEffect, useRef, useState, type ReactNode } from "react";
import { admin, query, request, rows, type Row } from "../../shared/api";
import { Editor, Modal, State, useData, type Field } from "../../shared/ui";
import { AdminChoiceGroup } from "../AdminChoices";
import { field } from "../admin-fields";
import { linkNode, nodeFields } from "../admin-linkage";
import { formPresentation } from "../admin-presentation";
import { NodeConnectionEditor } from "../NodeConnections";
import { NodeTopology } from "../NodeTopology";
import { useNodeCatalog } from "../node-dictionary";
import { nodeConfigurationProblems, nodeChangeImpact } from "../node-guidance";
import { serviceLineFields, nodeLineFields, linkNodeLocation } from "../node-line-fields";
import { nodeEditorPresentation, nodeSettingsFields, nodeSettingsInitial, nodeSettingsPayload } from "../node-settings";
import { nodeSetupFields, nodeSetupPayload, nodeServiceFields, certificateCredentialOptions } from "../node-setup";
import { NodeDomainBinding } from "./NodeDomainBinding";

type NodeList = ReturnType<typeof useData<Row[]>>;

interface NodeEditorDrawerProps {
    editing: Row;
    managedLine: Row | null;
    nodeList: NodeList;
    nodeRows: Row[];
    groups: NodeList;
    navigation: (busy: boolean, dirty: boolean) => ReactNode;
    reopenService: () => void;
    onEdit: (service: Row | null) => void;
    onSelectService: (line: Row, service: Row | null) => void;
    onCreated: (node: Row, domainConfigured: boolean) => void;
    onNotice: (message: string) => void;
}

export function NodeEditorDrawer({
    editing, managedLine, nodeList, nodeRows, groups, navigation, reopenService,
    onEdit, onSelectService, onCreated, onNotice,
}: NodeEditorDrawerProps) {
    const type = editing.type;
    const catalog = useNodeCatalog();
    const routes = useData<Row[]>(admin("server/route/fetch"));
    const schema = useData<Row>(query(admin("console/nodeSchema"), { type }));
    const topology = useData<Row>(admin("server/ddns/fetch"));
    const managedService = !!editing.id && topology.data?.assignments?.some(
        (a: Row) => a.node_type === type && Number(a.node_id) === Number(editing.id) && a.managed,
    );
    const [creationMode, setCreationMode] = useState<"new" | "reuse">("new");
    const [nodeDirty, setNodeDirty] = useState(false);
    const [nodeBusy, setNodeBusy] = useState(false);
    const [connectionDirty, setConnectionDirty] = useState(false);
    const [connectionBusy, setConnectionBusy] = useState(false);
    const [configurationVersion, setConfigurationVersion] = useState(0);
    const reloadConfigurationSource = useRef<Row[] | null | undefined>(undefined);
    const [preflightShown, setPreflightShown] = useState(false);
    useEffect(() => {
        setNodeDirty(false);
        setPreflightShown(false);
        setCreationMode("new");
    }, [editing]);
    useEffect(() => {
        if (!nodeDirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [nodeDirty]);
    function closeNode() {
        if (nodeBusy || connectionBusy) return;
        if ((nodeDirty || connectionDirty) && !window.confirm("节点配置尚未保存，确认放弃修改？"))
            return;
        onEdit(null);
    }

    const currentLine = managedLine && nodeRows.find(
        n => n.type === managedLine.type && Number(n.id) === Number(managedLine.id),
    );
    const serviceChanged = !!editing.id && !!currentLine &&
        Number(currentLine.service_id || currentLine.id) !== Number(editing.id);

    function reloadConfiguration() {
        reloadConfigurationSource.current = nodeList.data;
        nodeList.reload();
        topology.reload();
    }

    useEffect(() => {
        if (!editing.id || nodeDirty || nodeBusy || connectionBusy) return;
        const line = rows(nodeList.data).find(n => n.type === managedLine?.type && n.id === managedLine?.id);
        const owner = line ? Number(line.service_id || line.id) : editing.id;
        const current = rows(nodeList.data).find(n => n.type === type && Number(n.id) === owner);
        if (line && current && owner !== Number(editing.id)) {
            onSelectService(line, current);
            setConfigurationVersion(version => version + 1);
            reloadConfigurationSource.current = undefined;
            return;
        }
        if (reloadConfigurationSource.current === undefined || nodeList.data === reloadConfigurationSource.current) return;
        if (current) {
            onEdit(current);
            setConfigurationVersion(version => version + 1);
        }
        reloadConfigurationSource.current = undefined;
    }, [nodeList.data, nodeDirty, nodeBusy, connectionBusy, editing.id, managedLine?.id, managedLine?.type]);

    return (
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
                navigation(nodeBusy || connectionBusy, nodeDirty || connectionDirty)}
            {editing.id && <section className="node-config-section" aria-label="连接与域名">
                <fieldset disabled={nodeBusy}>
                    {managedLine?.service_id ? <NodeConnectionEditor key={`${managedLine.type}:${managedLine.id}`} embedded onPublished={reloadConfiguration} pauseRefresh={nodeDirty || nodeBusy} view="path" node={managedLine} nodes={nodeRows} groups={rows(groups.data)} close={()=>{}} onSaved={nodeList.reload} onDirty={setConnectionDirty} onBusyChange={setConnectionBusy}/> :
                        <NodeDomainBinding key={`${editing.type}:${editing.id}`} pauseRefresh={nodeDirty || nodeBusy} node={editing} onChanged={reloadConfiguration} onPublished={reloadConfiguration} onDirty={setConnectionDirty} onBusyChange={setConnectionBusy}/>}
                </fieldset>
            </section>}
            {serviceChanged && (
                <div className="pad alert" role="alert">
                    此节点的所属代理服务已变更，请重新载入后再保存协议配置。
                    <button
                        type="button"
                        disabled={nodeBusy || connectionBusy}
                        onClick={() => {
                            if ((nodeDirty || connectionDirty) && !confirm("重新载入将放弃当前草稿，确认继续？")) return;
                            setConnectionDirty(false);
                            reloadConfigurationSource.current = undefined;
                            reopenService();
                        }}
                    >
                        重新载入所属服务
                    </button>
                </div>
            )}
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
                    loading={nodeList.loading || groups.loading}
                    error={nodeList.error || groups.error}
                    retry={() => {
                        nodeList.reload();
                        groups.reload();
                    }}
                >
                    <NodeConnectionEditor
                        embedded
                        node={{ type }}
                        nodes={nodeRows}
                        groups={rows(groups.data)}
                        close={closeNode}
                        onSaved={nodeList.reload}
                        onDirty={setNodeDirty}
                        onBusyChange={setNodeBusy}
                        onCreated={(line) => {
                            const service = nodeRows.find(n => !n.service_id && n.type === line.type && String(n.id) === String(line.service_id));
                            setNodeDirty(false);
                            onSelectService(line, service || null);
                        }}
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
                                const linked = key === "region_code" ? linkNodeLocation(values, key, next, catalog) : linkNode(key, next, values);
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
                                            return nodeLineFields(rows(groups.data), catalog).find(field => field.key === k)!;
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
                                    editing.id
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
                                if(editing.id)reloadConfigurationSource.current=nodeList.data;
                                setNodeDirty(false);
                                onNotice(
                                    clean.deployment_setup
                                        ? "节点、服务器与域名已一并保存。请生成一键部署命令，在服务器执行。"
                                        : "节点配置已保存。请检查节点最近通信和运行状态；协议、端口或内核变更可能需要同步部署配置。",
                                );
                                onEdit(!editing.id ? null : {...editing,...b});
                                nodeList.reload();
                                if(editing.id && managedService && Number(b.server_port)!==Number(editing.server_port)){
                                    onNotice("监听端口已保存。等待节点应用后将自动验证并同步连接端口；中转线路请确认转发配置。");
                                    onEdit({...editing,...b,type:editing.type,id:editing.id});
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
                                        onCreated(converted, !!clean.deployment_setup);
                                    }
                                }
                            }}
                        />
                    </State>
                </>
            )}
            </fieldset>
        </Modal>
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
