import { useState } from "react";
import { AdminTabs } from "./AdminChoices";
import "./admin-management.css";
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
    const initial = new URLSearchParams(window.location.hash.split("?")[1]).get(
        "tab",
    );
    const [tab, setTab] = useState(
        initial === "analytics" || initial === "targets"
            ? initial
            : "retention",
    );
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
        <div className="admin-management-page">
            <Panel padded title="日志与保留策略">
                <p className="muted">
                    按数据类型管理采集和保留时间。缩短保留期会永久清理过期数据。
                </p>
            </Panel>
            <AdminTabs
                label="日志策略分类"
                value={tab}
                onChange={(next) => {
                    if (
                        busy ||
                        (dirty &&
                            !window.confirm(
                                "当前分类有未保存的修改，确认放弃并切换？",
                            ))
                    )
                        return;
                    setDirty(false);
                    setTab(next);
                }}
                options={[
                    { value: "retention", label: "日志保留", disabled: busy },
                    { value: "analytics", label: "访问统计", disabled: busy },
                    { value: "targets", label: "节点访问目标", disabled: busy },
                ]}
            >
                {tab === "retention" && (
                    <LogRetention
                        onDirty={() => setDirty(true)}
                        onSaved={() => setDirty(false)}
                        onBusyChange={setBusy}
                    />
                )}
                {tab === "analytics" && (
                    <AnalyticsCollectionSettings
                        onDirty={() => setDirty(true)}
                        onSaved={() => setDirty(false)}
                        onBusyChange={setBusy}
                    />
                )}
                {tab === "targets" && (
                    <TargetStatisticsSettings onBusyChange={setBusy} />
                )}
            </AdminTabs>
        </div>
    );
}
function LogRetention({
    onDirty,
    onSaved,
    onBusyChange,
}: {
    onDirty: () => void;
    onSaved: () => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const retention = useData<Row>(admin("system/logRetention"));
    const category = (key: string) =>
        [
            "login_log_retention_days",
            "subscribe_log_retention_days",
            "risk_log_retention_days",
            "connection_log_retention_days",
        ].includes(key)
            ? "访问与安全"
            : [
                    "system_log_retention_days",
                    "ddns_log_retention_days",
                    "client_diagnostic_retention_days",
                ].includes(key)
              ? "运行与诊断"
              : "业务与通知";
    const sections = ["访问与安全", "业务与通知", "运行与诊断"];
    const seen = new Set<string>(["访问与安全"]);
    const fields = [...retentionFields]
        .sort(
            (a, b) =>
                sections.indexOf(category(a[0])) -
                sections.indexOf(category(b[0])),
        )
        .map(([key, label, min, hint]) => {
            const group = category(key),
                section = seen.has(group) ? undefined : group;
            seen.add(group);
            return {
                key,
                label: label + "保留天数",
                type: "number" as const,
                min,
                max: 365,
                step: 1,
                unit: "天",
                required: true,
                hint,
                section,
            };
        });
    return (
        <Panel title="日志保留" className="settings-panel">
            <State {...retention} retry={retention.reload}>
                <div className="admin-settings-summary">
                    <span>
                        自动清理周期 <strong>每 5 分钟</strong>
                    </span>
                    <span>
                        最近成功执行{" "}
                        <strong>{time(retention.data?.lastRun?.at)}</strong>
                    </span>
                    {retention.data?.lastRun && (
                        <span>
                            最近清理{" "}
                            <strong>
                                {Object.values(
                                    retention.data.lastRun.deleted || {},
                                ).reduce<number>(
                                    (sum, v) => sum + Number(v),
                                    0,
                                )}{" "}
                                条
                            </strong>
                        </span>
                    )}
                </div>
                {retention.data && (
                    <Editor
                        key={JSON.stringify(retention.data.settings)}
                        fields={[
                            {
                                key: "connection_log_interval",
                                label: "连接日志采样间隔",
                                type: "number",
                                min: 60,
                                max: 86400,
                                step: 1,
                                unit: "秒",
                                required: true,
                                section: "访问与安全",
                                hint: "建议 3600 秒；间隔越短，写入量越大。",
                            },
                            ...fields,
                        ]}
                        initial={{
                            payment_callback_retention_days: 30,
                            ...retention.data.settings,
                        }}
                        onDirty={onDirty}
                        onBusyChange={onBusyChange}
                        onSave={async (body) => {
                            await request(admin("system/logRetention"), body);
                            onSaved();
                            retention.reload();
                        }}
                    />
                )}
            </State>
        </Panel>
    );
}
