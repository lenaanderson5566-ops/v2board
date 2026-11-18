import { formatDuration, formatNumber, formatPercent } from "../shared/number-format";
import { admin, query } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { businessTimeZone } from "../shared/timezone";
import { adminBusinessInstant } from "./admin-log-time";
import { ReportTable } from "./ReportTable";
import { analyticsLabels } from "./analytics-labels";

export type ExperienceReport = {
    available: boolean;
    enabled?: boolean;
    retentionDays?: number;
    effectiveFrom?: string;
    to?: string;
    timeZone?: string;
    observedSessions?: number;
    affectedSessions?: number;
    rows: {
        page: string;
        event: string;
        samples: number;
        sessions: number;
        p75Upper: number | null;
        p95Upper: number | null;
    }[];
};

const ratio = (value: number) => formatPercent(value, { fraction: true, bounded: true });
const count = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });
const eventNames: Record<string, string> = {
    copy_failed: "复制失败",
    js_error: "脚本异常",
    api_error: "接口错误",
    network_error: "网络错误",
    api_request: "接口耗时",
    lcp: "LCP",
    inp: "INP",
    cls: "CLS",
};
const performanceEvents = ["api_request", "lcp", "inp", "cls"];
const issueEvents = ["api_error", "network_error", "js_error", "copy_failed"];

function ExperienceDetails({ data }: { data: ExperienceReport }) {
    if (!data.available) return <p className="alert">体验统计表尚未安装，请通过更新流程执行数据库迁移。</p>;
    const issues = data.rows.filter((row) => issueEvents.includes(row.event)).sort((a, b) => b.sessions - a.sessions);
    const metrics = data.rows.filter((row) => performanceEvents.includes(row.event)).sort((a, b) =>
        performanceEvents.indexOf(a.event) - performanceEvents.indexOf(b.event) ||
        (b.p75Upper ?? -1) - (a.p75Upper ?? -1) || b.samples - a.samples,
    );
    const zone = data.timeZone ?? businessTimeZone();
    const { observedSessions, affectedSessions } = data;
    return <>
        {!data.enabled && <p className="muted">匿名统计已关闭，仅展示保留期内已有的历史样本。</p>}
        {data.effectiveFrom && <p className="muted">查询范围 {adminBusinessInstant(data.effectiveFrom, {}, zone)}
            {data.to && <> 至 {adminBusinessInstant(data.to, {}, zone)}</>} · 业务时区 {zone} · 按会话开始时间统计</p>}
        {observedSessions === 0 ? <p role="status">当前范围没有已采集会话，无法计算异常占比。</p> : <>
            <h3>异常影响范围</h3>
            {observedSessions !== undefined && affectedSessions !== undefined &&
                <p><strong>{count(affectedSessions)} / {count(observedSessions)}</strong> 个已采集会话上报过异常（{ratio(affectedSessions / observedSessions)}）。同一会话在此只计一次。</p>}
            {issues.length === 0 ? <p role="status">当前范围未收到这些异常的上报。</p> : <ReportTable pageSize={10}
                headers={["页面", "异常", "受影响会话"]} rows={issues.map((row) => [
                    analyticsLabels[row.page] || row.page, eventNames[row.event], count(row.sessions),
                ])} />}
            {issues.length > 0 && <p className="muted">按受影响会话数排序。同一会话可能出现在多个页面或异常类别。</p>}
            <h3>页面性能瓶颈</h3>
            {metrics.length === 0 ? <p role="status">当前范围没有可用的性能样本。</p> : <ReportTable pageSize={10}
                headers={["归属页面", "指标", "样本数", "P75 桶上界", "P95 桶上界"]} rows={metrics.map((row) => {
                    const value = (v: number | null) => v === null ? "—" : row.event === "cls" ? formatNumber(v / 1000, { maximumFractionDigits: 3 }) : formatDuration(v);
                    return [analyticsLabels[row.page] || row.page, eventNames[row.event], count(row.samples), value(row.p75Upper), value(row.p95Upper)];
                })} />}
            {metrics.length > 0 && <p className="muted">P75 和 P95 为固定桶的上界估计。LCP、INP 和 CLS 归属开始监测时的入口页面。</p>}
        </>}
        <p className="muted">仅统计同意采集且成功上报的会话，不能代表全部访客。付费转化以订单记录为准。保留 {data.retentionDays} 天，报表最多缓存 60 秒。</p>
    </>;
}
export function ExperienceAnalytics({ days, device }: { days: number; device: string }) {
    const report = useData<{ experience: ExperienceReport }>(
        query(admin("analytics/journey"), { days, device, view: "experience" }),
        undefined, false, { refreshOnEvents: false },
    );
    const data = report.data?.experience;
    return <Panel padded title="体验问题" actions={
        <button type="button" onClick={report.reload} disabled={report.loading}>刷新体验报表</button>
    }>
        <State loading={report.loading} error={report.error} retry={report.reload} retryAt={report.retryAt} data={data}>
            {data && <ExperienceDetails key={`${days}-${device}`} data={data} />}
        </State>
    </Panel>;
}
