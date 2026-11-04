import { useState } from "react";
import { admin, query } from "../shared/api";
import { formatNumber, formatPercent } from "../shared/number-format";
import { Panel, State, useData } from "../shared/ui";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import { AdminTabs } from "./AdminChoices";
import { DashboardFirstPurchase, type DashboardFirstPurchaseData } from "./FirstPurchaseReport";
import { JourneyAnalytics } from "./JourneyAnalytics";
import { ReportTable } from "./ReportTable";
import { adminBusinessInstant } from "./admin-log-time";
import { analyticsLabels as labels } from "./analytics-labels";
import "./analytics.css";

type ReportWindow = {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
    timeZone: string;
    from: string;
    to: string;
    effectiveFrom: string;
    collectionStartedAt: string | null;
};

type TrafficReport = ReportWindow & {
    sessions: number;
    previous: { sessions: number; from: string; to: string } | null;
    daily: { date: string; sessions: number; available: boolean }[];
    sourceCoverage: { known: number; unknown: number; historical: number } | null;
    sources: { domain: string; sessions: number; paymentEntries: number }[];
};

type ConversionReport = ReportWindow & {
    funnel: { step: string; sessions: number }[];
    firstPurchase?: DashboardFirstPurchaseData;
};

const count = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });
const ratio = (part: number, total: number) =>
    formatPercent(total ? part / total : null, { fraction: true, bounded: true });
const instant = (value: string, timeZone: string) => adminBusinessInstant(value, {}, timeZone);

function TrafficOverview({ data }: { data: TrafficReport }) {
    if (!data.ready) return null;
    const hasCoverage = data.sessions > 0 || (data.settings.enabled && data.collectionStartedAt !== null);
    if (!hasCoverage) return <Panel padded title="访问会话与趋势"><p role="status">当前范围没有可用的访问采集样本。</p></Panel>;
    const max = Math.max(1, ...data.daily.map((day) => day.sessions));
    const previous = data.previous;
    const coverage = data.sourceCoverage;
    return <>
        <Panel padded title="访问会话与趋势">
            <p>本期已采集会话 <strong>{count(data.sessions)}</strong> · 30 分钟无操作后重新计数，同一访客可能有多次会话。</p>
            <p>{previous?.sessions && data.sessions > 0
                ? <>与上期同期相比 <strong>{formatPercent((data.sessions - previous.sessions) / previous.sessions, { fraction: true })}</strong> · 上期 {count(previous.sessions)} 个会话（{instant(previous.from, data.timeZone)} — {instant(previous.to, data.timeZone)}）</>
                : previous?.sessions
                    ? "本期未收到会话上报，变化率不可算。"
                    : previous
                    ? "上期同期未收到会话上报，变化率不可算。"
                    : "当前没有可对照的上期采集数据，暂不计算变化率。"}
            </p>
            <div className="analytics-trend" role="img" aria-label="每日访问会话趋势，详细数值可展开查看">
                {data.daily.map((day) => (
                    <div key={day.date} title={`${day.date}：${day.available ? count(day.sessions) + " 会话" : "超出采集窗口"}`}>
                        <span style={{ height: `${day.available ? (day.sessions / max) * 100 : 0}%` }} />
                        <small>{day.date.slice(5)}</small>
                    </div>
                ))}
            </div>
            <details>
                <summary>每日会话明细</summary>
                <ReportTable pageSize={10} headers={["日期", "已采集会话"]} rows={data.daily.map((day) => [
                    day.date, day.available ? count(day.sessions) : "超出采集窗口",
                ])} />
            </details>
            <p className="muted">有效窗口起点 {instant(data.effectiveFrom, data.timeZone)}。按会话开始日统计，首尾日期可能不完整。采集期间的 0 表示未收到上报，停采、拒绝和拦截也会造成缺口。</p>
        </Panel>
        <Panel padded title="来源网站与购买意向">
            {!coverage ? <p role="status">来源字段尚未可用，请通过更新流程执行数据库迁移。</p> : <>
                <p>已识别来源 <strong>{count(coverage.known)} / {count(data.sessions)}</strong> 个会话（{ratio(coverage.known, data.sessions)}）。来源未知 {count(coverage.unknown)} 个，历史未采集 {count(coverage.historical)} 个。</p>
                <ReportTable pageSize={10} headers={["来源网站", "采集会话", "到达付款页的会话", "到达率"]} rows={data.sources.map((source) => [
                    source.domain, count(source.sessions), count(source.paymentEntries), ratio(source.paymentEntries, source.sessions),
                ])} />
                <p className="muted">最多展示会话最多的 50 个已识别来源。比较渠道时同时看样本量和到达率；直接打开、复制链接及浏览器隐藏来源均可能归为未知。</p>
                <p className="muted">到达率以该来源的采集会话为分母，到达需在同一会话依次浏览套餐、确认订单和进入付款页。该指标衡量购买意向，实际付款以订单记录为准。</p>
            </>}
        </Panel>
    </>;
}

