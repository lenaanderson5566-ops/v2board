import { admin, query } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { adminInstant as formatInstant } from "./admin-log-time";
import { ReportTable } from "./OperationsAnalytics";
import { analyticsLabels } from "./analytics-labels";

type Ratio = number | null;
export type JourneyReport = {
    business: {
        generatedAt: string;
        timeZone: string;
        retention: Record<string, number>;
        usageEarliestAt: string | null;
        activation: {
            from: string;
            to: string;
            registered: number;
            paid: number;
            subscribed: number | null;
            used: number | null;
            averagePaymentSeconds: number | null;
            averageSubscriptionSeconds: number | null;
        };
        retentionCohorts: {
            day: number;
            from: string;
            to: string;
            registered: number;
            login: number | null;
            usage: number | null;
            loginRate: Ratio;
            usageRate: Ratio;
        }[];
        active: { days: number; login: number | null; usage: number | null }[];
        repurchase: {
            from: string;
            to: string;
            eligible: number;
            renewed: number;
            rate: Ratio;
        };
        expiredUnrestored: number;
        expiryFrom: string;
        expiryTo: string;
    };
    experience: {
        available: boolean;
        enabled?: boolean;
        retentionDays?: number;
        effectiveFrom?: string;
        rows: {
            page: string;
            event: string;
            samples: number;
            sessions: number;
            average: Ratio;
            p75Upper: Ratio;
            p95Upper: Ratio;
        }[];
    };
};
const ratio = (v: Ratio) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const count = (v: number | null) =>
    v === null ? "不可用" : v.toLocaleString();
const duration = (v: number | null) =>
    v === null ? "—" : `${v.toLocaleString()} 秒`;
