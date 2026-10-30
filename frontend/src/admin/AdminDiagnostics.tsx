import { useEffect, useRef, useState } from "react";
import {
    AdminLogTimeZone,
    adminInstant as formatInstant,
} from "./admin-log-time";
import { admin, bytes, date, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { dateTimeInput, parseDateTimeInput } from "../shared/timezone";
import { AdminSwitch } from "./admin-switch";
import { ProtocolBadge } from "./ProtocolBadge";

export const nodeRuntimeLabels: Record<string, string> = {
    online: "在线",
    offline: "离线",
    limited: "额度受限",
    unknown: "暂无通信记录",
};
export const nodeIssueLabels: Record<string, string> = {
    offline: "持续离线",
    configuration_failed: "配置应用失败",
    configuration_unconfirmed: "配置长时间未确认",
    quota: "流量额度不足",
};
const configLabels: Record<string, string> = {
    unknown: "暂无配置拉取记录",
    pending: "配置已变更，等待节点拉取",
    provided: "已提供最新配置，待应用确认",
    invalid: "配置生成异常，请检查节点与路由设置",
};
const failureLabels: Record<string, string> = {
    decode: "配置解析失败",
    core: "内核配置校验失败",
    users: "用户配置准备失败",
    certificate: "证书准备失败",
    start: "节点启动失败",
};
export function NodeDiagnostics({
    node,
    close,
    deploy,
    onSaved,
}: {
    node: Row;
    close: () => void;
    deploy?: () => void;
    onSaved?: () => void;
}) {
    const data = useData<Row>(
        admin(
            `server/manage/runtime?type=${encodeURIComponent(node.type)}&id=${node.id}`,
        ),
    );
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    function dismiss() {
        if (
            !busy &&
            (!dirty || window.confirm("维护设置尚未保存，确认放弃修改？"))
        )
            close();
    }
    const runtime = data.data?.runtimeStatus || node.runtime_status;
    return (
        <Modal
            title={`节点详情 · ${node.name}`}
            variant="drawer"
            className="node-deployment-drawer"
            close={dismiss}
            dismissible={!busy}
        >
            <div className="admin-deployment node-detail">
                <AdminLogTimeZone />
                <section className="admin-deployment-card">
                    <h3>运行概况</h3>
                    <dl className="node-detail-grid">
                        <div>
                            <dt>节点</dt>
                            <dd>
                                {node.type} #{node.id} · <ProtocolBadge protocol={node.protocol} />
                            </dd>
                        </div>
                        <div>
                            <dt>运行状态</dt>
                            <dd>
                                {nodeRuntimeLabels[runtime] ||
                                    nodeRuntimeLabels.unknown}
                            </dd>
                        </div>
                        <div>
                            <dt>最近通信</dt>
                            <dd>
                                {date(
                                    Math.max(
                                        Number(
                                            data.data?.lastCheckAt ??
                                                node.last_check_at ??
                                                0,
                                        ),
                                        Number(
                                            data.data?.lastPushAt ??
                                                node.last_push_at ??
                                                0,
                                        ),
                                    ),
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>最近流量上报</dt>
                            <dd>
                                {date(
                                    data.data?.lastPushAt ?? node.last_push_at,
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>服务器流量</dt>
                            <dd>
                                {node.traffic_budget
                                    ? `${bytes(node.traffic_budget.usedBytes)} / ${node.traffic_budget.limitBytes ? bytes(node.traffic_budget.limitBytes) : "不限"}`
                                    : "未设置"}
                            </dd>
                        </div>
                        <div>
                            <dt>接入地址</dt>
                            <dd>
                                {node.host || "—"}
                                {node.port ? `:${node.port}` : ""}
                            </dd>
                        </div>
                    </dl>
                    {deploy && (
                        <button disabled={busy || dirty} onClick={deploy}>
                            {node.service_id ? "代理服务部署与接入" : "部署与接入"}
                        </button>
                    )}
                </section>
                <State {...data} retry={data.reload}>
                    {data.data && (
                        <>
                            <section className="admin-deployment-card">
                                <h3>配置与版本</h3>
                                <p role="status">
                                    {data.data.applicationState === "applied"
                                        ? "当前配置已生效"
                                        : data.data.applicationState ===
                                            "failed"
                                          ? failureLabels[
                                                data.data.errorCode
                                            ] || "配置应用失败"
                                          : configLabels[
                                                data.data.configurationState
                                            ] || configLabels.unknown}
                                </p>
                                <dl className="node-detail-grid">
                                    <div>
                                        <dt>最近提供配置</dt>
                                        <dd>{date(data.data.providedAt)}</dd>
                                    </div>
                                    <div>
                                        <dt>最近成功应用</dt>
                                        <dd>{date(data.data.lastAppliedAt)}</dd>
                                    </div>
                                    <div>
                                        <dt>最近状态回执</dt>
                                        <dd>{date(data.data.receiptAt)}</dd>
                                    </div>
                                    <div>
                                        <dt>核心版本</dt>
                                        <dd>
                                            {data.data.coreVersion ||
                                                "尚未上报"}
                                        </dd>
                                    </div>
                                </dl>
                                {data.data.capabilitiesReportedAt && (
                                    <p className="muted">
                                        版本上报时间：
                                        {formatInstant(
                                            data.data.capabilitiesReportedAt,
                                        )}
                                    </p>
                                )}
                                {data.data.inheritedFrom && (
                                    <p>
                                        关联线路沿用代理服务 #
                                        {data.data.inheritedFrom}{" "}
                                        的运行配置与通信状态。
                                    </p>
                                )}
                                {!data.data.receiptSupported && (
                                    <p className="muted">
                                        节点没有应用回执，配置已提供不代表核心已应用。升级支持回执的
                                        V2Box 后可确认生效状态。
                                    </p>
                                )}
                                {data.data.applicationState === "failed" && (
                                    <p className="muted">
                                        请查看节点服务日志定位原因；面板不采集原始错误、配置正文或密钥。
                                    </p>
                                )}
                                <button
                                    disabled={data.loading || busy || dirty}
                                    onClick={data.reload}
                                >
                                    刷新配置状态
                                </button>
                            </section>
                            <section className="admin-deployment-card">
                                <h3>维护模式</h3>
                                {data.data.maintenance && (
                                    <p role="status">
                                        维护中 · {data.data.maintenance.reason}{" "}
                                        · 至{" "}
                                        {date(data.data.maintenance.endsAt)}
                                        {data.data.maintenance.nodeId !==
                                        node.id
                                            ? `（代理服务 #${data.data.maintenance.nodeId}）`
                                            : ""}
                                    </p>
                                )}
                                {notice && (
                                    <p
                                        role="status"
                                        className="success-message"
                                    >
                                        {notice}
                                    </p>
                                )}
                                <NodeMaintenanceForm
                                    key={JSON.stringify(
                                        data.data.ownMaintenance || null,
                                    )}
                                    node={node}
                                    initial={data.data.ownMaintenance}
                                    onDirty={setDirty}
                                    onBusy={setBusy}
                                    onSaved={() => {
                                        setDirty(false);
                                        setNotice("维护设置已保存");
                                        data.reload();
                                        onSaved?.();
                                    }}
                                />
                            </section>
                        </>
                    )}
                </State>
            </div>
        </Modal>
    );
}
function NodeMaintenanceForm({
    node,
    initial,
    onSaved,
    onDirty,
    onBusy,
}: {
    node: Row;
    initial?: Row | null;
    onSaved: () => void;
    onDirty: (v: boolean) => void;
    onBusy: (v: boolean) => void;
}) {
    const [enabled, setEnabled] = useState(!!initial);
    const [reason, setReason] = useState(initial?.reason || "");
    const [endsAt, setEndsAt] = useState(
        dateTimeInput(initial?.endsAt || Math.floor(Date.now() / 1000) + 3600),
    );
    const [hide, setHide] = useState(!!initial?.hideSubscription);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    return (
        <form
            className="node-maintenance-form"
            onSubmit={async (event) => {
                event.preventDefault();
                if (pending.current) return;
                let end = 0;
                try {
                    if (enabled) end = parseDateTimeInput(endsAt);
                } catch (e) {
                    setError((e as Error).message);
                    return;
                }
                if (
                    enabled &&
                    (!Number.isFinite(end) ||
                        end <= Date.now() / 1000 ||
                        end > Date.now() / 1000 + 30 * 86400)
                ) {
                    setError("维护结束时间须在未来 30 天内");
                    return;
                }
                pending.current = true;
                setBusy(true);
                onBusy(true);
                setError("");
                try {
                    await request(admin("server/manage/maintenance"), {
                        type: node.type,
                        id: node.id,
                        enabled,
                        hideSubscription: hide,
                        ...(enabled
                            ? { reason: reason.trim(), endsAt: end }
                            : {}),
                    });
                    onSaved();
                } catch (e) {
                    setError((e as Error).message);
                } finally {
                    pending.current = false;
                    setBusy(false);
                    onBusy(false);
                }
            }}
        >
            <fieldset disabled={busy}>
                <div className="node-maintenance-switch">
                    <span>此节点启用维护</span>
                    <AdminSwitch
                        label="此节点启用维护"
                        checked={enabled}
                        onChange={async (v) => {
                            setEnabled(v);
                            onDirty(true);
                        }}
                    />
                </div>
                {enabled && (
                    <>
                        <label>
                            维护原因
                            <input
                                required
                                maxLength={200}
                                value={reason}
                                onChange={(e) => {
                                    setReason(e.target.value);
                                    onDirty(true);
                                }}
                            />
                        </label>
                        <label>
                            预计结束时间
                            <input
                                required
                                type="datetime-local"
                                value={endsAt}
                                onChange={(e) => {
                                    setEndsAt(e.target.value);
                                    onDirty(true);
                                }}
                            />
                        </label>
                        <div className="node-maintenance-switch">
                            <span>从新生成的订阅中隐藏</span>
                            <AdminSwitch
                                label="从新生成的订阅中隐藏"
                                checked={hide}
                                onChange={async (v) => {
                                    setHide(v);
                                    onDirty(true);
                                }}
                            />
                        </div>
                    </>
                )}
                <p className="muted">
                    维护期间暂停该节点及其关联线路的运行告警，到期自动结束。订阅隐藏不影响现有连接或客户端已保存的配置。
                </p>
                {error && (
                    <p role="alert" className="alert">
                        {error}
                    </p>
                )}
                <button className="primary" disabled={busy}>
                    {busy ? "正在保存…" : "保存维护设置"}
                </button>
            </fieldset>
        </form>
    );
}
