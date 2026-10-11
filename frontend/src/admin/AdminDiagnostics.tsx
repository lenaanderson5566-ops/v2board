import { admin, date, type Row } from "../shared/api";
import { Modal, Panel, State, useData } from "../shared/ui";

export const nodeRuntimeLabels: Record<string, string> = {
    online: "在线",
    offline: "离线",
    limited: "额度受限",
    unknown: "暂无通信记录",
};
const configLabels: Record<string, string> = {
    unknown: "暂无配置拉取记录",
    pending: "配置已变更，等待节点拉取",
    provided: "已提供最新配置，待应用确认",
    invalid: "配置生成异常，请检查节点与路由设置",
};
export function NodeDiagnostics({
    node,
    close,
}: {
    node: Row;
    close: () => void;
}) {
    const data = useData<Row>(
        admin(
            `server/manage/runtime?type=${encodeURIComponent(node.type)}&id=${node.id}`,
        ),
    );
    return (
        <Modal title={`运行状态 · ${node.name}`} close={close}>
            <div className="pad">
                <p>
                    节点状态：
                    {nodeRuntimeLabels[node.runtime_status] ||
                        nodeRuntimeLabels.unknown}
                </p>
                <p>
                    最近通信：
                    {date(
                        Math.max(
                            Number(node.last_check_at || 0),
                            Number(node.last_push_at || 0),
                        ),
                    )}
                </p>
                <p>最近流量上报：{date(node.last_push_at)}</p>
                <State {...data} retry={data.reload}>
                    {data.data && (
                        <>
                            <p>
                                配置同步：
                                {configLabels[data.data.configurationState] ||
                                    configLabels.unknown}
                            </p>
                            <p>最近提供配置：{date(data.data.providedAt)}</p>
                            <p>
                                核心版本：{data.data.coreVersion || "尚未上报"}
                            </p>
                            {data.data.capabilitiesReportedAt && (
                                <p>
                                    版本上报时间：
                                    {new Date(
                                        data.data.capabilitiesReportedAt,
                                    ).toLocaleString()}
                                </p>
                            )}
                            {data.data.inheritedFrom && (
                                <p>
                                    子节点沿用父节点 #{data.data.inheritedFrom}{" "}
                                    的运行配置与通信状态。
                                </p>
                            )}
                            <p className="muted">
                                配置接口成功响应不代表代理核心已成功应用。目前节点没有应用回执，不能据此确认配置已生效。通信超过
                                5 分钟视为离线；记录过期后显示暂无通信记录。
                            </p>
                        </>
                    )}
                </State>
                <button onClick={data.reload}>刷新配置状态</button>
            </div>
        </Modal>
    );
}
export function SystemHealth() {
    const data = useData<Row>(admin("system/health"));
    return (
        <Panel
            title="系统健康检查"
            actions={<button onClick={data.reload}>重新检查</button>}
        >
            <State {...data} retry={data.reload}>
                {data.data && (
                    <div className="pad">
                        <p className="muted">
                            PHP {data.data.phpVersion} · Laravel{" "}
                            {data.data.frameworkVersion} · 检查时间{" "}
                            {date(data.data.checkedAt)}
                        </p>
                        <div className="health-check-grid">
                            {(data.data.checks || []).map((check: Row) => (
                                <article
                                    key={check.key}
                                    className={`health-check ${check.status}`}
                                >
                                    <strong>{check.label}</strong>
                                    <span>
                                        {(
                                            {
                                                healthy: "正常",
                                                warning: "需处理",
                                                error: "异常",
                                            } as Record<string, string>
                                        )[check.status] || "未知"}
                                    </span>
                                    <p>{check.message}</p>
                                    {check.lastRunAt && (
                                        <small>
                                            最近执行：{date(check.lastRunAt)}
                                        </small>
                                    )}
                                    {check.pendingCount > 0 && (
                                        <small>
                                            未执行迁移：{check.pendingCount} 项
                                        </small>
                                    )}
                                </article>
                            ))}
                        </div>
                        <p className="muted">
                            只读检查，不执行迁移、不重启进程。队列状态表示
                            Horizon
                            主进程运行状态，不保证每个任务都执行成功；任务失败请结合队列详情与系统日志排查。
                        </p>
                    </div>
                )}
            </State>
        </Panel>
    );
}
