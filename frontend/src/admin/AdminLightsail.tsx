import { useEffect, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
const labels: Record<string, string> = {
    ready: "待操作",
    queued: "等待队列",
    running: "正在更换",
    failed: "需要处理",
    completed: "更换完成",
    restored: "已恢复旧 IP",
};
export function AdminLightsail({
    nodes,
    close,
}: {
    nodes: Row[];
    close: () => void;
}) {
    const data = useData<Row[]>(admin("server/lightsail/fetch"));
    const [editing, setEditing] = useState<Row | null>(null),
        [operation, setOperation] = useState<Row | null>(null),
        [confirmation, setConfirmation] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [observed, setObserved] = useState<Record<number, string>>({});
    async function inspect(row: Row) {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const result = await request<Row>(
                admin(`server/lightsail/inspect?id=${row.id}`),
            );
            setObserved({
                ...observed,
                [row.id]: result.data.publicIp || "未分配公网 IP",
            });
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const active = (data.data || []).some((r) =>
        ["queued", "running"].includes(r.status),
    );
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => data.reload(), 5000);
        return () => window.clearInterval(timer);
    }, [active, data.reload]);
    async function send(path: string, body: Row) {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            await request(admin("server/lightsail/" + path), body);
            setEditing(null);
            setOperation(null);
            setObserved({});
            data.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Modal
            title="Lightsail 公网 IP 管理"
            close={close}
            wide
            className="lightsail-dialog"
        >
            <div className="lightsail-content">
                <div className="infrastructure-notice">
                    <strong>有计划地更换公网地址</strong>
                    <p>
                        先申请新静态 IP，再切换并确认绑定，更新 Cloudflare
                        DDNS，最后释放旧
                        IP。切换期间连接会中断；失败后可继续当前操作或尝试恢复旧
                        IP。
                    </p>
                    <p>
                        未配置 DDNS 的域名需要自行更新解析。节点使用 IP
                        地址时也需更新连接地址。
                    </p>
                </div>
                {error && (
                    <p role="alert" className="alert">
                        {error}
                    </p>
                )}
                <div className="actions">
                    <button
                        disabled={busy}
                        onClick={() =>
                            setEditing({
                                name: "",
                                region: "ap-southeast-1",
                                instance: "",
                                node_type: "v2box",
                                node_id: "",
                            })
                        }
                    >
                        添加服务器
                    </button>
                    <button onClick={data.reload}>刷新状态</button>
                </div>
                <State {...data}>
                    <div className="infrastructure-grid">
                        {(data.data || []).map((row) => (
                            <article
                                className="infrastructure-card"
                                key={row.id}
                            >
                                <header>
                                    <strong>{row.name}</strong>
                                    <span
                                        className={
                                            row.status === "failed"
                                                ? "status-warning"
                                                : "status-label"
                                        }
                                    >
                                        {labels[row.status] || row.status}
                                    </span>
                                </header>
                                <dl>
                                    <div>
                                        <dt>实例</dt>
                                        <dd>{row.instance}</dd>
                                    </div>
                                    <div>
                                        <dt>区域</dt>
                                        <dd>{row.region}</dd>
                                    </div>
                                    <div>
                                        <dt>当前 IP</dt>
                                        <dd>
                                            {observed[row.id] ||
                                                row.current_ip ||
                                                "尚未查询"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>节点</dt>
                                        <dd>
                                            {nodes.find(
                                                (n) =>
                                                    n.type === row.node_type &&
                                                    n.id === row.node_id,
                                            )?.name ||
                                                `${row.node_type} #${row.node_id}`}
                                        </dd>
                                    </div>
                                </dl>
                                {row.error_code && (
                                    <p className="muted">
                                        操作未完成：{row.error_code} · 阶段{" "}
                                        {row.phase}。检查 AWS 权限、队列及 DDNS
                                        状态后继续。
                                    </p>
                                )}
                                <div className="actions">
                                    <button
                                        disabled={busy}
                                        onClick={() => inspect(row)}
                                    >
                                        查询 IP
                                    </button>
                                    <button
                                        disabled={
                                            busy ||
                                            ["queued", "running"].includes(
                                                row.status,
                                            )
                                        }
                                        onClick={() =>
                                            setEditing({
                                                ...row,
                                                accessKey: "",
                                                secretKey: "",
                                                sessionToken: "",
                                            })
                                        }
                                    >
                                        编辑配置
                                    </button>
                                    {[
                                        "ready",
                                        "completed",
                                        "restored",
                                    ].includes(row.status) && (
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                setConfirmation("");
                                                setOperation({
                                                    ...row,
                                                    action: "rotate",
                                                });
                                            }}
                                        >
                                            更换 IP
                                        </button>
                                    )}
                                    {row.recoverable && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setConfirmation("");
                                                    setOperation({
                                                        ...row,
                                                        action: "resume",
                                                    });
                                                }}
                                            >
                                                继续操作
                                            </button>
                                            {row.canRestore && (
                                                <button
                                                    onClick={() => {
                                                        setConfirmation("");
                                                        setOperation({
                                                            ...row,
                                                            action: "restore",
                                                        });
                                                    }}
                                                >
                                                    恢复旧 IP
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                    {data.data?.length === 0 && (
                        <p className="empty">
                            添加 AWS Lightsail
                            服务器，并关联主节点即可开始管理。
                        </p>
                    )}
                </State>
                {editing && (
                    <Modal
                        title={
                            editing.id
                                ? "编辑 Lightsail 配置"
                                : "添加 Lightsail 服务器"
                        }
                        close={() => setEditing(null)}
                        className="lightsail-dialog"
                    >
                        <div className="lightsail-content">
                            {error && (
                                <p className="alert" role="alert">
                                    {error}
                                </p>
                            )}
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    send("save", editing);
                                }}
                            >
                                <fieldset
                                    disabled={busy}
                                    className="infrastructure-form"
                                >
                                    {[
                                        ["name", "显示名称"],
                                        ["region", "AWS 区域"],
                                        ["instance", "Lightsail 实例名称"],
                                        ["accessKey", "AWS Access Key ID"],
                                        ["secretKey", "AWS Secret Access Key"],
                                        [
                                            "sessionToken",
                                            "Session Token（临时凭据时填写）",
                                        ],
                                    ].map(([key, label]) => (
                                        <label key={key}>
                                            {label}
                                            <input
                                                type={
                                                    [
                                                        "secretKey",
                                                        "sessionToken",
                                                    ].includes(key)
                                                        ? "password"
                                                        : "text"
                                                }
                                                autoComplete="off"
                                                disabled={
                                                    editing.status ===
                                                        "failed" &&
                                                    [
                                                        "region",
                                                        "instance",
                                                    ].includes(key)
                                                }
                                                required={
                                                    [
                                                        "name",
                                                        "region",
                                                        "instance",
                                                    ].includes(key) ||
                                                    (!editing.id &&
                                                        [
                                                            "accessKey",
                                                            "secretKey",
                                                        ].includes(key))
                                                }
                                                value={editing[key] || ""}
                                                onChange={(e) =>
                                                    setEditing({
                                                        ...editing,
                                                        [key]: e.target.value,
                                                    })
                                                }
                                            />
                                        </label>
                                    ))}
                                    <label>
                                        关联主节点
                                        <select
                                            required
                                            disabled={
                                                editing.status === "failed"
                                            }
                                            value={
                                                editing.node_id
                                                    ? `${editing.node_type}:${editing.node_id}`
                                                    : ""
                                            }
                                            onChange={(e) => {
                                                const [type, id] =
                                                    e.target.value.split(":");
                                                setEditing({
                                                    ...editing,
                                                    node_type: type,
                                                    node_id: Number(id),
                                                });
                                            }}
                                        >
                                            <option value="">请选择</option>
                                            {nodes
                                                .filter((n) => !n.parent_id)
                                                .map((n) => (
                                                    <option
                                                        key={`${n.type}:${n.id}`}
                                                        value={`${n.type}:${n.id}`}
                                                    >
                                                        {n.name} · {n.type}
                                                    </option>
                                                ))}
                                        </select>
                                    </label>
                                    <p className="muted">
                                        凭据加密保存，编辑时留空保留原凭据。仅授予
                                        Lightsail
                                        查询、申请、绑定、解绑和释放静态 IP
                                        权限。
                                    </p>
                                    <button type="submit">
                                        {busy ? "保存中…" : "保存配置"}
                                    </button>
                                </fieldset>
                            </form>
                            {editing.id && (
                                <button
                                    className="danger"
                                    disabled={
                                        busy || editing.status === "failed"
                                    }
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                "移除管理配置？这只删除面板保存的配置，不操作 AWS 静态 IP。",
                                            )
                                        )
                                            send("drop", { id: editing.id });
                                    }}
                                >
                                    移除配置
                                </button>
                            )}
                        </div>
                    </Modal>
                )}
                {operation && (
                    <Modal
                        title={
                            operation.action === "rotate"
                                ? "确认更换公网 IP"
                                : operation.action === "restore"
                                  ? "确认恢复旧 IP"
                                  : "继续未完成操作"
                        }
                        close={() => setOperation(null)}
                        className="lightsail-dialog"
                    >
                        <div className="lightsail-content">
                            {error && (
                                <p className="alert" role="alert">
                                    {error}
                                </p>
                            )}
                            <p>
                                操作实例：<strong>{operation.instance}</strong>
                                （{operation.region}）。更换成功后旧 IP
                                将被释放，无法保证重新申请到同一地址。
                            </p>
                            <label>
                                输入实例名称确认
                                <input
                                    value={confirmation}
                                    onChange={(e) =>
                                        setConfirmation(e.target.value)
                                    }
                                    autoComplete="off"
                                />
                            </label>
                            <button
                                disabled={
                                    busy || confirmation !== operation.instance
                                }
                                onClick={() =>
                                    send("operate", {
                                        id: operation.id,
                                        action: operation.action,
                                        confirmInstance: confirmation,
                                    })
                                }
                            >
                                {busy ? "提交中…" : "确认操作"}
                            </button>
                        </div>
                    </Modal>
                )}
            </div>
        </Modal>
    );
}
