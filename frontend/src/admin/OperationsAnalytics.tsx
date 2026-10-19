import type { ReactNode } from "react";
import { admin, query } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { formatInstant } from "../shared/timezone";

type Access = {
    available: boolean;
    total: number;
    success: number;
    failed: number;
    unknown: number;
    successRate: number | null;
    latestAt: string | null;
    reasons: { reason: string; count: number }[];
};
export type OperationsReport = {
    from: string;
    to: string;
    generatedAt: string;
    timeZone: string;
    retention: Record<string, number>;
    login: Access;
    subscription: Access;
    risk: {
        available: boolean;
        rules: {
            rule: string;
            hits: number;
            users: number;
            confirmed: number;
            falsePositive: number;
            ignored: number;
            pending: number;
            coverage: number | null;
            falsePositiveRate: number | null;
        }[];
    };
    payments: {
        available: boolean;
        channels: {
            channel: string;
            currency: string;
            orders: number;
            paid: number;
            completed: number;
            paidRate: number | null;
            averagePaymentWaitSeconds: number | null;
        }[];
        callbacksAvailable: boolean;
        callbacks: {
            channel: string;
            total: number;
            handled: number;
            failed: number;
            acknowledged: number;
        }[];
        pendingActivation: number;
        oldestActivationWaitSeconds: number | null;
    };
    mail: {
        available: boolean;
        providers: {
            provider: string;
            stream: string;
            total: number;
            accepted: number;
            failed: number;
            uncertain: number;
            other: number;
            acceptedRate: number | null;
            delivered: number;
            negative: number;
            averageTransportMs: number | null;
            latestAt: string | null;
        }[];
    };
    health: {
        checks: {
            key: string;
            label: string;
            status: string;
            message: string;
        }[];
        queues:
            | {
                  name: string;
                  length: number;
                  waitSeconds: number;
                  processes: number;
              }[]
            | null;
        failedJobsRetained: number | null;
        lastPruneAt: string | null;
        dailyTasks:
            | {
                  task: string;
                  scheduledAt: string;
                  status: string;
                  lastSuccessAt: string | null;
              }[]
            | null;
    };
};
const percentage = (value: number | null) =>
    value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const instant = (value: string | null) =>
    value ? formatInstant(value) : "暂无记录";
const seconds = (value: number | null) =>
    value === null ? "—" : `${value.toLocaleString()} 秒`;
