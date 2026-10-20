import { AnalyticsCollectionSettings } from "./AnalyticsCollectionSettings";
import { TargetStatisticsSettings } from "./AdminTargetStatistics";
import { adminInstant as formatInstant } from "./admin-log-time";
import { admin, request, type Row } from "../shared/api";
import { Editor, Panel, State, useData } from "../shared/ui";
const time = (value: number) => (value ? formatInstant(value) : "—");
const retentionFields = [
    [
        "mail_log_retention_days",
        "邮件日志",
        0,
        "0 表示不自动清理；可设置 30–365 天，建议 90 天。历史日志不会因升级自动删除。",
    ],
    [
        "client_diagnostic_retention_days",
        "客户端运行记录",
        1,
        "默认保留 30 天；自愿共享的脱敏运行事件及旧版诊断。",
    ],
    [
        "registration_signal_retention_days",
        "注册信号摘要",
        1,
        "默认保留 90 天；清理后无法与更早的注册信号比较，已有复核结论保留。",
    ],
    [
        "payment_callback_retention_days",
        "支付回调诊断",
        1,
        "默认保留 30 天；仅记录脱敏阶段和结果。",
    ],
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
            <Panel title="日志与保留策略">
                <div className="pad">
                    <p>每 5 分钟清理过期日志。缩短保留时间会永久删除过期数据。</p>
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
                        initial={{
                            payment_callback_retention_days: 30,
                            ...retention.data?.settings,
                        }}
                        onSave={async (b) => {
                            await request(admin("system/logRetention"), b);
                            retention.reload();
                        }}
                    />
                </State>
            </Panel>
            <AnalyticsCollectionSettings />
            <TargetStatisticsSettings />
        </>
    );
}
