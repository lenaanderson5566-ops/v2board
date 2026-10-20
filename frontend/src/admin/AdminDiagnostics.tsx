import { adminInstant as formatInstant } from "./admin-log-time";
import { admin, date, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";

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
                                    {formatInstant(
                                        data.data.capabilitiesReportedAt,
                                    )}
                                </p>
                            )}
                            {data.data.inheritedFrom && (
                                <p>
                                    子节点沿用父节点 #{data.data.inheritedFrom}{" "}
                                    的运行配置与通信状态。
                                </p>
                            )}
                            <p className="muted">节点没有应用回执，配置已提供不代表核心已应用。超过 5 分钟无通信视为离线，记录过期显示暂无通信记录。</p>
                        </>
                    )}
                </State>
                <button onClick={data.reload}>刷新配置状态</button>
            </div>
        </Modal>
    );
}