const reasons: Record<string, string> = {
    user_not_found: "账户不存在",
    password_error: "密码错误",
    user_banned: "账户已封禁",
    client_disabled: "客户端已禁用",
    client_version_too_low: "客户端版本过低",
    client_ua_not_allowed: "客户端不允许",
    client_format_not_allowed: "订阅格式不兼容",
    user_unavailable: "账户不可用",
    banned: "账户已封禁",
    no_plan: "未购买套餐",
    expired: "账户已到期",
    traffic_exhausted: "流量已耗尽",
    other: "其他／历史原因",
};
const states: Record<string, string> = {
    healthy: "正常",
    warning: "需关注",
    error: "异常",
    completed: "已完成",
    failed: "失败",
    pending: "待执行",
    running: "执行中",
    not_due: "未到执行时间",
    skipped_upgrade: "升级时跳过",
};
export function ReportTable({
    headers,
    rows,
}: {
    headers: string[];
    rows: ReactNode[][];
}) {
    return rows.length ? (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        {headers.map((h) => (
                            <th key={h} scope="col">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i}>
                            {r.map((v, j) => (
                                <td key={j}>{v}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    ) : (
        <p className="muted">当前范围暂无记录。</p>
    );
}
function Retention({ days, selected }: { days: number; selected: number }) {
    return (
        <p className="muted">
            日志保留：{days ? `${days} 天` : "不自动清理"}。
            {days > 0 && days < selected
                ? "所选范围超过保留期，统计可能不完整。"
                : "统计只覆盖仍保留的记录，不能证明历史采集完整。"}
        </p>
    );
}
function AccessReport({
    title,
    data,
    retention,
    days,
}: {
    title: string;
    data: Access;
    retention: number;
    days: number;
}) {
    return (
        <Panel padded title={title}>
            {!data.available ? (
                <p className="alert">日志表不可用，无法统计。</p>
            ) : (
                <>
                    <div className="analytics-metrics">
                        <div>
                            <span>日志事件</span>
                            <strong>{data.total.toLocaleString()}</strong>
                            <small>
                                成功 {data.success} · 失败 {data.failed} · 未知{" "}
                                {data.unknown}
                            </small>
                        </div>
                        <div>
                            <span>记录成功率</span>
                            <strong>{percentage(data.successRate)}</strong>
                            <small>成功事件 / 全部日志事件</small>
                        </div>
                        <div>
                            <span>最近记录</span>
                            <strong className="analytics-date">
                                {instant(data.latestAt)}
                            </strong>
                            <small>仅当前范围</small>
                        </div>
                    </div>
                    <h3>失败原因排行</h3>
                    <ReportTable
                        headers={["原因", "事件数"]}
                        rows={data.reasons.map((r) => [
                            reasons[r.reason] || reasons.other,
                            r.count,
                        ])}
                    />
                    <p className="muted">
                        按日志事件计数，非用户人数；未写入日志的限流、验证或网络失败不包含在内。订阅成功表示日志记录的配置获取成功，不代表已连接节点。
                    </p>
                    <Retention days={retention} selected={days} />
                </>
            )}
        </Panel>
    );
}
export function OperationsAnalytics({ days }: { days: number }) {
    const report = useData<OperationsReport>(
        query(admin("analytics/operations"), { days }),
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const data = report.data;
    return (
        <>
            <Panel padded title="运营与安全报表">
                <p className="muted">
                    复用后台业务与审计记录；使用上方统计范围，不受访问设备筛选或浏览器统计开关影响。最多缓存
                    60 秒，队列与积压为生成时快照。
                </p>
                <button
                    type="button"
                    onClick={report.reload}
                    disabled={report.loading}
                >
                    刷新运营报表
                </button>
                <State loading={report.loading} error={report.error}>
                    {null}
                </State>
                {data && (
                    <p className="muted">
                        {formatInstant(data.from)} — {formatInstant(data.to)} ·
                        系统时区 {data.timeZone} · 生成于{" "}
                        {formatInstant(data.generatedAt)}
                    </p>
                )}
            </Panel>
            {data && (
                <>
                    <AccessReport
                        title="登录质量"
                        data={data.login}
                        retention={data.retention.login_log_retention_days}
                        days={days}
                    />
                    <AccessReport
                        title="订阅获取质量"
                        data={data.subscription}
                        retention={data.retention.subscribe_log_retention_days}
                        days={days}
                    />
                    <Panel padded title="风控规则效果">
                        {!data.risk.available ? (
                            <p className="alert">
                                风控日志表不可用，无法统计。
                            </p>
                        ) : (
                            <ReportTable
                                headers={[
                                    "规则",
                                    "命中",
                                    "已知账户数",
                                    "确认风险",
                                    "误报",
                                    "忽略",
                                    "待复核",
                                    "复核覆盖率",
                                    "已复核误报率",
                                ]}
                                rows={data.risk.rules.map((r) => [
                                    r.rule,
                                    r.hits,
                                    r.users,
                                    r.confirmed,
                                    r.falsePositive,
                                    r.ignored,
                                    r.pending,
                                    percentage(r.coverage),
                                    percentage(r.falsePositiveRate),
                                ])}
                            />
                        )}
                        <p className="muted">
                            按命中时间入选，展示当前复核状态。复核覆盖率 =（确认
                            + 误报 + 忽略）/ 命中；误报率 = 误报 /
                            已复核。未复核不视为有效命中；无复核时显示
                            —。账户数按每条规则去重，不含未知账户。
                        </p>
                        <Retention
                            days={data.retention.risk_log_retention_days}
                            selected={days}
                        />
                    </Panel>
                    <Panel padded title="支付与开通质量">
                        {!data.payments.available ? (
                            <p className="alert">
                                订单或渠道表不可用，无法统计。
                            </p>
                        ) : (
                            <>
                                <ReportTable
                                    headers={[
                                        "订单当前／最终渠道",
                                        "订单币种",
                                        "订单数",
                                        "已付款",
                                        "已完成／折抵",
                                        "付款比例",
                                        "平均下单至付款",
                                    ]}
                                    rows={data.payments.channels.map((r) => [
                                        r.channel,
                                        r.currency,
                                        r.orders,
                                        r.paid,
                                        r.completed,
                                        percentage(r.paidRate),
                                        seconds(r.averagePaymentWaitSeconds),
                                    ])}
                                />
                                <p className="muted">
                                    按创建时间选取订单，以 paid_at
                                    判断付款，含余额、零元、充值及流量订单；按订单币种分组。渠道切换历史未完整记录，此比例不是支付尝试成功率。今日及新订单尚未充分观察。
                                </p>
                                <h3>支付回调结果</h3>
                                {data.payments.callbacksAvailable ? (
                                    <ReportTable
                                        headers={[
                                            "渠道",
                                            "回调事件",
                                            "处理完成",
                                            "失败",
                                            "仅确认事件",
                                        ]}
                                        rows={data.payments.callbacks.map(
                                            (r) => [
                                                r.channel,
                                                r.total,
                                                r.handled,
                                                r.failed,
                                                r.acknowledged,
                                            ],
                                        )}
                                    />
                                ) : (
                                    <p className="alert">回调历史表不可用。</p>
                                )}
                                <p className="muted">
                                    按回调接收时间计数，包含重复通知；处理完成不等同于新增付款。未验签的通知不归属订单。现有记录无法精确计算实际扣款至回调、到账至开通延迟。
                                </p>
                                <p>
                                    当前全部已付款待开通订单：
                                    <strong>
                                        {data.payments.pendingActivation}
                                    </strong>{" "}
                                    · 最久等待：
                                    {seconds(
                                        data.payments
                                            .oldestActivationWaitSeconds,
                                    )}
                                </p>
                                <Retention
                                    days={
                                        data.retention
                                            .payment_callback_retention_days
                                    }
                                    selected={days}
                                />
                            </>
                        )}
                    </Panel>
                    <Panel padded title="邮件发送与送达">
                        {!data.mail.available ? (
                            <p className="alert">
                                邮件日志表不可用，无法统计。
                            </p>
                        ) : (
                            <ReportTable
                                headers={[
                                    "服务商",
                                    "邮件类型",
                                    "事件数",
                                    "已接受",
                                    "失败",
                                    "结果不确定",
                                    "其他／历史",
                                    "接受比例",
                                    "有送达回执",
                                    "退信／拒绝／投诉",
                                    "平均传输耗时",
                                    "最近记录",
                                ]}
                                rows={data.mail.providers.map((r) => [
                                    r.provider,
                                    r.stream === "transactional"
                                        ? "事务邮件"
                                        : r.stream === "announcement"
                                          ? "公告邮件"
                                          : "历史类型",
                                    r.total,
                                    r.accepted,
                                    r.failed,
                                    r.uncertain,
                                    r.other,
                                    percentage(r.acceptedRate),
                                    r.delivered,
                                    r.negative,
                                    r.averageTransportMs === null
                                        ? "—"
                                        : `${r.averageTransportMs} ms`,
                                    instant(r.latestAt),
                                ])}
                            />
                        )}
                        <p className="muted">
                            接受比例 = 服务商接受 / 日志事件。发送中超过 120
                            秒归为结果不确定；其他包含跳过、发送中和历史未知。服务商接受不代表送达；无送达回执不代表失败。耗时仅为传输耗时，不含队列等待。
                        </p>
                        <Retention
                            days={data.retention.mail_log_retention_days}
                            selected={days}
                        />
                    </Panel>
                    <Panel padded title="队列与定时任务健康">
                        <ReportTable
                            headers={["检查项", "状态", "说明"]}
                            rows={data.health.checks.map((r) => [
                                r.label,
                                states[r.status] || "未知",
                                r.message,
                            ])}
                        />
                        <h3>队列快照</h3>
                        {data.health.queues === null ? (
                            <p className="alert">
                                队列指标读取失败，请检查 Horizon。
                            </p>
                        ) : (
                            <ReportTable
                                headers={[
                                    "队列",
                                    "待执行",
                                    "预计清空耗时",
                                    "进程数",
                                ]}
                                rows={data.health.queues.map((r) => [
                                    r.name,
                                    r.length,
                                    seconds(r.waitSeconds),
                                    r.processes,
                                ])}
                            />
                        )}
                        <p className="muted">
                            队列指标来自
                            Horizon，预计清空耗时不是任务实际排队时长。空列表不表示队列健康，请同时查看主进程检查。
                        </p>
                        <p>
                            失败任务库当前保留：
                            {data.health.failedJobsRetained ?? "不可用"}
                            （全部保留历史，不受日期筛选影响） ·
                            最近日志清理成功：{instant(data.health.lastPruneAt)}
                        </p>
                        <h3>每日业务任务</h3>
                        {data.health.dailyTasks === null ? (
                            <p className="alert">每日任务记录表不可用。</p>
                        ) : (
                            <ReportTable
                                headers={[
                                    "任务",
                                    "系统时区执行时间",
                                    "今日状态",
                                    "最近成功",
                                ]}
                                rows={data.health.dailyTasks.map((r) => [
                                    r.task,
                                    r.scheduledAt,
                                    states[r.status] || "未知",
                                    instant(r.lastSuccessAt),
                                ])}
                            />
                        )}
                    </Panel>
                </>
            )}
        </>
    );
}
