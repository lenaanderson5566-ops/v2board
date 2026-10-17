import { useState } from "react";
import { BarChart3, ShieldCheck } from "lucide-react";
import { admin, query, request } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { formatInstant } from "../shared/timezone";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import "./analytics.css";

type Report = {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
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
const labels: Record<string, string> = {
    landing: "首页",
    register: "注册",
    login: "登录",
    forget: "找回密码",
    dashboard: "用户概览",
    plan: "浏览套餐",
    confirmation: "确认订单",
    payment: "进入付款",
    order: "订单列表",
    order_detail: "订单详情",
    activities: "活动中心",
    coupons: "我的优惠券",
    subscribe: "配置中心",
    knowledge: "帮助中心",
    profile: "账户设置",
    security: "安全中心",
    invite: "邀请好友",
    traffic: "使用情况",
    notifications: "通知设置",
    ticket: "工单",
    desktop: "电脑",
    mobile: "手机",
    tablet: "平板",
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
                默认关闭。开启后由用户自主允许或拒绝；尊重浏览器禁止追踪设置。仅记录页面标识、设备类别、语言和短期随机会话，不记录
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
            <Panel title="访问与转化">
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
            {data && (
                <>
                    <Panel title="数据质量与每日趋势">
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
                    <Panel title="购买路径 · 同一访问会话">
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
                    <Panel title="注册后的业务转化 · 7 天观察窗">
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
                    <Panel title="页面表现">
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
                    <Panel title="隐私与保留设置">
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
