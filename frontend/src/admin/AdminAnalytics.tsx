import { formatNumber, formatPercent } from "../shared/number-format";
import { TableViewport } from "../shared/ui";
import { AdminTabs } from "./AdminChoices";
import { JourneyAnalytics } from "./JourneyAnalytics";
import { analyticsLabels as labels } from "./analytics-labels";
import { useState } from "react";
import { admin, query } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { adminInstant as formatInstant, adminBusinessInstant } from "./admin-log-time";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import "./analytics.css";
import { browserLabel } from "./browser-labels";
import { ReportTable } from "./ReportTable";

type Report = {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
    browsersReady?: boolean;
    browsers?: {
        browser: string;
        major: number | null;
        os: string;
        embedded: string;
        sessions: number;
    }[];
    sourcesReady?: boolean;
    sourceGroups?: number;
    sources?: {
        kind: "historical" | "unknown" | "referral";
        domain: string | null;
        sessions: number;
        plans: number;
        confirmations: number;
        payments: number;
    }[];
    timeZone: string;
    from: string;
    to: string;
    latestEventAt: string | null;
    effectiveFrom: string;
    collectionStartedAt: string | null;
    previous: { sessions: number; from: string; to: string } | null;
    daily: {
        date: string;
        sessions: number;
        views: number;
        available: boolean;
    }[];
    sessions: number;
    hours?: number[];
    weekdays?: number[];
    views: number;
    pages: { page: string; sessions: number; views: number }[];
    devices: { device: string; sessions: number }[];
    funnel: { step: string; sessions: number }[];
    cohort: {
        from: string;
        to: string;
        windowDays: number;
        registered: number;
        ordered: number;
        paid: number;
        completed: number;
    };
};

const percent = (part: number, total: number) =>
    total ? formatPercent(part / total, { fraction: true, bounded: true }) : "—";
