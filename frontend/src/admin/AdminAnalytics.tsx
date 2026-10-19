import { JourneyAnalytics } from "./JourneyAnalytics";
import { analyticsLabels as labels } from "./analytics-labels";
import { useState } from "react";
import { BarChart3, ShieldCheck } from "lucide-react";
import { admin, query, request } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { formatInstant } from "../shared/timezone";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import "./analytics.css";
import { OperationsAnalytics } from "./OperationsAnalytics";

type Report = {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
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
    total ? `${((part / total) * 100).toFixed(1)}%` : "—";
function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
    return (
        <ol className="analytics-funnel">
            {steps.map((step, index) => (
                <li key={step.label}>
                    <div>
                        <span>
                            {index + 1}. {step.label}
                        </span>
                        <strong>{step.count.toLocaleString()}</strong>
                    </div>
                    <progress
                        max={Math.max(steps[0].count, 1)}
                        value={step.count}
                        aria-label={`${step.label} ${step.count}`}
                    />
                    <small>
                        {index === 0
                            ? "起始样本"
                            : `上一步转化 ${percent(step.count, steps[index - 1].count)} · 流失 ${Math.max(0, steps[index - 1].count - step.count).toLocaleString()}`}
                    </small>
                </li>
            ))}
        </ol>
    );
}
function CollectionSettings({
    settings,
    ready,
    saved,
}: {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
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
    saved: () => void;
}) {
    const [enabled, setEnabled] = useState(settings.enabled);
    const [retentionDays, setRetention] = useState<number>(
        settings.retentionDays,
    );
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    return (
        <form
            onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setMessage("");
                try {
                    await request(admin("analytics/settings"), {
                        enabled,
                        retentionDays,
                    });
                    setMessage(
                        "统计设置已保存。已打开的用户页面将在重新加载后取得新设置；关闭后服务端立即停止入库。",
                    );
                    saved();
                } catch (error) {
                    setMessage(
                        error instanceof Error ? error.message : "保存失败",
                    );
                } finally {
                    setBusy(false);
                }
            }}
            className="analytics-settings"
        >
            <label>
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    disabled={!ready || busy}
                />{" "}
                开启访问统计
            </label>
            <label>
                保留时间{" "}
                <select
                    value={retentionDays}
                    disabled={!ready || busy}
                    onChange={(event) =>
                        setRetention(Number(event.target.value))
                    }
                >
                    {[7, 30, 90].map((value) => (
                        <option key={value} value={value}>
                            {value} 天
                        </option>
                    ))}
                </select>
            </label>
            <button type="submit" className="primary" disabled={!ready || busy}>
                {busy ? "保存中…" : "保存设置"}
            </button>
            <p className="muted">
                默认关闭。开启后由用户自主允许或拒绝；尊重浏览器禁止追踪设置。仅记录页面标识、设备类别、语言、引导动作、性能数值、错误类别和短期随机会话，不记录
                IP、邮箱、完整
                UA、网址、表单或支付内容。缩短保留期会逐批清理旧统计，无法恢复。
            </p>
            {message && <p role="status">{message}</p>}
        </form>
    );
}
export function AdminAnalytics() {
    const [days, setDays] = useState(30);
    const [device, setDevice] = useState("all");
    const report = useData<Report>(
        query(admin("analytics/report"), { days, device }),
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const data = report.data;
    return (
        <div className="analytics-page">
            <Panel padded title="访问与转化">
                <p className="muted">
                    <BarChart3 size={16} aria-hidden />{" "}
                    了解用户浏览、确认订单和付款之间的流失。页面漏斗与业务结果分别统计，避免混淆点击和实际支付。
                </p>
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
                    <button
                        type="button"
                        onClick={report.reload}
                        disabled={report.loading}
                    >
                        刷新报表
                    </button>
                </div>
                <State loading={report.loading} error={report.error}>
                    {null}
                </State>
                {data && (
                    <>
                        <p className="muted">
                            {formatInstant(data.from)} —{" "}
                            {formatInstant(data.to)} · 按系统时区{" "}
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
                        <div className="analytics-metrics">
                            <div>
                                <span>访问会话</span>
                                <strong>
                                    {data.sessions.toLocaleString()}
                                </strong>
                                <small>
                                    30 分钟无操作后重新计数，非独立人数
                                </small>
                            </div>
                            <div>
                                <span>页面浏览</span>
                                <strong>{data.views.toLocaleString()}</strong>
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
                    </>
                )}
            </Panel>
            <OperationsAnalytics days={days} />
            <JourneyAnalytics days={days} device={device} />
            {data && (
                <>
                    <Panel padded title="数据质量与每日趋势">
                        <p className="muted">
                            首次开启：
                            {data.collectionStartedAt
                                ? formatInstant(data.collectionStartedAt)
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
                                ? `与上一周期同等已过时间相比：${data.previous.sessions ? (((data.sessions - data.previous.sessions) / data.previous.sessions) * 100).toFixed(1) + "%" : "上一周期无会话，暂不计算变化率"}`
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
                                    <small>{day.date.slice(5)}</small>
                                </div>
                            ))}
                        </div>
                        <details>
                            <summary>每日详细数据</summary>
                            <div className="table-wrap">
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
                            </div>
                        </details>
                        <p className="muted">
                            按会话开始日归属浏览次数，今日及窗口边界日可能不完整。未收集时不补造历史数据；趋势空白不代表没有真实访问。
                        </p>
                    </Panel>
                    <Panel padded title="访问时段分布">
                        <p className="muted">
                            按系统时区 {data.timeZone}{" "}
                            的会话开始时间统计，沿用设备筛选与统计保留期；非人数或接口请求量，未采集与缺失数据不代表零访问。
                        </p>
                        <div className="analytics-time-grid">
                            <div>
                                <h3>小时分布</h3>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>小时</th>
                                                <th>会话数</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.hours?.map((count, hour) => (
                                                <tr key={hour}>
                                                    <td>
                                                        {String(hour).padStart(
                                                            2,
                                                            "0",
                                                        )}
                                                        :00–
                                                        {String(
                                                            hour + 1,
                                                        ).padStart(2, "0")}
                                                        :00
                                                    </td>
                                                    <td>{count}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div>
                                <h3>星期分布</h3>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>星期</th>
                                                <th>会话数</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.weekdays?.map(
                                                (count, day) => (
                                                    <tr key={day}>
                                                        <td>
                                                            {
                                                                [
                                                                    "周一",
                                                                    "周二",
                                                                    "周三",
                                                                    "周四",
                                                                    "周五",
                                                                    "周六",
                                                                    "周日",
                                                                ][day]
                                                            }
                                                        </td>
                                                        <td>{count}</td>
                                                    </tr>
                                                ),
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="muted">
                                    各星期在范围内出现次数可能不同，数值为总量。
                                </p>
                            </div>
                        </div>
                    </Panel>
                    <Panel padded title="购买路径 · 同一访问会话">
                        <Funnel
                            steps={data.funnel.map((step) => ({
                                label: labels[step.step],
                                count: step.sessions,
                            }))}
                        />
                        <p className="muted">
                            按顺序统计“浏览套餐 → 确认订单 →
                            进入付款”，每个会话每步最多一次。跨设备、跨会话、直接续付旧订单或未同意统计的用户不进入完整漏斗。此处不代表支付成功。
                        </p>
                        <p className="muted">
                            会话按开始时间归入范围，仅展示尚在{" "}
                            {data.settings.retentionDays}{" "}
                            天保留期内的数据。拒绝统计、网络拦截和漏报会影响结果。
                        </p>
                    </Panel>
                    <Panel padded title="注册后的业务转化 · 7 天观察窗">
                        <p className="muted">
                            注册区间：{formatInstant(data.cohort.from)} 至{" "}
                            {formatInstant(data.cohort.to)}
                            （不含结束时刻）。为避免新用户尚未来得及购买，只统计已满
                            7 天的注册用户；与上方访问统计不是同一批样本。
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
                    <Panel padded title="转化改进工作台">
                        <p className="muted">
                            以同一注册批次的业务数据定位环节，逐次调整并观察完整窗口。差额代表窗口内尚未进入下一步的用户，不直接说明流失原因。
                        </p>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>环节</th>
                                        <th>窗口内待转化</th>
                                        <th>建议检查</th>
                                        <th>配置入口</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>注册 → 下单</td>
                                        <td>
                                            {Math.max(
                                                0,
                                                data.cohort.registered -
                                                    data.cohort.ordered,
                                            )}{" "}
                                            人
                                        </td>
                                        <td>
                                            套餐价值、价格与周期是否清楚；试用或优惠是否适合当前用户。
                                        </td>
                                        <td>
                                            <a href="#/plans">套餐管理</a> ·{" "}
                                            <a href="#/coupons">优惠券</a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>下单 → 付款</td>
                                        <td>
                                            {Math.max(
                                                0,
                                                data.cohort.ordered -
                                                    data.cohort.paid,
                                            )}{" "}
                                            人
                                        </td>
                                        <td>
                                            可用支付方式、币种、金额和失败提示；先排查通道故障再调整促销。
                                        </td>
                                        <td>
                                            <a href="#/payments">支付渠道</a> ·{" "}
                                            <a href="#/orders">订单管理</a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>付款 → 完成</td>
                                        <td>
                                            {Math.max(
                                                0,
                                                data.cohort.paid -
                                                    data.cohort.completed,
                                            )}{" "}
                                            人
                                        </td>
                                        <td>
                                            支付回调、订单处理与开通延迟；引导用户下载适合其平台的客户端。
                                        </td>
                                        <td>
                                            <a href="#/orders">核查订单</a> ·{" "}
                                            <a href="#/client-downloads">
                                                专用客户端下载
                                            </a>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p className="muted">
                            待转化人数可能包含仍在考虑或处理中的用户；不自动向用户发送推广邮件。
                        </p>
                    </Panel>
                    <Panel padded title="访问来源网站">
                        <p className="muted">
                            了解访客从哪个网站进入本站，无需设置推广链接。仅统计同意采集的访问，遵循当前时间与设备筛选，不关联具体账号，也不代表成功登录人数。
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
                                <div className="table-wrap">
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
                                            {data.sources.map((row, index) => (
                                                <tr key={index}>
                                                    <td>
                                                        {row.kind ===
                                                        "historical"
                                                            ? "历史数据／未采集"
                                                            : row.domain ||
                                                              "直接访问／来源未知"}
                                                    </td>
                                                    <td>
                                                        {row.sessions.toLocaleString()}
                                                    </td>
                                                    <td>
                                                        {percent(
                                                            row.sessions,
                                                            data.sessions,
                                                        )}
                                                    </td>
                                                    <td>
                                                        {row.plans.toLocaleString()}
                                                    </td>
                                                    <td>
                                                        {row.confirmations.toLocaleString()}
                                                    </td>
                                                    <td>
                                                        {row.payments.toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="muted">
                                    按会话数展示前 50 项，共{" "}
                                    {data.sourceGroups || 0}{" "}
                                    项。购买步骤按浏览套餐 → 确认订单 →
                                    进入付款顺序统计，进入付款不代表付款成功。
                                </p>
                            </>
                        )}
                        <p className="muted">
                            只保存来源域名，每次访问固定首次记录的来源，站内跳转不覆盖。直接打开、复制链接、App
                            内打开或浏览器隐藏来源时，可能无法识别来源网站；“来源未知”不等同于主动输入网址。
                        </p>
                    </Panel>
                    <Panel padded title="页面表现">
                        {data.pages.length ? (
                            <div className="table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>页面</th>
                                            <th>浏览次数</th>
                                            <th>访问会话</th>
                                            <th>会话覆盖率</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.pages.map((page) => (
                                            <tr key={page.page}>
                                                <td>
                                                    {labels[page.page] ||
                                                        page.page}
                                                </td>
                                                <td>
                                                    {page.views.toLocaleString()}
                                                </td>
                                                <td>
                                                    {page.sessions.toLocaleString()}
                                                </td>
                                                <td>
                                                    {percent(
                                                        page.sessions,
                                                        data.sessions,
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="muted">
                                暂无访问数据。开启收集、用户同意并浏览页面后显示；业务支付数据不会填充此表。
                            </p>
                        )}
                        <p className="muted">
                            {data.devices
                                .map(
                                    (item) =>
                                        `${labels[item.device]} ${item.sessions.toLocaleString()} 会话`,
                                )
                                .join(" · ")}
                        </p>
                    </Panel>
                    <Panel padded title="隐私与保留设置">
                        <p>
                            <ShieldCheck size={16} aria-hidden />{" "}
                            第一方统计，数据存放在本站数据库。
                        </p>
                        <CollectionSettings
                            key={`${data.settings.enabled}-${data.settings.retentionDays}`}
                            settings={data.settings}
                            ready={data.ready}
                            saved={report.reload}
                        />
                    </Panel>
                </>
            )}
        </div>
    );
}