const eventNames: Record<string, string> = {
    guide_manual: "展开手动复制",
    guide_continue: "继续当前浏览器",
    download: "下载点击",
    copy_success: "复制成功",
    copy_failed: "复制失败",
    import_start: "发起导入",
    help_open: "打开帮助",
    js_error: "脚本异常",
    api_error: "接口错误",
    network_error: "网络错误",
    api_request: "接口耗时",
    lcp: "LCP",
    inp: "INP",
    cls: "CLS",
};
export function JourneyAnalytics({
    days,
    device,
}: {
    days: number;
    device: string;
}) {
    const report = useData<JourneyReport>(
        query(admin("analytics/journey"), { days, device }),
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const data = report.data;
    const b = data?.business;
    const x = data?.experience;
    const metrics =
        x?.rows.filter((r) =>
            ["api_request", "lcp", "inp", "cls"].includes(r.event),
        ) || [];
    const actions =
        x?.rows.filter(
            (r) => !["api_request", "lcp", "inp", "cls"].includes(r.event),
        ) || [];
    return (
        <>
            <Panel padded title="用户旅程与体验">
                <p className="muted">
                    业务指标复用订单、订阅、登录和日流量记录，排除管理员，不受设备筛选和匿名统计开关影响。体验指标沿用设备筛选、用户同意和统计保留期。最多缓存
                    60 秒。
                </p>
                <button
                    type="button"
                    onClick={report.reload}
                    disabled={report.loading}
                >
                    刷新旅程报表
                </button>
                <State loading={report.loading} error={report.error}>
                    {null}
                </State>
                {b && (
                    <p className="muted">
                        生成于 {formatInstant(b.generatedAt)} · 系统时区{" "}
                        {b.timeZone}
                    </p>
                )}
            </Panel>
            {b && (
                <>
                    <Panel padded title="注册到首次使用 · 7 日观察窗">
                        <p className="muted">
                            注册区间：{formatInstant(b.activation.from)} 至{" "}
                            {formatInstant(b.activation.to)}
                            （不含结束）。只纳入已完成 7
                            个自然日观察窗的账户，注册当天为第 1 日。
                        </p>
                        <ReportTable
                            headers={["阶段", "账户数", "较上一步比例"]}
                            rows={[
                                ["注册", count(b.activation.registered), "—"],
                                [
                                    "首次套餐付款在观察窗内",
                                    count(b.activation.paid),
                                    ratio(
                                        b.activation.registered
                                            ? b.activation.paid /
                                                  b.activation.registered
                                            : null,
                                    ),
                                ],
                                [
                            "上述付款后有订阅成功日志",
                                    count(b.activation.subscribed),
                                    ratio(
                                        b.activation.subscribed !== null &&
                                            b.activation.paid
                                            ? b.activation.subscribed /
                                                  b.activation.paid
                                            : null,
                                    ),
                                ],
                                [
                                    "上述用户在同窗内有日流量记录",
                                    count(b.activation.used),
                                    ratio(
                                        b.activation.used !== null &&
                                            b.activation.subscribed
                                            ? b.activation.used /
                                                  b.activation.subscribed
                                            : null,
                                    ),
                                ],
                            ]}
                        />
                        <p>
                            平均注册至首次付款：
                            {duration(b.activation.averagePaymentSeconds)} ·
                            平均付款至首条订阅成功日志：
                            {duration(b.activation.averageSubscriptionSeconds)}
                        </p>
                        <p className="muted">
                            套餐付款含余额和零元订单，排除充值与流量重置；订阅与付款按日志时间关联，成功日志不保证客户端已收到配置。日流量只能证明同一观察窗内有使用记录，不能证明订阅后的精确连接顺序、连接成功率或首次连接耗时。没有补造历史事件。
                        </p>
                    </Panel>
                    <Panel padded title="账户活跃与观测留存">
                        <ReportTable
                            headers={[
                                "范围（含今日）",
                                "成功登录账户",
                                "有日流量账户",
                            ]}
                            rows={b.active.map((r) => [
                                r.days === 1 ? "今日" : `近 ${r.days} 日`,
                                count(r.login),
                                count(r.usage),
                            ])}
                        />
                        <h3>注册批次留存</h3>
                        <ReportTable
                            headers={[
                                "观察日",
                                "注册区间",
                                "完整观察样本",
                                "当日登录",
                                "登录观测留存",
                                "当日有流量",
                                "使用观测留存",
                            ]}
                            rows={b.retentionCohorts.map((r) => [
                                `第 ${r.day} 日`,
                                `${formatInstant(r.from)} — ${formatInstant(r.to)}`,
                                r.registered,
                                count(r.login),
                                ratio(r.loginRate),
                                count(r.usage),
                                ratio(r.usageRate),
                            ])}
                        />
                        <p className="muted">
                            各批次分别向前移动观察天数，仅包含完整观察窗；按账户去重，注册当天为第
                            1
                            日。登录留存按登录记录统计，使用留存按日流量统计。
                        </p>
                        <p className="muted">
                            当前登录日志保留：
                            {b.retention.login_log_retention_days
                                ? `${b.retention.login_log_retention_days} 天`
                                : "不自动清理"}
                            ；当前最早保留的日流量：
                            {b.usageEarliestAt
                                ? formatInstant(b.usageEarliestAt)
                                : "暂无记录"}
                            。这不证明期间完整无缺；超出历史覆盖范围的数值应谨慎解读。
                        </p>
                    </Panel>
                    <Panel padded title="续费与到期未恢复">
                        <p className="muted">
                            首笔非零金额套餐付款批次：
                            {formatInstant(b.repurchase.from)} 至{" "}
                            {formatInstant(b.repurchase.to)}
                            （不含结束）；仅纳入已完成 30×24
                            小时观察的首付账户。
                        </p>
                        <ReportTable
                            headers={[
                                "首付样本",
                                "30 日内有非零金额续费付款",
                                "观测续费比例",
                            ]}
                            rows={[
                                [
                                    b.repurchase.eligible,
                                    b.repurchase.renewed,
                                    ratio(b.repurchase.rate),
                                ],
                            ]}
                        />
                        <p className="muted">
                            按账户去重，续费取 type=2
                            的正价套餐付款，排除充值、重置与零元订单。不同周期的自然续费机会不同，30
                            日内续费比例不能作为全站到期续费率。
                        </p>
                        <p>
                            当前已到期至少 7×24 小时且未恢复账户：
                            <strong>{b.expiredUnrestored}</strong>
                        </p>
                        <p className="muted">
                            当前到期时间范围：{formatInstant(b.expiryFrom)} —{" "}
                            {formatInstant(b.expiryTo)}
                            。只看当前套餐和到期时间，不包括已恢复账户；缺少完整历史到期快照，不计算历史流失率。
                        </p>
                    </Panel>
                </>
            )}
            {x && (
                <Panel padded title="引导效果与性能观测">
                    {!x.available ? (
                        <p className="alert">
                            体验统计表尚未安装，请通过更新流程执行新增迁移。业务旅程仍可查看。
                        </p>
                    ) : (
                        <>
                            {!x.enabled && (
                                <p className="muted">
                                    匿名统计已关闭，仅展示仍在保留期内的历史样本。
                                </p>
                            )}
                            <ReportTable
                                headers={[
                                    "页面",
                                    "动作／异常",
                                    "事件样本",
                                    "会话数",
                                ]}
                                rows={actions.map((r) => [
                                    analyticsLabels[r.page] || r.page,
                                    eventNames[r.event] || r.event,
                                    r.samples,
                                    r.sessions,
                                ])}
                            />
                            <h3>性能样本</h3>
                            <ReportTable
                                headers={[
                                    "归属页面",
                                    "指标",
                                    "样本数",
                                    "平均值",
                                    "P75 桶上界",
                                    "P95 桶上界",
                                ]}
                                rows={metrics.map((r) => {
                                    const value = (v: Ratio) =>
                                        v === null
                                            ? "—"
                                            : r.event === "cls"
                                              ? (v / 1000).toFixed(3)
                                              : `${v.toLocaleString()} ms`;
                                    return [
                                        analyticsLabels[r.page] || r.page,
                                        eventNames[r.event],
                                        r.samples,
                                        value(r.average),
                                        value(r.p75Upper),
                                        value(r.p95Upper),
                                    ];
                                })}
                            />
                            <p className="muted">
                                下载和导入只统计点击/发起，复制成功仅指写入剪贴板，帮助只统计打开，不证明安装、阅读或连接成功。每个文档最多采样
                                20 次接口调用，错误仅保留类别；API
                                样本含全部状态，无接口地址或错误文本。数值为客户端上报，可能漏报，不用于风控或账务。
                            </p>
                            <p className="muted">
                                LCP/INP/CLS 使用
                                web-vitals，每个文档各指标取首次可上报值，归属启动监测时的入口页面；SPA
                                内后续页面不能视为独立 Web Vitals。CLS
                                以千分之一精度采集。P75/P95
                                为固定直方图桶上界估计，并非精确分位值；不支持的浏览器或无交互时不会补造
                                0。
                            </p>
                            <p className="muted">
                                有效窗口起点：
                                {x.effectiveFrom
                                    ? formatInstant(x.effectiveFrom)
                                    : "暂无"}{" "}
                                · 保留 {x.retentionDays}{" "}
                                天。新增指标从用户重新同意后开始上报，无历史回填；本地限频及每会话
                                200 事件上限会影响样本量。
                            </p>
                        </>
                    )}
                </Panel>
            )}
        </>
    );
}
