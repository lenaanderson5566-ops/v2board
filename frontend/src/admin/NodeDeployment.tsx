import { NodeDeploymentProgress } from "./NodeDeploymentProgress";
import { ProtocolBadge } from "./ProtocolBadge";
import { nodeDeploymentStage } from "./node-guidance";
import { NodeDomainBinding } from "./NodeDomains";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "./admin-management.css";
import { admin, query, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { formatInstant } from "../shared/timezone";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { NodeCredentials } from "./NodeCredentials";
import { NodeDnsObservation } from "./NodeDnsObservation";
import { deploymentTaskState, nodeUpgradeCommand } from "./node-deployment";

export function NodeDeployment({
    node,
    close,
    onChanged,
    inspect,
    scope = "service",
    navigation,
    editorName,
    openConnection,
}: {
    editorName?: string;
    openConnection?: (defaultEndpoint?: boolean) => void;
    navigation?: (busy: boolean, dirty: boolean) => ReactNode;
    node: Row;
    close: () => void;
    onChanged?: () => void;
    inspect?: () => void;
    scope?: "service" | "connection";
}) {
    const [tab, setTab] = useState(
            scope === "connection" || node._focusDomain ? "domain" : "deploy",
        ),
        [mode, setMode] = useState(
            !node._new &&
                ["online", "offline", "limited"].includes(node.runtime_status)
                ? "upgrade"
                : "new",
        );
    const [credentialsOpen, setCredentialsOpen] = useState(false);
    const [domainDirty, setDomainDirty] = useState(false);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [deployment, setDeployment] = useState<Row | null>(null),
        [copied, setCopied] = useState("");
    const generating = useRef(false);
    const reportAtIssue = useRef<Row | null>(null);
    const report = useData<Row>(
        scope === "connection"
            ? ""
            : query(admin("server/credentials"), {
                  type: node.type,
                  id: node.id,
              }),
    );
    const runtime = useData<Row>(
        tab === "deploy"
            ? admin(
                  `server/manage/runtime?type=${encodeURIComponent(node.type)}&id=${node.id}`,
              )
            : "",
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const network = useData<Row>(
        tab === "deploy" ? query(admin("server/ddns/fetch"), node.type === "v2box" ? {node_type:node.type, node_id:node.id} : {}) : "",
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const deadline = useRef(Date.now() + 900000);
    const [paused, setPaused] = useState(false);
    const [tracking, setTracking] = useState(false);
    const binding = (network.data?.assignments || []).find(
        (a: Row) => a.node_type === node.type && a.node_id === node.id && a.status !== "manual",
    );
    const reportedTask = report.data?.deploymentTask;
    const task = deployment?.task && report.data === reportAtIssue.current
        ? deployment.task : reportedTask ?? deployment?.task;
    const taskState = deploymentTaskState(task);
    const commandUsed = !!deployment?.task && !!task &&
        (task.id !== deployment.task.id || task.phase !== "issued");
    useEffect(() => {
        if (!deployment) return;
        if (commandUsed) {
            setDeployment(null);
            setCopied("");
            return;
        }
        const timer = setTimeout(
            () => {
                setDeployment(null);
                setCopied("");
                report.reload();
            },
            Math.max(0, Date.parse(deployment.expiresAt) - Date.now()),
        );
        return () => clearTimeout(timer);
    }, [deployment, commandUsed, report.reload]);
    async function copy(value: string, label: string, track = false) {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            setError("");
            if (track) refreshStatus();
        } catch {
            setError("复制失败，请手动复制命令");
        }
    }
    async function generate() {
        if (generating.current) return;
        generating.current = true;
        setBusy(true);
        setError("");
        setCopied("");
        setDeployment(null);
        try {
            const result = await request(
                admin("server/credentials/deployment"),
                { type: node.type, id: node.id },
            );
            reportAtIssue.current = report.data;
            setDeployment(result.data);
            refreshStatus();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            generating.current = false;
            setBusy(false);
        }
    }
    const keys: Row[] = report.data?.keys || [];
    const authenticated = keys.some(
        (k) => k.status === "active" && !!k.lastUsedAt,
    );
    const stage = nodeDeploymentStage(
        node,
        runtime.data,
        binding,
        authenticated,
    );
    const service = nodeDeploymentStage(node, runtime.data, undefined, authenticated);
    const terminalTask = !!task && !taskState.polling;
    const statusError = report.error || runtime.error || network.error;
    function refreshStatus() {
        deadline.current = Date.now() + 900000;
        setPaused(false);
        setTracking(true);
        report.reload();
        runtime.reload();
        network.reload();
    }
    useEffect(() => {
        if (
            tab !== "deploy" ||
            busy ||
            paused ||
            (stage.terminal && !statusError && !taskState.polling && (!tracking || terminalTask)) ||
            report.loading ||
            runtime.loading ||
            network.loading
        )
            return;
        const timer = window.setInterval(() => {
            if (Date.now() >= deadline.current) {
                setPaused(true);
                return;
            }
            if (document.visibilityState !== "visible") return;
            if (!authenticated || report.error || taskState.polling) report.reload();
            runtime.reload();
            if (binding || network.error) network.reload();
        }, statusError ? 30000 : 15000);
        return () => window.clearInterval(timer);
    }, [
        tab,
        busy,
        paused,
        tracking,
        terminalTask,
        taskState.polling,
        stage.terminal,
        statusError,
        stage.dnsReady,
        authenticated,
        report.loading,
        runtime.loading,
        network.loading,
        report.error,
        runtime.error,
        network.error,
        report.reload,
        runtime.reload,
        network.reload,
        binding,
    ]);
    return (
        <Modal
            title={
                navigation
                    ? `编辑节点 · ${editorName || node.name}`
                    : `${node.name} · ${scope === "connection" ? "接入设置" : "部署与接入"}`
            }
            variant="drawer"
            className="node-editor-dialog node-deployment-drawer"
            wide
            close={() => {
                if (
                    !busy &&
                    (!domainDirty ||
                        confirm("域名配置尚未保存，确认放弃修改？"))
                )
                    close();
            }}
        >
            {navigation?.(busy, domainDirty)}
            <div className="admin-deployment">
                {!navigation && <p className="admin-deployment-meta">
                    {node.type.toUpperCase()} · 节点 #{node.id} ·{" "}
                    <ProtocolBadge protocol={node.protocol} />
                </p>}
                <DeploymentSections
                    integrated={!!navigation}
                    label={scope === "connection" ? "节点接入" : "部署与接入"}
                    value={tab}
                    onChange={(next) => {
                        if (
                            domainDirty &&
                            !confirm("域名配置尚未保存，确认放弃修改？")
                        )
                            return;
                        setDomainDirty(false);
                        setTab(next);
                    }}
                    options={[
                        { value: "deploy", label: "部署", disabled: busy },
                        {
                            value: "domain",
                            label: "域名与解析",
                            disabled: busy,
                        },
                        {
                            value: "credentials",
                            label: "凭据管理",
                            disabled: busy,
                        },
                    ].filter(
                        (option) =>
                            scope === "connection" ? option.value === "domain" : (!navigation || option.value !== "credentials") && (!openConnection || option.value !== "domain"),
                    )}
                >
                    {tab === "domain" ? (
                        <NodeDomainBinding
                            onBusyChange={setBusy}
                            onDirty={setDomainDirty}
                            node={node}
                            onChanged={() => setDeployment(null)}
                            onPublished={onChanged}
                            onUpgrade={
                                scope === "connection"
                                    ? undefined
                                    : () => {
                                          setTab("deploy");
                                          setMode("upgrade");
                                      }
                            }
                        />
                    ) : tab === "credentials" ? (
                        <NodeCredentials
                            node={node}
                            close={close}
                            embedded
                            onBusyChange={setBusy}
                            onChanged={report.reload}
                        />
                    ) : (
                        <>
                            <section
                                className="node-deployment-progress"
                                aria-label="部署状态"
                                data-ready={runtime.data?.runtimeStatus === "online" && service.target === "runtime" && !runtime.data?.maintenance && !runtime.error}
                            >
                                <div>
                                    <strong className="node-deployment-line"><span>当前服务</span><b>
                                        {runtime.error
                                            ? "状态读取暂不可用"
                                            : service.title}
                                    </b></strong>
                                    <button
                                        disabled={
                                            busy ||
                                            report.loading ||
                                            runtime.loading ||
                                            network.loading
                                        }
                                        onClick={refreshStatus}
                                    >
                                        刷新部署状态
                                    </button>
                                </div>
                                <p>
                                    {statusError
                                        ? paused ? "自动检查已暂停，请刷新状态重试。" : "状态查询失败，页面可见时每 30 秒自动重试，也可手动刷新。"
                                        : stage.description}
                                </p>
                                {node.type === "v2box" && (
                                    <section className="node-deployment-task" aria-label="本次部署" aria-live="polite">
                                        <strong className="node-deployment-line"><span>本次部署</span><b>{report.error ? "任务状态读取失败" : report.loading && !task && !report.data ? "正在读取" : taskState.label}</b></strong>
                                        {!report.error && taskState.hint && <p>{taskState.hint}</p>}
                                        {!report.error && task?.phase === "issued" && !deployment?.command && <small>若未保存原命令，可在下方重新生成。</small>}
                                        {!report.error && task?.recoveryExpiresAt && taskState.polling && <small>恢复有效至 {formatInstant(task.recoveryExpiresAt, { timeZoneName: undefined })}</small>}
                                        {!report.error && task?.resumeCommand && task.recoveryExpiresAt && taskState.polling && <details>
                                            <summary>恢复此节点的部署</summary>
                                            <p>在原服务器执行，仅恢复此面板和节点已保存的任务。</p>
                                            <textarea aria-label="本节点恢复命令" className="admin-command-input" rows={2} readOnly spellCheck={false} value={task.resumeCommand}/>
                                            <button onClick={() => copy(task.resumeCommand, "恢复命令已复制")}>复制此节点恢复命令</button>
                                        </details>}
                                    </section>
                                )}
                                {binding?.relay_cutover && <section className="node-deployment-task" aria-label="中转入口验证">
                                    <strong className="node-deployment-line"><span>订阅入口</span><b>新入口待验证</b></strong>
                                    <p>候选入口 {binding.relay_cutover.host}:{binding.relay_cutover.port}，当前订阅仍使用 {binding.relay_cutover.previousHost}:{binding.relay_cutover.previousPort}。</p>
                                    <button disabled={busy} onClick={() => openConnection ? openConnection(true) : setTab("domain")}>验证新入口</button>
                                </section>}
                                {node.type === "v2box" && scope === "service" && (
                                    <section className="node-runtime-versions" aria-label="节点运行版本">
                                        <dl>
                                            <div><dt>V2Box 版本</dt><dd>{runtime.data?.agentVersion || "未上报"}</dd></div>
                                            <div><dt>sing-box 内核</dt><dd>{runtime.data?.coreVersion || "未上报"}</dd></div>
                                            <div><dt>版本上报时间</dt><dd>{runtime.data?.capabilitiesReportedAt ? formatInstant(runtime.data.capabilitiesReportedAt, { timeZoneName: undefined }) : "—"}</dd></div>
                                        </dl>
                                    </section>
                                )}
                                <State {...report} retry={report.reload}>
                                    <small>
                                        {authenticated
                                            ? "独立凭据已认证"
                                            : "独立凭据尚未认证"}
                                    </small>
                                </State>
                                {stage.target === "runtime" && inspect && (
                                    <button disabled={busy} onClick={inspect}>
                                        查看运行诊断
                                    </button>
                                )}
                                {stage.target === "domain" && !binding?.relay_cutover && (
                                    <button
                                        disabled={busy}
                                        onClick={() => openConnection ? openConnection() : setTab("domain")}
                                    >
                                        修改连接与协议
                                    </button>
                                )}
                                {stage.target === "upgrade" && (
                                    <button
                                        disabled={busy}
                                        onClick={() => setMode("upgrade")}
                                    >
                                        查看节点升级命令
                                    </button>
                                )}
                                {stage.target === "logs" && (
                                    <details>
                                        <summary>查看日志与恢复命令</summary>
                                        <p>
                                            <code>
                                                v2box status
                                            </code>{" "}
                                            ·{" "}
                                            <code>
                                                v2box log
                                            </code>
                                        </p>
                                        {node.type === "v2box" && (
                                            <p>
                                                未完成的一键部署可执行{" "}
                                                <code>
                                                    sh install-v2box.sh --resume
                                                </code>
                                                ，证书与现有配置会保留。
                                            </p>
                                        )}
                                    </details>
                                )}
                                {paused && (
                                    <p className="muted">
                                        已暂停自动检查，点击“刷新部署状态”继续。
                                    </p>
                                )}
                            </section>
                            {node.type === "v2box" && (
                                <div className="admin-deployment-mode">
                                    <AdminChoiceGroup
                                        label="部署场景"
                                        value={mode}
                                        disabled={busy}
                                        options={[
                                            { value: "new", label: "安装 / 接入面板" },
                                            {
                                                value: "upgrade",
                                                label: "升级节点程序",
                                            },
                                        ]}
                                        onChange={(value) => {
                                            setMode(value);
                                            setCopied("");
                                            setError("");
                                        }}
                                    />
                                </div>
                            )}
                            {node.type === "v2box" && mode === "new" ? (
                                <section className="admin-deployment-card">
                                    <h3>安装与接入</h3>
                                    {binding?.entry_id && (
                                        <p role="status">
                                            执行位置：回源服务器（运行代理服务的机器）。请先完成中转服务器的
                                            IP
                                            上报，等待入口与回源解析就绪。在入口服务器加载转发配置后，使用客户端验证候选入口；更换已上线的入口时，在“域名与解析”确认后切换订阅。
                                        </p>
                                    )}

                                    <p className="muted">在代理服务器以 root 执行。已有兼容的 V2Box 会追加当前面板节点，保留其他面板配置。</p>
                                    {report.data?.prepareCommand && <details className="admin-deployment-tools">
                                        <summary>首次安装：先准备 V2Box 程序</summary>
                                        <p>在新服务器执行以下命令。准备完成后再生成部署命令，下载和安装耗时不会占用 10 分钟的领取期限。</p>
                                        <textarea className="admin-command-input" aria-label="准备程序命令" readOnly rows={2} spellCheck={false} value={report.data.prepareCommand}/>
                                        <button onClick={() => copy(report.data!.prepareCommand, "准备命令已复制")}>复制准备命令</button>
                                    </details>}
                                    <details className="admin-deployment-tools">
                                        <summary>安装条件与中断恢复</summary>
                                        <p>自动安装依赖并配置密钥；已绑定域名时同时配置 IP 上报，等待解析生效并验证节点就绪后启用域名。</p>
                                        <p>HTTP 证书验证需保持公网 80 端口可达。若已保存部署进度，可在原服务器运行 v2box resume。命令领取后，恢复期限单独计算。</p>
                                    </details>
                                    <button
                                        className={deployment ? "" : "primary"}
                                        disabled={
                                            busy ||
                                            report.loading ||
                                            keys.some(
                                                (k) => k.status === "retiring",
                                            )
                                        }
                                        onClick={generate}
                                    >
                                        {busy
                                            ? "正在生成…"
                                            : "生成一键部署命令"}
                                    </button>
                                    {deployment && !commandUsed && (
                                        <>
                                            <p
                                                role="status"
                                                className="admin-deployment-expiry"
                                            >
                                                首次领取有效至{" "}
                                                {formatInstant(deployment.expiresAt, { timeZoneName: undefined })}
                                                。新生成的命令会替代尚未领取的旧命令。
                                            </p>
                                            <textarea
                                                className="admin-command-input"
                                                aria-label="一键部署命令"
                                                readOnly
                                                rows={3}
                                                spellCheck={false}
                                                value={deployment.command}
                                            />
                                            <button
                                                className="primary"
                                                onClick={() =>
                                                    copy(
                                                        deployment.command,
                                                        "部署命令已复制",
                                                    )
                                                }
                                            >
                                                复制部署命令
                                            </button>
                                        </>
                                    )}
                                    {keys.some(k => k.status === "retiring") && <p role="status">节点凭据正在轮换。请在“高级：节点凭据”完成轮换后生成部署命令。</p>}
                                    <details className="admin-deployment-tools"><summary>重新部署的影响</summary><p>生成命令不会更换密钥。执行后更新当前节点凭据，旧独立密钥保留 30 分钟宽限，原全局密钥失效。证书及其他节点配置保留。</p></details>
                                </section>
                            ) : (
                                <section className="admin-deployment-card">
                                    <h3>升级节点程序</h3>
                                    <p>
                                        保留节点配置、证书、密钥和 IP 上报。升级会重启本机运行中的全部 V2Box 节点；已停止的服务保持停止。
                                    </p>
                                    <textarea
                                        className="admin-command-input"
                                        aria-label="节点升级命令"
                                        readOnly
                                        rows={3}
                                        value={nodeUpgradeCommand(node)}
                                    />
                                    <button
                                        className="primary"
                                        onClick={() =>
                                            copy(
                                                nodeUpgradeCommand(node),
                                                "升级命令已复制",
                                                true,
                                            )
                                        }
                                    >
                                        复制升级命令
                                    </button>
                                </section>
                            )}
                            {copied && <p role="status">{copied}</p>}
                            {error && <p role="alert">{error}</p>}
                            {!network.loading && !runtime.loading && !network.error && !runtime.error && <NodeDeploymentProgress binding={binding} network={network.data} runtime={runtime.data} />}
                            <NodeDnsObservation observation={binding?.deployment_dns} />
                            {node.type === "v2box" && (
                                <details className="admin-deployment-tools">
                                    <summary>运维命令与说明</summary>
                                    <div>
                                        <p className="muted">
                                            以下命令在节点服务器执行；同一服务器中的全部
                                            V2Box 节点会受到重启或卸载影响。
                                        </p>
                                        <dl>
                                            <dt>更新节点</dt>
                                            <dd>
                                                <code>/usr/local/bin/v2box update</code>
                                                ：更新至最新正式版，保留配置、证书和未完成部署。旧版本请使用上方“升级节点程序”命令。
                                            </dd>
                                            <dt>恢复部署</dt>
                                            <dd>
                                                <code>
                                                    /usr/local/bin/v2box resume
                                                </code>
                                                ：继续有效期内的未完成部署。卸载后请重新下载后台部署脚本并使用 --resume；授权过期时重新生成部署命令。
                                            </dd>
                                            <dt>运行状态与日志</dt>
                                            <dd>
                                                <code>v2box status</code> ·{" "}
                                                <code>v2box log</code> ·{" "}
                                                <code>v2box version</code>
                                            </dd>
                                            <dt>卸载整台服务器上的 V2Box</dt>
                                            <dd>
                                                <code>
                                                    /usr/local/bin/v2box uninstall
                                                    --stop-network
                                                </code>
                                                ：此操作影响本机所有节点服务。确认无其他服务使用后执行。确认后停止
                                                V2Box 和本机独立 IP
                                                上报，移除程序，保留配置、证书及
                                                DNS 记录。共享 IP 上报服务时去掉{" "}
                                                <code>--stop-network</code>。
                                            </dd>
                                        </dl>
                                        <p className="muted">
                                            update / uninstall
                                            命令需安装包含运维功能的新版节点。卸载后请在面板撤销节点凭据，并按实际使用情况解绑域名；不会自动删除
                                            Cloudflare 解析。
                                        </p>
                                        <p className="muted">
                                            新版节点证书申请联系邮箱：fastdog.ltd@gmail.com，与站点发信邮箱独立。
                                        </p>
                                    </div>
                                </details>
                            )}
                        </>
                    )}
                </DeploymentSections>
                {navigation && scope === "service" && tab === "deploy" && <details className="admin-deployment-tools" onToggle={event => setCredentialsOpen(event.currentTarget.open)}>
                    <summary>高级：节点凭据</summary>
                    {credentialsOpen && <NodeCredentials node={node} close={close} embedded onBusyChange={setBusy} onChanged={report.reload}/>}
                </details>}
                {scope === "connection" && !navigation && (
                    <p className="muted">
                        协议、TLS 参数、运行维护及凭据在{" "}
                        <a
                            href={`#/nodes?service=${encodeURIComponent(`${node.type}:${node.id}`)}`}
                        >
                            代理服务
                        </a>{" "}
                        中管理。名称、权限和倍率请在节点列表编辑默认线路。
                    </p>
                )}
            </div>
        </Modal>
    );
}

function DeploymentSections({ integrated, label, value, onChange, options, children }: {
    integrated: boolean; label: string; value: string; onChange: (value: string) => void;
    options: { value: string; label: string; disabled?: boolean }[]; children: ReactNode;
}) {
    if (!integrated) return <AdminTabs label={label} value={value} onChange={onChange} options={options}>{children}</AdminTabs>;
    const destination = value === "credentials" ? "deploy" : "credentials";
    const action = options.find(option => option.value === destination);
    return <div className="node-deployment-section">
        {action && <div className="node-section-tools"><button type="button" disabled={action.disabled} onClick={() => onChange(destination)}>{value === "credentials" ? "返回部署与状态" : "节点凭据管理"}</button></div>}
        {children}
    </div>;
}
