import { NodeDomainBinding } from "./NodeDomains";
import { useEffect, useState } from "react";
import "./admin-management.css";
import { admin, date, query, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { NodeCredentials } from "./NodeCredentials";
import { nodeDeploymentCommand, nodeUpgradeCommand } from "./node-deployment";

export function NodeDeployment({
    node,
    close,
}: {
    node: Row;
    close: () => void;
}) {
    const [tab, setTab] = useState(node._new ? "domain" : "deploy"),
        [mode, setMode] = useState("new");
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [deployment, setDeployment] = useState<Row | null>(null),
        [copied, setCopied] = useState("");
    const report = useData<Row>(
        query(admin("server/credentials"), { type: node.type, id: node.id }),
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
    useEffect(() => {
        if (
            tab !== "deploy" ||
            authenticated ||
            busy ||
            report.loading ||
            report.error
        )
            return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") report.reload();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [tab, authenticated, busy, report.loading, report.error, report.reload]);
    return (
        <Modal
            title={`${node.name} · 部署与接入`}
            variant="drawer"
            className="node-deployment-drawer"
            wide
            close={() => {
                if (!busy) close();
            }}
        >
            <div className="admin-deployment">
                <p className="admin-deployment-meta">
                    {node.type.toUpperCase()} · 节点 #{node.id} ·{" "}
                    {node.protocol || ""}
                </p>
                <AdminTabs
                    label="部署与接入"
                    value={tab}
                    onChange={setTab}
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
                    ]}
                >
                    {tab === "domain" ? (
                        <NodeDomainBinding
                            node={node}
                            onChanged={() => setDeployment(null)}
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
                            <State {...report} retry={report.reload}>
                                {report.data && (
                                    <div className="admin-deployment-status">
                                        <span
                                            className="admin-deployment-state"
                                            data-ready={authenticated}
                                        >
                                            {authenticated
                                                ? "独立凭据已认证"
                                                : "独立凭据尚未认证"}
                                        </span>
                                        <button
                                            disabled={report.loading || busy}
                                            onClick={report.reload}
                                        >
                                            检查接入状态
                                        </button>
                                    </div>
                                )}
                            </State>
                            <p className="muted">
                                凭据认证不代表代理运行正常；部署后还需检查节点列表中的运行状态。
                            </p>
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
                                    <h3>新节点安装</h3>

                                    <p className="muted">
                                        复制后在节点以 root
                                        执行，自动安装依赖并配置密钥；已绑定域名时同时配置
                                        IP
                                        上报，等待解析生效并验证节点就绪后启用域名。自动申请证书需选择
                                        HTTP 或 DNS 申请；HTTP 验证需开放 80
                                        端口。失败后按终端提示恢复。已有配置不会被覆盖。
                                    </p>
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
                                    <p className="muted">
                                        生成不更换密钥。执行后原全局密钥失效，旧独立密钥保留30分钟宽限；正在轮换时需先完成配置。失败后可重新生成授权。
                                    </p>
                                </section>
                            ) : node.type === "v2box" ? (
                                <section className="admin-deployment-card">
                                    <h3>升级现有节点</h3>
                                    <p>
                                        保留现有配置和密钥，安装新版后重启节点。
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
                            {node.type === "v2box" && (
                                <section className="admin-deployment-card">
                                    <h3>自动 IP 上报</h3>
                                    <p className="muted">
                                        定时将节点公网 IP
                                        上报面板，用于更新域名解析。
                                        新安装时已绑定域名会自动配置；已有节点缺少上报或上报异常时，可单独配置或修复。
                                    </p>
                                    <button onClick={() => setTab("domain")}>
                                        管理域名与 IP 上报
                                    </button>
                                </section>
                            )}
                            <details className="admin-deployment-tools">
                                <summary>高级：手动安装</summary>
                                <div>
                                    <p className="muted">
                                        {node.type === "v2box"
                                            ? "手动安装需自行配置节点接入密钥和 IP 上报；通常使用“新安装”中的一键部署即可。"
                                            : "手动安装后配置节点独立凭据；IP 自动上报可在 Cloudflare DDNS 中绑定节点后配置。"}
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
                            </details>
                            {node.type === "v2box" && (
                                <div className="admin-deployment-help">
                                    <span>安装后检查</span>
                                    <code>v2box status</code>
                                    <code>v2box log</code>
                                </div>
                            )}
                        </>
                    )}
                </AdminTabs>
                {tab === "deploy" && copied && <p role="status">{copied}</p>}
                {tab === "deploy" && error && <p role="alert">{error}</p>}
            </div>
        </Modal>
    );
}