function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
    return (
        <ol className="analytics-funnel">
            {steps.map((step, index) => (
                <li key={step.label}>
                    <div>
                        <span>
                            {index + 1}. {step.label}
                        </span>
                        <strong>{formatNumber(step.count, { maximumFractionDigits: 0 })}</strong>
                    </div>
                    <progress
                        max={Math.max(steps[0].count, 1)}
                        value={step.count}
                        aria-label={`${step.label} ${step.count}`}
                    />
                    <small>
                        {index === 0
                            ? "起始样本"
                            : `上一步转化 ${percent(step.count, steps[index - 1].count)} · 流失 ${formatNumber(Math.max(0, steps[index - 1].count - step.count), { maximumFractionDigits: 0 })}`}
                    </small>
                </li>
            ))}
        </ol>
    );
}
export function AdminAnalytics() {
    const [tab, setTab] = useState("overview");
    const productTab = ["overview", "conversion"].includes(tab);
    const [days, setDays] = useState(30);
    const [device, setDevice] = useState("all");
    const report = useData<Report>(
        productTab ? query(admin("analytics/report"), { days, device }) : "",
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const data = report.data;
    return (
        <div className="analytics-page">
            <Panel padded title="访问与转化">
                <div className="analytics-settings">
                    <label>
                        统计范围{" "}
                        <select
                            value={days}
                            onChange={(event) =>
                                setDays(Number(event.target.value))
                            }
                        >
                            {[7, 30, 90].map((value) => (
                                <option value={value} key={value}>
                                    近 {value} 天
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        访问设备{" "}
                        <select
                            disabled={!productTab && tab !== "experience"}
                            value={device}
                            onChange={(event) => setDevice(event.target.value)}
                        >
                            <option value="all">全部设备</option>
                            {["desktop", "mobile", "tablet"].map((value) => (
                                <option value={value} key={value}>
                                    {labels[value]}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <State loading={report.loading} error={report.error}>
                    {null}
                </State>
                {productTab && data && (
                    <>
                        <p className="muted">
                            {adminBusinessInstant(data.from, {}, data.timeZone)} —{" "}
                            {adminBusinessInstant(data.to, {}, data.timeZone)} · 按业务时区{" "}
                            {data.timeZone} 划分日期 · 最多缓存 60 秒
                        </p>
                        {!data.ready && (
                            <p className="alert">
                                访问统计表尚未安装，请先通过更新流程执行数据库迁移。业务转化仍可查看。
                            </p>
                        )}
                        {!data.settings.enabled && (
                            <p className="muted">
                                访问收集已关闭。历史数据在保留期内仍可查看，业务转化不依赖浏览器收集。
                            </p>
                        )}
                    </>
                )}
            </Panel>
            <p className="muted">
                设备筛选作用于访问与体验样本，业务转化不受设备筛选影响。
                <a href="#/log-settings?tab=analytics">
                    管理采集开关与保留时间
                </a>
            </p>
            <AdminTabs
                label="访问与转化报表分类"
                value={tab}
                onChange={setTab}
                options={[
                    { value: "overview", label: "访问概览" },
                    { value: "conversion", label: "购买转化" },
                    { value: "experience", label: "体验问题" },
                ]}
            >
                <div className="analytics-page">
                    {tab === "overview" && data && (
                        <Panel padded title="访问摘要">
                            {" "}
                            <div className="analytics-metrics">
                                <div>
                                    <span>访问会话</span>
                                    <strong>
                                        {formatNumber(data.sessions, { maximumFractionDigits: 0 })}
                                    </strong>
                                    <small>
                                        30 分钟无操作后重新计数，非独立人数
                                    </small>
                                </div>
                                <div>
                                    <span>页面浏览</span>
                                    <strong>
                                        {formatNumber(data.views, { maximumFractionDigits: 0 })}
                                    </strong>
                                    <small>包含确认订单与付款视图</small>
                                </div>
                                <div>
                                    <span>最近收到访问</span>
                                    <strong className="analytics-date">
                                        {data.latestEventAt
                                            ? formatInstant(data.latestEventAt)
                                            : "暂无数据"}
                                    </strong>
                                    <small>仅限当前范围及设备</small>
                                </div>
                            </div>
                        </Panel>
                    )}

                    {tab === "experience" && (
                        <JourneyAnalytics
                            days={days}
                            device={device}
                            experienceOnly
                        />
                    )}
                    {tab === "overview" && data && (
                        <Panel padded title="访问浏览器与系统">
                            {data.browsersReady ? (
                                <ReportTable
                                    key={`${days}-${device}`}
                                    pageSize={20}
                                    headers={[
                                        "浏览器",
                                        "主要版本",
                                        "系统",
                                        "内置应用",
                                        "会话",
                                    ]}
                                    rows={(data.browsers || []).map((r) => [
                                        browserLabel(r.browser),
                                        r.major ?? "—",
                                        browserLabel(r.os),
                                        browserLabel(r.embedded),
                                        r.sessions,
                                    ])}
                                />
                            ) : (
                                <p className="muted">
                                    浏览器统计迁移尚未完成。
                                </p>
                            )}
                            <p className="muted">
                                按首次 UA 分类，展示前 100
                                个组合，仅含同意统计的样本。历史未采集单列，未知不代表异常；内置浏览器可能声明
                                Chrome/Safari。引导动作见“用户体验”，复制成功不代表外部打开成功。
                            </p>
                            <p className="muted">
                                仅按 UA 声明识别品牌；隐藏标记的 360
                                等浏览器可能归入 Chrome。
                            </p>
                        </Panel>
                    )}
                    {data && (
                        <>
                            {tab === "overview" && (
                                <Panel padded title="数据质量与每日趋势">
                                    <p className="muted">
                                        首次开启：
                                        {data.collectionStartedAt
                                            ? formatInstant(
                                                  data.collectionStartedAt,
                                              )
                                            : "尚未记录"}{" "}
                                        · 当前有效窗口起点：
                                        {formatInstant(data.effectiveFrom)}
                                        。停用、拒绝、拦截与采集失败都会造成缺口，不能据此推断全站人数。
                                    </p>
                                    {data.sessions < 100 && (
                                        <p className="muted">
                                            当前少于 100
                                            个会话，建议先观察趋势，不据此判断改版效果。
                                        </p>
                                    )}
                                    <p>
                                        {data.previous
                                            ? `与上一周期同等已过时间相比：${data.previous.sessions ? formatPercent((data.sessions - data.previous.sessions) / data.previous.sessions, { fraction: true }) : "上一周期无会话，暂不计算变化率"}`
                                            : "没有完整上一周期的保留数据，暂不展示变化率。"}
                                    </p>
                                    <div
                                        className="analytics-trend"
                                        role="img"
                                        aria-label="每日访问会话趋势，详细数值可展开查看"
                                    >
                                        {data.daily.map((day) => (
                                            <div
                                                key={day.date}
                                                title={`${day.date}：${day.available ? day.sessions + " 会话" : "不在有效窗口"}`}
                                            >
                                                <span
                                                    style={{
                                                        height: `${day.available ? Math.max(2, (day.sessions / Math.max(1, ...data.daily.map((row) => row.sessions))) * 100) : 0}%`,
                                                    }}
                                                />
                                                <small>
                                                    {day.date.slice(5)}
                                                </small>
                                            </div>
                                        ))}
                                    </div>
                                    <details>
                                        <summary>每日详细数据</summary>
                                        <TableViewport>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>日期</th>
                                                        <th>访问会话</th>
                                                        <th>浏览次数</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {data.daily.map((day) => (
                                                        <tr key={day.date}>
                                                            <td>{day.date}</td>
                                                            <td>
                                                                {day.available
                                                                    ? day.sessions
                                                                    : "—"}
                                                            </td>
                                                            <td>
                                                                {day.available
                                                                    ? day.views
                                                                    : "—"}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </TableViewport>
                                    </details>
                                    <p className="muted">
                                        按会话开始日统计；边界日期可能不完整，未采集的历史数据不补算。
                                    </p>
                                </Panel>
                            )}
                            {tab === "conversion" && (
                                <Panel padded title="购买路径 · 同一访问会话">
                                    <Funnel
                                        steps={data.funnel.map((step) => ({
                                            label: labels[step.step],
                                            count: step.sessions,
                                        }))}
                                    />
                                    <p className="muted">
                                        按会话依次统计“浏览套餐 → 确认订单 →
                                        进入付款”，每步最多一次；跨会话、直接续付和未同意统计的用户可能缺失。进入付款不代表支付成功。
                                    </p>
                                    <p className="muted">
                                        会话按开始时间归入范围，仅展示尚在{" "}
                                        {data.settings.retentionDays}{" "}
                                        天保留期内的数据。拒绝统计、网络拦截和漏报会影响结果。
                                    </p>
                                </Panel>
                            )}
                            {tab === "conversion" && (
                                <Panel
                                    padded
                                    title="注册后的业务转化 · 7 天观察窗"
                                >
                                    <p className="muted">
                                        注册区间：
                                        {adminBusinessInstant(
                                            data.cohort.from,
                                            {}, data.timeZone,
                                        )} 至 {adminBusinessInstant(data.cohort.to, {}, data.timeZone)}
                                        （不含结束时刻）。为避免新用户尚未来得及购买，只统计已满
                                        7
                                        天的注册用户；与上方访问统计不是同一批样本。
                                    </p>
                                    <Funnel
                                        steps={[
                                            {
                                                label: "注册用户",
                                                count: data.cohort.registered,
                                            },
                                            {
                                                label: "7 天内创建套餐订单",
                                                count: data.cohort.ordered,
                                            },
                                            {
                                                label: "该订单在 7 天内确认支付",
                                                count: data.cohort.paid,
                                            },
                                            {
                                                label: "上述已支付订单现已完成",
                                                count: data.cohort.completed,
                                            },
                                        ]}
                                    />
                                    <p className="muted">
                                        按用户去重，包含网站与客户端注册，排除管理员；不受访问设备筛选影响。订单和支付时间取自后台，含余额支付及零元订单，不含充值、流量重置。“已完成”反映当前状态，可能晚于观察窗。
                                    </p>
                                </Panel>
                            )}
                            {tab === "overview" && (
                                <Panel padded title="访问来源网站">
                                    <p className="muted">
                                        仅统计同意采集的访问来源，沿用时间与设备筛选，不关联账号。
                                    </p>
                                    {!data.sourcesReady ? (
                                        <p role="status">
                                            来源统计字段尚未安装，请通过更新流程执行数据库迁移。
                                        </p>
                                    ) : !data.sources?.length ? (
                                        <p className="muted">
                                            暂无来源数据，历史访问不补采。
                                        </p>
                                    ) : (
                                        <>
                                            <TableViewport>
                                                <table>
                                                    <thead>
                                                        <tr>
                                                            <th>来源网站</th>
                                                            <th>访问会话</th>
                                                            <th>占全部会话</th>
                                                            <th>浏览套餐</th>
                                                            <th>确认订单</th>
                                                            <th>进入付款</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {data.sources.map(
                                                            (row, index) => (
                                                                <tr key={index}>
                                                                    <td>
                                                                        {row.kind ===
                                                                        "historical"
                                                                            ? "历史数据／未采集"
                                                                            : row.domain ||
                                                                              "直接访问／来源未知"}
                                                                    </td>
                                                                    <td>
                                                                        {formatNumber(row.sessions, { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                    <td>
                                                                        {percent(
                                                                            row.sessions,
                                                                            data.sessions,
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {formatNumber(row.plans, { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                    <td>
                                                                        {formatNumber(row.confirmations, { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                    <td>
                                                                        {formatNumber(row.payments, { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                </tr>
                                                            ),
                                                        )}
                                                    </tbody>
                                                </table>
                                            </TableViewport>
                                            <p className="muted">
                                                按会话数展示前 50 项，共{" "}
                                                {data.sourceGroups || 0}{" "}
                                                项。购买步骤按浏览套餐 →
                                                确认订单 →
                                                进入付款顺序统计，进入付款不代表付款成功。
                                            </p>
                                        </>
                                    )}
                                    <p className="muted">
                                        只保存来源域名，每次访问固定首次记录的来源，站内跳转不覆盖。直接打开、复制链接、App
                                        内打开或浏览器隐藏来源时，可能无法识别来源网站；“来源未知”不等同于主动输入网址。
                                    </p>
                                </Panel>
                            )}
                        </>
                    )}
                </div>
            </AdminTabs>
        </div>
    );
}
