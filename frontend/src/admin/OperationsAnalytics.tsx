import { Empty, Pager, TableViewport } from "../shared/ui";
import { browserLabel } from "./browser-labels";
import { useState, type ReactNode } from "react";
import { admin, query } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { adminInstant as formatInstant } from "./admin-log-time";

type Access = {
    available: boolean;
    total: number;
    success: number;
    failed: number;
    unknown: number;
    successRate: number | null;
    latestAt: string | null;
    clients?: {
        applications?: {code:string;name:string;total:number;success:number;failed:number}[];
        uniqueIps: number;
        unknownIpEvents: number;
        browsers: {
            category: string;
            total: number;
            success: number;
            failed: number;
        }[];
        topIps: {
            maskedIp: string;
            total: number;
            failed: number;
            accounts: number;
        }[];
        countries: { country: string; total: number }[];
    };
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
    pageSize,
}: {
    headers: string[];
    rows: ReactNode[][];
    pageSize?: number;
}) {
    const [page, setPage] = useState(0);
    const size = pageSize || Math.max(rows.length, 1);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const current = Math.min(page, pages - 1);
    return rows.length ? (
        <>
            <TableViewport>
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
                        {rows
                            .slice(current * size, (current + 1) * size)
                            .map((r, i) => (
                                <tr key={i}>
                                    {r.map((v, j) => (
                                        <td key={j}>{v}</td>
                                    ))}
                                </tr>
                            ))}
                    </tbody>
                </table>
            </TableViewport>
            {pages > 1 && (
                <Pager
                    page={current + 1}
                    size={size}
                    total={rows.length}
                    onChange={(next) => setPage(next - 1)}
                />
            )}
        </>
    ) : (
        <Empty text="当前范围暂无记录。" />
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
                    {data.clients && (
                        <>
                            <h3>浏览器与 IP 分布</h3>
                            <p>
                                有效独立 IP：
                                <strong>{data.clients.uniqueIps}</strong> ·
                                缺失或无效 IP 事件：
                                {data.clients.unknownIpEvents}
                            </p>
                            <ReportTable
                                headers={[
                                    "浏览器／内置应用",
                                    "事件",
                                    "成功",
                                    "失败",
                                    "失败比例",
                                ]}
                                rows={data.clients.browsers.map((r) => [
                                    browserLabel(r.category),
                                    r.total,
                                    r.success,
                                    r.failed,
                                    percentage(
                                        r.total ? r.failed / r.total : null,
                                    ),
                                ])}
                            />
                            {data.clients.applications && <><h3>第三方客户端</h3><p className="muted">按当前识别库汇总 UA；未匹配的浏览器及客户端归为其他。</p><ReportTable headers={["客户端","事件","成功","失败"]} rows={data.clients.applications.map(r=>[r.name,r.total,r.success,r.failed])}/></>}
                            <h3>IP 访问排行（失败次数优先，前 20）</h3>
                            <ReportTable
                                headers={[
                                    "脱敏 IP",
                                    "事件",
                                    "失败",
                                    "已知账户",
                                ]}
                                rows={data.clients.topIps.map((r) => [
                                    r.maskedIp,
                                    r.total,
                                    r.failed,
                                    r.accounts,
                                ])}
                            />
                            <h3>访问 IP 国家／地区（前 30）</h3>
                            <ReportTable
                                headers={["GeoIP 归属地（日志记录）", "事件"]}
                                rows={data.clients.countries.map((r) => [
                                    r.country,
                                    r.total,
                                ])}
                            />
                            <p className="muted">
                                复用当前范围内保留的日志。IP
                                数不等于用户数，共享网络可能多人共用一个
                                IP；排行按完整 IP
                                去重后脱敏，外观相同的行可能是不同地址。账户数不包含未识别账户。UA
                                可伪造，地理信息来自日志记录时的本地数据，未知不代表异常，与管理员配置的节点展示地区独立。反代／CDN
                                需正确配置可信代理，否则日志可能只有代理地址。此处不是全站访客统计，也不据此自动封禁。
                            </p>
                        </>
                    )}
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
export function OperationsAnalytics({
    days,
    section = "all",
}: {
    days: number;
    section?: "all" | "security" | "delivery" | "health";
}) {
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
                <p className="muted">沿用上方日期范围，不受设备筛选与浏览器采集开关影响。缓存 60 秒，队列数据为生成时快照。</p>
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
                    {(section === "all" || section === "security") && (
                        <>
                            <AccessReport
                                title="登录质量"
                                data={data.login}
                                retention={
                                    data.retention.login_log_retention_days
                                }
                                days={days}
                            />
                            <AccessReport
                                title="订阅获取质量"
                                data={data.subscription}
                                retention={
                                    data.retention.subscribe_log_retention_days
                                }
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
                                    按命中时间入选，展示当前复核状态。复核覆盖率
                                    =（确认 + 误报 + 忽略）/ 命中；误报率 = 误报
                                    / 已复核。未复核不视为有效命中；无复核时显示
                                    —。账户数按每条规则去重，不含未知账户。
                                </p>
                                <Retention
                                    days={
                                        data.retention.risk_log_retention_days
                                    }
                                    selected={days}
                                />
                            </Panel>
                        </>
                    )}
                    {(section === "all" || section === "delivery") && (
                        <>
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
                                            rows={data.payments.channels.map(
                                                (r) => [
                                                    r.channel,
                                                    r.currency,
                                                    r.orders,
                                                    r.paid,
                                                    r.completed,
                                                    percentage(r.paidRate),
                                                    seconds(
                                                        r.averagePaymentWaitSeconds,
                                                    ),
                                                ],
                                            )}
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
                                            <p className="alert">
                                                回调历史表不可用。
                                            </p>
                                        )}
                                        <p className="muted">
                                            按回调接收时间计数，包含重复通知；处理完成不等同于新增付款。未验签的通知不归属订单。现有记录无法精确计算实际扣款至回调、到账至开通延迟。
                                        </p>
                                        <p>
                                            当前全部已付款待开通订单：
                                            <strong>
                                                {
                                                    data.payments
                                                        .pendingActivation
                                                }
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
                                    接受比例 = 服务商接受 / 日志事件。发送中超过
                                    120
                                    秒归为结果不确定；其他包含跳过、发送中和历史未知。服务商接受不代表送达；无送达回执不代表失败。耗时仅为传输耗时，不含队列等待。
                                </p>
                                <Retention
                                    days={
                                        data.retention.mail_log_retention_days
                                    }
                                    selected={days}
                                />
                            </Panel>
                        </>
                    )}
                    {(section === "all" || section === "health") && (
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
                            <p className="muted">队列来自 Horizon；预计清空耗时不等于实际等待时长，请结合主进程状态判断。</p>
                            <p>
                                失败任务库当前保留：
                                {data.health.failedJobsRetained ?? "不可用"}
                                （全部保留历史，不受日期筛选影响） ·
                                最近日志清理成功：
                                {instant(data.health.lastPruneAt)}
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
                    )}
                </>
            )}
        </>
    );
}
