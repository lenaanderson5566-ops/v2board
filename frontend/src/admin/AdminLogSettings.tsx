import { admin, request, type Row } from "../shared/api";
import { Editor, Panel, State, useData } from "../shared/ui";
const time = (value: number) =>
    value ? new Date(value * 1000).toLocaleString() : "—";
const retentionFields = [
    ["system_log_retention_days", "系统日志", 1, "默认 30 天。"],
    ["connection_log_retention_days", "连接日志", 1, "默认 30 天。"],
    [
        "login_log_retention_days",
        "登录日志",
        0,
        "0 表示不自动清理；启用时为 30–365 天，建议 90 天。",
    ],
    [
        "subscribe_log_retention_days",
        "订阅日志",
        0,
        "0 表示不自动清理；启用时为 30–365 天，建议 90 天。",
    ],
    [
        "risk_log_retention_days",
        "风控命中",
        0,
        "0 表示不自动清理；启用时为 30–365 天。只清理已复核且超过保留期的记录，保留未复核及待复核记录。",
    ],
    ["ddns_log_retention_days", "DDNS 日志", 1, "默认 30 天。"],
] as const;
export function AdminLogSettings() {
    const retention = useData<Row>(admin("system/logRetention"));
    return (
        <>
            <Panel title="日志设置">
                <div className="pad">
                    <p>
                        保存后由定时任务每 5
                        分钟分批清理，不在节点上报请求中删除日志。缩短保留时间后，过期数据会被永久删除。
                    </p>
                    <p className="muted">
                        最近成功执行：{time(retention.data?.lastRun?.at)}
                        {retention.data?.lastRun &&
                            ` · 删除 ${Object.values(retention.data.lastRun.deleted || {}).reduce<number>((sum, v) => sum + Number(v), 0)} 条 · 补齐 ${retention.data.lastRun.indexed || 0} 条检索字段`}
                    </p>
                </div>
                <State {...retention} retry={retention.reload}>
                    <Editor
                        key={JSON.stringify(retention.data?.settings)}
                        fields={[
                            {
                                key: "connection_log_interval",
                                label: "连接日志采样间隔",
                                type: "number" as const,
                                min: 60,
                                max: 86400,
                                step: 1,
                                unit: "秒",
                                required: true,
                                hint: "建议 3600 秒。间隔越短，写入量越大；不影响风控规则的统计窗口。",
                            },
                            ...retentionFields.map(
                                ([key, label, min, hint]) => ({
                                    key,
                                    label: label + "保留天数",
                                    type: "number" as const,
                                    min,
                                    max: 365,
                                    step: 1,
                                    unit: "天",
                                    required: true,
                                    hint,
                                }),
                            ),
                        ]}
                        initial={retention.data?.settings || {}}
                        onSave={async (b) => {
                            await request(admin("system/logRetention"), b);
                            retention.reload();
                        }}
                    />
                </State>
            </Panel>
        </>
    );
}
