import { useState } from "react";
import { admin, query } from "../shared/api";
import { formatNumber, formatPercent } from "../shared/number-format";
import { Panel, Reload, State, useData } from "../shared/ui";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import { AdminTabs } from "./AdminChoices";
import { DashboardFirstPurchase, type DashboardFirstPurchaseData } from "./FirstPurchaseReport";
import { ExperienceAnalytics } from "./ExperienceAnalytics";
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
    visitedSessions?: number | null;
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
    const availableDays = data.daily.filter((day) => day.available);
    const max = Math.max(0, ...availableDays.map((day) => day.sessions));
    const peak = availableDays.find((day) => day.sessions === max && max > 0);
    const previous = data.previous;
    const comparable = previous && previous.sessions > 0;
    const coverage = data.sourceCoverage;
    return <>
        <Panel padded title="访问会话与趋势">
            <div className="analytics-metrics">
                <div>
                    <span>本期已采集会话</span><strong>{count(data.sessions)}</strong>
                    <small>同一访客 30 分钟无操作后重新计数。</small>
                </div>
                <div>
                    <span>较上期同期</span>
                    <strong>{comparable ? (data.sessions > previous.sessions ? "+" : "") + formatPercent((data.sessions - previous.sessions) / previous.sessions, { fraction: true }) : "—"}</strong>
                    <small>{comparable ? <>上期 {count(previous.sessions)} 个会话（{instant(previous.from, data.timeZone)} — {instant(previous.to, data.timeZone)}）</>
                        : previous ? "上期同期未收到会话上报。"
                        : "当前没有可对照的上期采集数据。"}</small>
                </div>
                <div>
                    <span>查询窗口内日期</span><strong>{count(availableDays.length)} / {count(data.daily.length)} 天</strong>
                    <small>从 {instant(data.effectiveFrom, data.timeZone)} 起，首尾日期可能不完整。</small>
                </div>
            </div>
            {data.daily.length > 0 && <figure className="analytics-trend">
                <div className="analytics-trend-bars" role="img" aria-label="每日访问会话趋势，详细数值可展开查看">
                    {data.daily.map((day) => (
                        <div key={day.date} data-available={day.available} title={`${day.date}：${day.available ? count(day.sessions) + " 会话" : "超出采集窗口"}`}>
                            {day.available && day.sessions > 0 && <span style={{ height: `${day.sessions / (max || 1) * 100}%` }} />}
                        </div>
                    ))}
                </div>
                <div className="analytics-trend-dates" aria-hidden="true">
                    <span>{data.daily[0].date}</span>
                    {data.daily.length > 2 && <span>{data.daily[Math.floor(data.daily.length / 2)].date}</span>}
                    {data.daily.length > 1 && <span>{data.daily[data.daily.length - 1].date}</span>}
                </div>
                {(peak || availableDays.length < data.daily.length) && <figcaption>
                    {peak && <span>单日最高会话 {count(peak.sessions)} · {peak.date}</span>}
                    {availableDays.length < data.daily.length && <span>斜纹日期超出采集窗口。</span>}
                </figcaption>}
            </figure>}
            <details>
                <summary>每日会话明细</summary>
                <ReportTable pageSize={10} headers={["日期", "已采集会话"]} rows={data.daily.slice().reverse().map((day) => [
                    day.date, day.available ? count(day.sessions) : "超出采集窗口",
                ])} />
            </details>
            <p className="muted">用户登录后可在账户偏好中同意匿名统计。样本来自已选择参与且成功上报的浏览器，按会话开始日统计；0 表示当天未收到上报。</p>
        </Panel>
        <Panel padded title="来源网站与购买意向">
            {!coverage ? <p role="status">来源字段尚未可用，请通过更新流程执行数据库迁移。</p> : <>
                <p>已识别来源 <strong>{count(coverage.known)} / {count(data.sessions)}</strong> 个会话（{ratio(coverage.known, data.sessions)}）。来源未知 {count(coverage.unknown)} 个，历史未采集 {count(coverage.historical)} 个。</p>
                <ReportTable pageSize={10} headers={["来源网站", "采集会话", "到达付款页的会话", "到达率"]} rows={data.sources.map((source) => [
                    source.domain, count(source.sessions), count(source.paymentEntries), ratio(source.paymentEntries, source.sessions),
                ])} />
                <details className="analytics-definition">
                    <summary>来源和到达率如何统计</summary>
                    <p>按会话数列出前 50 个已识别来源。直接访问、复制链接和浏览器隐藏来源都可能归为未知。到达率是该来源的会话中，依次浏览套餐、确认订单并进入付款页的比例。</p>
                </details>
            </>}
        </Panel>
    </>;
}

function PurchasePath({ data }: { data: ConversionReport }) {
    const allVisits = data.visitedSessions;
    const steps = data.funnel.map((step) => ({ label: labels[step.step] || step.step, sessions: step.sessions }));
    if (allVisits != null) steps.unshift({ label: "全部采集会话", sessions: allVisits });
    const payment = data.funnel.find((step) => step.step === "payment");
    return <Panel padded title="站内购买路径 · 同一访问会话">
        {!data.ready ? <p role="status">访问采集表尚未就绪，暂时无法计算购买路径。</p>
            : !data.funnel.length || !steps[0]?.sessions ? <p role="status">{allVisits == null ? "当前没有可计算购买路径的套餐浏览会话。" : "当前范围未收到访问会话，暂无可计算的到达率。"}</p>
            : <>
                {allVisits != null && payment && <p className="analytics-path-summary">
                    <span>付款页到达率</span><strong>{ratio(payment.sessions, allVisits)}</strong>
                    <span>{count(payment.sessions)} / {count(allVisits)} 个采集会话到达付款页</span>
                </p>}
                <ReportTable headers={["步骤", "起点会话", "到达会话", "本步到达率", "未到达会话"]} rows={steps.slice(1).map((step, index) => {
                    const previous = steps[index];
                    return [`${previous.label} → ${step.label}`, count(previous.sessions), count(step.sessions),
                        ratio(step.sessions, previous.sessions), count(previous.sessions - step.sessions)];
                })} />
            </>}
        <p className="muted">仅统计同一会话内依次到达的页面。余额足额或零元开通可能跳过付款页，跨会话续付也可能缺失。进入付款页只代表到达，实际付款以订单记录为准。</p>
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
            <section className="panel analytics-report-filters" aria-label="报表筛选">
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
                    <a className="button" href="#/log-settings?tab=analytics">管理统计采集</a>
                    {tab !== "experience" && <Reload loading={report.loading} onClick={report.reload} />}
                </div>
                {tab === "conversion" && <p className="muted">设备筛选应用于站内购买路径，业务订单统计涵盖全部设备。</p>}
                {data && <>
                    <p className="muted">访问统计 {instant(data.from, data.timeZone)} — {instant(data.to, data.timeZone)} · 业务时区 {data.timeZone} · 最多缓存 60 秒</p>
                    {!data.ready
                        ? <p className="alert">访问统计表尚未安装，请通过更新流程执行数据库迁移。业务购买仍可查看。</p>
                        : !data.settings.enabled && <p className="muted">访问采集已关闭，仅展示保留期内已有的历史样本。</p>}
                </>}
            </section>
            <AdminTabs label="访问与转化报表分类" value={tab} onChange={setTab} options={[
                { value: "overview", label: "访问概览" },
                { value: "conversion", label: "购买转化" },
                { value: "experience", label: "体验问题" },
            ]}>
                <div className="analytics-page">
                    {tab === "experience" ? <ExperienceAnalytics days={days} device={device} /> : (
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
