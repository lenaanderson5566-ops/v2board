import { useEffect, useState } from "react";
import { admin, date, query, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { AdminTabs } from "./AdminChoices";
import { NodeCredentials } from "./NodeCredentials";
import {
    nodeDeploymentCommand,
    nodeIPCommand,
    nodeUpgradeCommand,
} from "./node-deployment";

export function NodeDeployment({
    node,
    close,
}: {
    node: Row;
    close: () => void;
}) {
    const [tab, setTab] = useState("deploy"),
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
    return (
        <Modal
            title={`${node.name} · 部署与接入`}
            variant="drawer"
            wide
            close={() => {
                if (!busy) close();
            }}
        >
            <p className="muted">
                {node.type.toUpperCase()} · 节点 #{node.id} ·{" "}
                {node.protocol || ""}
            </p>
            <AdminTabs
                label="部署与接入"
                value={tab}
                onChange={setTab}
                options={[
                    { value: "deploy", label: "部署", disabled: busy },
                    { value: "credentials", label: "凭据管理", disabled: busy },
                ]}
            >
                {tab === "credentials" ? (
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
                                <div className="actions">
                                    <span>
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
                            <label className="field">
                                <span>部署场景</span>
                                <select
                                    aria-label="部署场景"
                                    value={mode}
                                    disabled={busy}
                                    onChange={(e) => {
                                        setMode(e.target.value);
                                        setCopied("");
                                        setError("");
                                    }}
                                >
                                    <option value="new">新安装</option>
                                    <option value="upgrade">
                                        已有节点升级
                                    </option>
                                </select>
                            </label>
                        )}
                        {node.type === "v2box" && mode === "new" ? (
                            <section className="pad">
                                <p>
                                    以 root 执行部署命令，自动安装依赖、V2Box
                                    并配置独立凭据。已有节点配置不会被覆盖。
                                </p>
                                <button
                                    className="primary"
                                    disabled={
                                        busy ||
                                        report.loading ||
                                        keys.some(
                                            (k) => k.status === "retiring",
                                        )
                                    }
                                    onClick={generate}
                                >
                                    {busy ? "正在生成…" : "生成一键部署命令"}
                                </button>
                                {deployment && (
                                    <>
                                        <p role="status">
                                            有效至 {date(deployment.expiresAt)}
                                            ，仅可使用一次。新命令会使旧命令失效。
                                        </p>
                                        <textarea
                                            aria-label="一键部署命令"
                                            readOnly
                                            rows={7}
                                            value={deployment.command}
                                        />
                                        <button
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
                            <section className="pad">
                                <p>保留现有配置和密钥，安装新版后重启节点。</p>
                                <textarea
                                    aria-label="节点升级命令"
                                    readOnly
                                    rows={3}
                                    value={nodeUpgradeCommand}
                                />
                                <button
                                    onClick={() =>
                                        copy(
                                            nodeUpgradeCommand,
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
                        <details>
                            <summary>手动安装与网络辅助</summary>
                            <p className="muted">
                                V2Box
                                手动安装时按提示输入独立密钥；更换已有密钥请执行
                                v2box credential，再执行 v2box restart。
                            </p>
                            {node.install_command && (
                                <>
                                    <textarea
                                        aria-label="节点安装命令"
                                        readOnly
                                        rows={3}
                                        value={nodeDeploymentCommand(node)}
                                    />
                                    <button
                                        onClick={() =>
                                            copy(
                                                nodeDeploymentCommand(node),
                                                "手动安装命令已复制",
                                            )
                                        }
                                    >
                                        复制手动安装命令
                                    </button>
                                </>
                            )}
                            <p>
                                可选：在节点管理的“Cloudflare
                                DDNS”保存凭据并绑定此节点，然后配置节点 IP
                                上报。
                            </p>
                            <textarea
                                aria-label="查询服务器 IP 命令"
                                readOnly
                                rows={3}
                                value={nodeIPCommand}
                            />
                            <button
                                onClick={() =>
                                    copy(nodeIPCommand, "IP 查询命令已复制")
                                }
                            >
                                复制 IP 查询命令
                            </button>
                        </details>
                    </>
                )}
            </AdminTabs>
            {tab === "deploy" && copied && <p role="status">{copied}</p>}
            {tab === "deploy" && error && <p role="alert">{error}</p>}
        </Modal>
    );
}