function PurchasePath({ data }: { data: ConversionReport }) {
    return <Panel padded title="站内购买路径 · 同一访问会话">
        {!data.ready || !data.funnel[0]?.sessions ? <p role="status">当前没有可计算购买路径的套餐浏览会话。</p> : (
            <ol className="analytics-funnel">
                {data.funnel.map((step, index) => (
                    <li key={step.step}>
                        <div><span>{labels[step.step]}</span><strong>{count(step.sessions)}</strong></div>
                        <progress max={data.funnel[0].sessions} value={step.sessions} aria-label={labels[step.step]} />
                        <small>{index === 0 ? "起始样本" :
                            `较上一步 ${ratio(step.sessions, data.funnel[index - 1].sessions)} · 未进入下一步 ${count(data.funnel[index - 1].sessions - step.sessions)}`}</small>
                    </li>
                ))}
            </ol>
        )}
        <p className="muted">找出浏览套餐、确认订单和进入付款页之间的流失。仅统计已采集、按顺序完成且在同一会话内的步骤；跨会话续付可能缺失。进入付款页只代表到达，付款结果以上方业务订单为准。</p>
    </Panel>;
}

export function AdminAnalytics() {
    const [tab, setTab] = useState("overview");
    const [days, setDays] = useState(30);
    const [device, setDevice] = useState("all");
    const view = tab === "overview" ? "traffic" : tab;
    const report = useData<TrafficReport | ConversionReport>(
        view === "experience" ? "" : query(admin("analytics/report"), { days, device, view }),
        undefined, false, { refreshOnEvents: false },
    );
    const data = report.data;
    return (
        <div className="analytics-page">
            <Panel padded title="访问与转化">
                <div className="analytics-settings">
                    <label>统计范围{" "}
                        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                            {[7, 30, 90].map((value) => <option value={value} key={value}>近 {value} 天</option>)}
                        </select>
                    </label>
                    <label>访问设备{" "}
                        <select value={device} onChange={(event) => setDevice(event.target.value)}>
                            <option value="all">全部设备</option>
                            {["desktop", "mobile", "tablet"].map((value) => <option value={value} key={value}>{labels[value]}</option>)}
                        </select>
                    </label>
                </div>
                <p className="muted">设备筛选仅适用于访问、站内购买路径和体验样本。<a href="#/log-settings?tab=analytics">管理统计采集</a></p>
                {data && <>
                    <p className="muted">访问统计 {instant(data.from, data.timeZone)} — {instant(data.to, data.timeZone)} · 业务时区 {data.timeZone} · 最多缓存 60 秒</p>
                    {!data.ready
                        ? <p className="alert">访问统计表尚未安装，请通过更新流程执行数据库迁移。业务购买仍可查看。</p>
                        : !data.settings.enabled && <p className="muted">访问采集已关闭，仅展示保留期内已有的历史样本。</p>}
                </>}
            </Panel>
            <AdminTabs label="访问与转化报表分类" value={tab} onChange={setTab} options={[
                { value: "overview", label: "访问概览" },
                { value: "conversion", label: "购买转化" },
                { value: "experience", label: "体验问题" },
            ]}>
                <div className="analytics-page">
                    {tab === "experience" ? <JourneyAnalytics days={days} device={device} experienceOnly /> : (
                        <State loading={report.loading} error={report.error} retry={report.reload}>
                            {tab === "overview" && data && "daily" in data && <TrafficOverview key={`${days}-${device}`} data={data} />}
                            {tab === "conversion" && data && "funnel" in data && <>
                                <DashboardFirstPurchase firstPurchase={data.firstPurchase} timeZone={data.timeZone} />
                                <PurchasePath data={data} />
                            </>}
                        </State>
                    )}
                </div>
            </AdminTabs>
        </div>
    );
}
