import { useEffect, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, Panel, State, useData } from "../shared/ui";
import { lightsailFailure } from "./lightsail-status";
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
    close?: () => void;
}) {
    const data = useData<Row[]>(admin("server/lightsail/fetch"));
    const credentials = useData<Row[]>(admin("server/lightsail/credentials"));
    const [credentialEditing, setCredentialEditing] = useState<Row | null>(null);
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
        if (!active || data.loading || data.error || busy || editing || operation || credentialEditing) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") data.reload();
        }, 5000);
        return () => window.clearInterval(timer);
    }, [active, data.loading, data.error, data.reload, busy, editing, operation, credentialEditing]);
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
            credentials.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function manageCredential(path: string, body: Row) {
        if (busy) return;
        setBusy(true); setError("");
        try {
            const result = await request<Row>(admin(`server/lightsail/credentials/${path}`), body);
            if (path === "save" && !body.id && editing) setEditing({ ...editing, credential_id: result.data.id });
            setCredentialEditing(null);
            credentials.reload();
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    function editCredential(row?: Row) {
        setError("");
        setCredentialEditing({ ...row, name: row?.name || "", accessKey: "", secretKey: "", sessionToken: "", confirmSharedUpdate: false });
    }
    function remove(row: Row) {
        if (busy) return;
        const saved = (data.data || []).find(item => item.id === row.id) || row;
        const pending = saved.status === "failed";
        const resources = (saved.staticIpNames || []).join("、") || "请在 AWS 控制台核对";
        if (window.confirm(`移除 ${saved.name} 的管理配置？\n实例：${saved.instance}（${saved.region}）\n只删除面板配置，不删除 AWS 实例、不解绑或释放静态 IP。${pending ? `\n将放弃未完成操作，不能再从面板继续或恢复。新旧静态 IP 可能仍产生费用，请自行核对和清理：${resources}` : ""}`)) {
            send("drop", { id: saved.id, ...(pending ? { abandonOperation: true } : {}) });
        }
    }
    const content = (
        <>
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
                                credential_id: "",
                            })
                        }
                    >
                        添加服务器
                    </button>
                    {close && <button onClick={data.reload}>刷新状态</button>}
                </div>
                <details className="admin-deployment-card">
                    <summary>AWS 密钥管理</summary>
                    <p className="muted">同一份 AWS 密钥可绑定多台 Lightsail 服务器；服务器分别选择区域和实例。修改密钥后，全部绑定服务器共用新凭据。</p>
                    <button disabled={busy} onClick={() => editCredential()}>添加 AWS 密钥</button>
                    <State {...credentials} retry={credentials.reload}>
                        {(credentials.data || []).map(row => <div className="actions" key={row.id}>
                            <span>{row.name} · {row.server_count || 0} 台服务器</span>
                            <button disabled={busy} onClick={() => editCredential(row)} aria-label={`编辑密钥 ${row.name}`}>编辑密钥</button>
                            <button disabled={busy || row.server_count > 0} onClick={() => { if (window.confirm(`移除未绑定的 AWS 密钥“${row.name}”？仅删除面板凭据，不操作 AWS 资源。`)) manageCredential("drop", { id: row.id }); }} aria-label={`移除密钥 ${row.name}`}>移除密钥</button>
                        </div>)}
                        {!credentials.data?.length && <p className="muted">先添加 AWS 密钥，再为服务器选择该密钥。</p>}
                    </State>
                </details>
                <State {...data} retry={data.reload}>
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
                                    <div><dt>AWS 密钥</dt><dd>{credentials.data?.find(item => item.id === row.credential_id)?.name || `#${row.credential_id}`}</dd></div>
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
                                {row.error_code && (() => {
                                    const failure = lightsailFailure(row);
                                    return <div className="infrastructure-notice" data-tone="warning" role="status">
                                        <strong>{failure.title}</strong>
                                        <p>{failure.advice}</p>
                                        <small>{failure.operation && `${failure.operation} · `}阶段 {row.phase} · {row.error_code}</small>
                                        {row.phase === "allocate" && row.status === "failed" && row.operation !== "restore" && <p>申请阶段不会主动解绑旧 IP；如在 AWS 控制台手动操作过，请以实际绑定为准。</p>}
                                    </div>;
                                })()}
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
                                                abandonOperation: false,
                                            })
                                        }
                                    >
                                        编辑配置
                                    </button>
                                    <button
                                        className="danger"
                                        disabled={busy || ["queued", "running"].includes(row.status)}
                                        onClick={() => remove(row)}
                                    >
                                        移除配置
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
                            服务器，并关联代理服务即可开始管理。
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
                                    {editing.status === "failed" && (
                                        <div className="infrastructure-notice">
                                            <p>本次 IP 操作未完成。可修改名称或在 AWS 密钥管理中修复原凭据后继续；更换密钥、区域、实例或关联服务前，需要放弃本次操作。</p>
                                            <label>
                                                <input type="checkbox" checked={Boolean(editing.abandonOperation)} onChange={e => setEditing({ ...editing, abandonOperation: e.target.checked })} />
                                                放弃未完成操作并解锁关联配置
                                            </label>
                                            <p>勾选后保存会清除本次操作进度，无法再继续或恢复。AWS 实例和新旧静态 IP 保留，可能仍产生费用，请自行核对和清理。</p>
                                            {editing.staticIpNames?.length > 0 && <p>需核对的静态 IP 名称：{editing.staticIpNames.join("、")}</p>}
                                        </div>
                                    )}
                                    {[
                                        ["name", "显示名称"],
                                        ["region", "AWS 区域"],
                                        ["instance", "Lightsail 实例名称"],
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
                                                    editing.status === "failed" && !editing.abandonOperation &&
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
                                    <label>AWS 密钥<select required disabled={editing.status === "failed" && !editing.abandonOperation} value={editing.credential_id || ""} onChange={e => setEditing({ ...editing, credential_id: Number(e.target.value) || "" })}>
                                        <option value="">请选择 AWS 密钥</option>
                                        {(credentials.data || []).map(row => <option key={row.id} value={row.id}>{row.name} · {row.server_count || 0} 台服务器</option>)}
                                    </select></label>
                                    <div className="actions">
                                        <button type="button" onClick={() => editCredential()}>添加 AWS 密钥</button>
                                        {!!editing.credential_id && <button type="button" onClick={() => editCredential(credentials.data?.find(row => row.id === Number(editing.credential_id)))}>编辑所选密钥</button>}
                                    </div>
                                    <label>
                                        关联代理服务
                                        <select
                                            required
                                            disabled={
                                                editing.status === "failed" && !editing.abandonOperation
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
                                                .filter((n) => !n.service_id)
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
                                        密钥在 AWS 密钥管理中加密保存，多台服务器可选择同一密钥。仅授予
                                        Lightsail
                                        查询、申请、绑定、解绑和释放静态 IP
                                        权限。
                                    </p>
                                    <div className="admin-dialog-actions"><button type="submit" className="primary">
                                        {busy ? "保存中…" : "保存配置"}
                                    </button></div>
                                </fieldset>
                            </form>
                            {editing.id && (
                                <button
                                    className="danger"
                                    disabled={busy}
                                    onClick={() => remove(editing)}
                                >
                                    移除配置
                                </button>
                            )}
                        </div>
                    </Modal>
                )}
                {credentialEditing && <Modal title={credentialEditing.id ? "编辑 AWS 密钥" : "添加 AWS 密钥"} close={() => { if (!busy) setCredentialEditing(null); }} dismissible={!busy} className="lightsail-dialog">
                    <div className="lightsail-content">
                    {error && <p role="alert" className="alert">{error}</p>}
                    <form onSubmit={e => { e.preventDefault(); manageCredential("save", credentialEditing); }}>
                        <fieldset disabled={busy} className="infrastructure-form">
                            <label>密钥名称<input required maxLength={100} value={credentialEditing.name} onChange={e => setCredentialEditing({ ...credentialEditing, name: e.target.value })} /></label>
                            {[["accessKey", "AWS Access Key ID"], ["secretKey", "AWS Secret Access Key"], ["sessionToken", "Session Token（临时凭据时填写）"]].map(([key, label]) => <label key={key}>{label}<input type={key === "accessKey" ? "text" : "password"} autoComplete="off" disabled={credentialEditing.active_count > 0} required={!credentialEditing.id && key !== "sessionToken"} value={credentialEditing[key]} onChange={e => setCredentialEditing({ ...credentialEditing, [key]: e.target.value })} /></label>)}
                            <p className="muted">编辑时留空保留原凭据。更新密钥需同时填写 Access Key 和 Secret Key；临时凭据需同时填写 Session Token。凭据不会回显。</p>
                            {credentialEditing.active_count > 0 && <p role="status">绑定服务器正在执行 IP 操作，当前只能修改密钥名称。</p>}
                            {credentialEditing.server_count > 1 && <label><input type="checkbox" checked={credentialEditing.confirmSharedUpdate} onChange={e => setCredentialEditing({ ...credentialEditing, confirmSharedUpdate: e.target.checked })} />确认更新这份密钥绑定的全部 {credentialEditing.server_count} 台服务器的凭据</label>}
                            <div className="admin-dialog-actions"><button type="submit" className="primary">{busy ? "保存中…" : "保存 AWS 密钥"}</button></div>
                        </fieldset>
                    </form>
                    </div>
                </Modal>}
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
                            <div className="admin-dialog-actions"><button
                                className="primary"
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
                            </button></div>
                        </div>
                    </Modal>
                )}
            </div>
        </>
    );
    return close ? (
        <Modal
            title="Lightsail 公网 IP 管理"
            close={close}
            wide
            className="lightsail-dialog"
        >
            {content}
        </Modal>
    ) : (
        <Panel
            title="Lightsail 公网 IP 管理"
            actions={<button onClick={data.reload}>刷新状态</button>}
        >
            {content}
        </Panel>
    );
}
