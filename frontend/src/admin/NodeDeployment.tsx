import { NodeDeploymentProgress } from "./NodeDeploymentProgress";
import { nodeDeploymentStage } from "./node-guidance";
import { NodeDomainBinding } from "./NodeDomains";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "./admin-management.css";
import { admin, date, query, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { NodeCredentials } from "./NodeCredentials";
import { NodeDnsObservation } from "./NodeDnsObservation";
import { nodeDeploymentCommand, nodeUpgradeCommand } from "./node-deployment";

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
    openConnection?: () => void;
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
        tab === "deploy" ? admin("server/ddns/fetch") : "",
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const deadline = useRef(Date.now() + 900000);
    const [paused, setPaused] = useState(false);
    const binding = (network.data?.assignments || []).find(
        (a: Row) => a.node_type === node.type && a.node_id === node.id && a.status !== "manual",
    );
    useEffect(() => {
        if (!deployment) return;
        const timer = setTimeout(
            () => {
                setDeployment(null);
                setCopied("");
                setError("部署命令已过期，请重新生成");
            },
            Math.max(0, Date.parse(deployment.expiresAt) - Date.now()),
        );
        return () => clearTimeout(timer);
    }, [deployment]);
    async function copy(value: string, label: string) {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            setError("");
        } catch {
            setError("复制失败，请手动复制命令");
        }
    }
    async function generate() {
        setBusy(true);
        setError("");
        setCopied("");
        setDeployment(null);
        try {
            const result = await request(
                admin("server/credentials/deployment"),
                { type: node.type, id: node.id },
            );
            setDeployment(result.data);
        } catch (e) {
            setError((e as Error).message);
        } finally {
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
    function refreshStatus() {
        deadline.current = Date.now() + 900000;
        setPaused(false);
        report.reload();
        runtime.reload();
        network.reload();
    }
    useEffect(() => {
        if (
            tab !== "deploy" ||
            busy ||
            paused ||
            stage.terminal ||
            report.loading ||
            runtime.loading ||
            network.loading ||
            report.error ||
            runtime.error ||
            network.error
        )
            return;
        const timer = window.setInterval(() => {
            if (Date.now() >= deadline.current) {
                setPaused(true);
                return;
            }
            if (document.visibilityState !== "visible") return;
            if (!authenticated) report.reload();
            runtime.reload();
            if (binding) network.reload();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [
        tab,
        busy,
        paused,
        stage.terminal,
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
                    {node.protocol || ""}
                </p>}
                {node.type === "v2box" && scope === "service" && tab === "deploy" && (
                    <section className="node-address-summary" aria-label="节点运行版本"><dl>
                        <div><dt>V2Box 版本</dt><dd>{runtime.data?.agentVersion || "未上报"}</dd></div>
                        <div><dt>sing-box 内核</dt><dd>{runtime.data?.coreVersion || "未上报"}</dd></div>
                        <div><dt>版本上报时间</dt><dd>{runtime.data?.capabilitiesReportedAt ? date(runtime.data.capabilitiesReportedAt) : "—"}</dd></div>
                    </dl></section>
                )}
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
                            {node.type === "v2box" && (
                                <div className="admin-deployment-mode">
                                    <AdminChoiceGroup
                                        label="部署场景"
                                        value={mode}
                                        disabled={busy}
                                        options={[
                                            { value: "new", label: "新安装" },
                                            {
                                                value: "upgrade",
                                                label: "已有节点升级",
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
                                    <h3>安装与重新部署</h3>
                                    {binding?.entry_id && (
                                        <p role="status">
                                            执行位置：回源服务器（运行代理服务的机器）。请先完成中转服务器的
                                            IP
                                            上报，等待入口与回源解析就绪。部署完成后仍需在入口服务器加载转发配置，并通过客户端验证。
                                        </p>
                                    )}

                                    <p className="muted">在代理服务器以 root 执行下方命令，自动安装并启动服务。</p>
                                    <details className="admin-deployment-tools">
                                        <summary>安装条件与中断恢复</summary>
                                        <p>自动安装依赖并配置密钥；已绑定域名时同时配置 IP 上报，等待解析生效并验证节点就绪后启用域名。</p>
                                        <p>自动申请证书请选择 HTTP 或 DNS 申请。HTTP 验证需保持公网 80 端口可达。保留证书及其他节点配置；重新部署会更新当前节点凭据。中断后使用 --resume，授权过期时重新生成部署命令。</p>
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
                                    {deployment && (
                                        <>
                                            <p
                                                role="status"
                                                className="admin-deployment-expiry"
                                            >
                                                有效至{" "}
                                                {date(deployment.expiresAt)}
                                                ，仅可使用一次。新命令会使旧命令失效。
                                            </p>
                                            <textarea
                                                className="admin-command-input"
                                                aria-label="一键部署命令"
                                                readOnly
                                                rows={4}
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
                            ) : node.type === "v2box" ? (
                                <section className="admin-deployment-card">
                                    <h3>升级现有节点</h3>
                                    <p>
                                        保留配置、证书和密钥。运行中的服务升级后重启；已停止的服务保持停止。
                                    </p>
                                    <textarea
                                        className="admin-command-input"
                                        aria-label="节点升级命令"
                                        readOnly
                                        rows={3}
                                        value={nodeUpgradeCommand(node)}
                                    />
                                    <button
                                        onClick={() =>
                                            copy(
                                                nodeUpgradeCommand(node),
                                                "升级命令已复制",
                                            )
                                        }
                                    >
                                        复制升级命令
                                    </button>
                                </section>
                            ) : (
                                <p>
                                    V2Node 沿用手动部署，请先确认版本支持 Bearer
                                    独立凭据。
                                </p>
                            )}
                            {copied && <p role="status">{copied}</p>}
                            {error && <p role="alert">{error}</p>}
                            <section
                                className="node-deployment-progress"
                                aria-label="部署状态"
                            >
                                <div>
                                    <strong>
                                        {runtime.error || network.error
                                            ? "状态读取暂不可用"
                                            : stage.title}
                                    </strong>
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
                                    {runtime.error || network.error
                                        ? "请刷新状态重试，部署命令仍可按原流程生成。"
                                        : stage.description}
                                </p>
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
                                {stage.target === "domain" && (
                                    <button
                                        disabled={busy}
                                        onClick={() => openConnection ? openConnection() : setTab("domain")}
                                    >
                                        修改连接与域名
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
                                                {node.type === "v2box"
                                                    ? "v2box status"
                                                    : "systemctl status v2node"}
                                            </code>{" "}
                                            ·{" "}
                                            <code>
                                                {node.type === "v2box"
                                                    ? "v2box log"
                                                    : "journalctl -u v2node -n 80 --no-pager"}
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
                            {!network.loading && !runtime.loading && !network.error && !runtime.error && <NodeDeploymentProgress binding={binding} network={network.data} runtime={runtime.data} />}
                            <NodeDnsObservation observation={binding?.deployment_dns} />
                            {node.type !== "v2box" && <details className="admin-deployment-tools">
                                <summary>高级：手动安装</summary>
                                <div>
                                    <p className="muted">
                                        {node.type === "v2box"
                                            ? "手动安装需自行配置节点接入密钥和 IP 上报；通常使用“新安装”中的一键部署即可。"
                                            : "手动安装后配置节点独立凭据；IP 自动上报可在 域名与解析 中绑定节点后配置。"}
                                    </p>
                                    {node.install_command && (
                                        <>
                                            <textarea
                                                className="admin-command-input"
                                                aria-label="节点安装命令"
                                                readOnly
                                                rows={3}
                                                value={nodeDeploymentCommand(
                                                    node,
                                                )}
                                            />
                                            <button
                                                onClick={() =>
                                                    copy(
                                                        nodeDeploymentCommand(
                                                            node,
                                                        ),
                                                        "手动安装命令已复制",
                                                    )
                                                }
                                            >
                                                复制手动安装命令
                                            </button>
                                        </>
                                    )}
                                </div>
                            </details>}
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
                                                ：更新至最新正式版，保留配置、证书和未完成部署。旧版本请使用上方“已有节点升级”命令。
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
