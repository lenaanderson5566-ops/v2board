import { useRef, useState } from "react";
import { admin, bytes, request, type Row } from "../shared/api";
import { Modal, Panel, State, Table, useData } from "../shared/ui";
import { adminInstant } from "./admin-log-time";

const fields = [
    ["sample_percent", "请求采样比例（%）", 0, 100],
    ["slow_request_ms", "慢请求阈值（毫秒）", 100, 60000],
    ["slow_query_ms", "慢查询阈值（毫秒）", 10, 10000],
    ["error_percent", "5xx 告警比例（%）", 1, 100],
    ["slow_percent", "慢请求告警比例（%）", 1, 100],
    ["min_samples", "触发请求告警的最少样本", 5, 10000],
    ["queue_length", "等待任务告警数量", 1, 1000000],
    ["queue_wait_seconds", "队列等待告警时长（秒）", 1, 86400],
    ["failed_jobs", "近期失败任务告警数量", 1, 100000],
] as const;
const ms = (value: unknown) =>
    value == null ? "—" : `${Number(value).toFixed(1)} ms`;
const states: Record<string, string> = {
    pending: "待确认",
    firing: "需处理",
    resolved: "已恢复",
};
export function AdminObservability() {
    const data = useData<Row>(admin("system/observability"));
    const [edit, setEdit] = useState<Row | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    const pending = useRef(false);
    const report = data.data,
        metrics = report?.metrics,
        snapshot = report?.snapshot;
    async function save() {
        if (pending.current || !edit) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await request(admin("system/observability/settings"), edit);
            setEdit(null);
            setNotice("监控设置已保存，请求样本按新设置重新累计。");
            data.reload();
        } catch (cause) {
            setError((cause as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <Panel
            title="性能与告警"
            actions={
                <div className="actions">
                    <button disabled={data.loading} onClick={data.reload}>
                        刷新监控
                    </button>
                    <button
                        disabled={!report?.settings}
                        onClick={() => {
                            setEdit({ ...report?.settings });
                            setError("");
                        }}
                    >
                        监控设置
                    </button>
                </div>
            }
        >
            <State {...data} retry={data.reload}>
                {notice && (
                    <p role="status" className="pad">
                        {notice}
                    </p>
                )}
                {metrics && (
                    <div className="pad">
                        {report?.stale && (
                            <p className="alert" role="alert">
                                {snapshot
                                    ? "监控结果已超过 3 分钟未更新，请检查定时任务。"
                                    : "等待监控任务首次运行；若超过一分钟仍无结果，请检查定时任务。"}
                            </p>
                        )}
                        <p className="muted">
                            最近 15 分钟 · 采样{" "}
                            {report?.settings.sample_percent}% · 保留约 1
                            小时。以下为样本统计，非总访问量。采样为 0
                            时仅停止请求采集。
                        </p>
                        <div className="health-check-grid">
                            {[
                                ["请求样本", metrics.total.samples],
                                ["平均耗时", ms(metrics.total.averageMs)],
                                ["P95 桶上界", ms(metrics.total.p95UpperMs)],
                                ["5xx 样本", metrics.total.errors],
                                ["慢请求样本", metrics.total.slowRequests],
                                ["慢查询次数", metrics.total.slowQueries],
                            ].map(([label, value]) => (
                                <article className="health-check" key={label}>
                                    <strong>{label}</strong>
                                    <span>{value}</span>
                                </article>
                            ))}
                        </div>
                        {metrics.dropped > 0 && (
                            <p className="muted">
                                繁忙时跳过 {metrics.dropped}{" "}
                                个样本，指标仅反映成功采集的数据。
                            </p>
                        )}
                        <h3>后台告警</h3>
                        <p className="muted">
                            仅后台显示；每分钟检查，连续两次异常触发、连续两次正常恢复。已恢复记录保留
                            24 小时。
                        </p>
                        {!(report?.alerts || []).length && (
                            <p>
                                {snapshot && !report?.stale
                                    ? "暂无告警"
                                    : "监控结果尚不可用"}
                            </p>
                        )}
                        {(report?.alerts || []).map((alert: Row) => (
                            <article
                                className={`health-check ${alert.state === "firing" ? "error" : alert.state === "pending" ? "warning" : "healthy"}`}
                                key={alert.key}
                            >
                                <strong>
                                    {alert.label} ·{" "}
                                    {states[alert.state] || alert.state}
                                </strong>
                                <p>{alert.message}</p>
                                {String(alert.key).startsWith("nodes:") && (
                                    <p>
                                        <a href="#/nodes">查看节点</a>
                                    </p>
                                )}
                                <small>
                                    首次发现：{adminInstant(alert.firstSeenAt)}
                                    {alert.resolvedAt
                                        ? ` · 恢复：${adminInstant(alert.resolvedAt)}`
                                        : ""}
                                </small>
                            </article>
                        ))}
                        <h3>系统与队列</h3>
                        {snapshot && (
                            <>
                                <p className="muted">
                                    检查时间：{adminInstant(snapshot.checkedAt)}
                                </p>
                                <div className="health-check-grid">
                                    {(snapshot.health?.checks || []).map(
                                        (check: Row) => (
                                            <article
                                                key={check.key}
                                                className={`health-check ${check.status}`}
                                            >
                                                <strong>{check.label}</strong>
                                                <p>{check.message}</p>
                                                {check.pendingCount > 0 && (
                                                    <small>
                                                        未执行迁移：
                                                        {check.pendingCount} 项
                                                    </small>
                                                )}
                                            </article>
                                        ),
                                    )}
                                </div>
                                <p>
                                    近期失败任务：
                                    {snapshot.queue?.failedJobs ?? "未知"}
                                </p>
                                {snapshot.queue?.available ? (
                                    <Table
                                        data={snapshot.queue.items}
                                        columns={[
                                            ["name", "队列"],
                                            ["length", "等待任务"],
                                            ["wait", "等待秒数"],
                                            ["processes", "进程数"],
                                        ]}
                                    />
                                ) : (
                                    <p role="alert">队列数据暂不可用</p>
                                )}
                            </>
                        )}
                        <h3>接口耗时与慢查询</h3>
                        <p className="muted">
                            服务端耗时不含网络传输；P95
                            为分桶估计。慢查询仅记录次数与耗时，不保存 SQL
                            或参数；展示慢请求最多的 50 个接口。
                        </p>
                        <Table
                            data={metrics.routes}
                            columns={[
                                ["route", "接口"],
                                ["samples", "样本"],
                                ["errors", "5xx"],
                                [
                                    "averageMs",
                                    "平均耗时",
                                    (r) => ms(r.averageMs),
                                ],
                                [
                                    "p95UpperMs",
                                    "P95 上界",
                                    (r) => ms(r.p95UpperMs),
                                ],
                                ["slowQueries", "慢查询"],
                                [
                                    "maxQueryMs",
                                    "最慢查询",
                                    (r) => ms(r.maxQueryMs),
                                ],
                            ]}
                        />
                        <a href="#/system-log">查看系统日志</a>
                        <h3>前端资源体积</h3>
                        {report?.assets ? (
                            <>
                                <p className="muted">
                                    当前部署资源体积；gzip
                                    为构建估算，首屏不含按需加载页面。
                                </p>
                                {(report.assets.warnings || []).map(
                                    (warning: string) => (
                                        <p className="alert" key={warning}>
                                            {warning}
                                        </p>
                                    ),
                                )}
                                <Table
                                    data={report.assets.modes}
                                    columns={[
                                        [
                                            "mode",
                                            "前端",
                                            (r) =>
                                                r.mode === "user"
                                                    ? "用户端"
                                                    : "管理端",
                                        ],
                                        [
                                            "startupGzipBytes",
                                            "启动外壳 gzip",
                                            (r) => bytes(r.startupGzipBytes),
                                        ],
                                        [
                                            "totalBytes",
                                            "全部资源",
                                            (r) => bytes(r.totalBytes),
                                        ],
                                        ["fileCount", "文件数"],
                                    ]}
                                />
                            </>
                        ) : (
                            <p>
                                尚无构建体积报告，请使用当前构建流程生成发布资源。
                            </p>
                        )}
                    </div>
                )}
            </State>
            {edit && (
                <Modal
                    title="监控设置"
                    variant="drawer"
                    close={() => {
                        if (!pending.current) setEdit(null);
                    }}
                >
                    <form
                        className="pad"
                        onSubmit={(e) => {
                            e.preventDefault();
                            save();
                        }}
                    >
                        <p className="muted">
                            调整采样或阈值后重新累计请求样本，不采集 SQL
                            文本、请求参数或用户身份。
                        </p>
                        {fields.map(([key, label, min, max]) => (
                            <label key={key}>
                                {label}
                                <input
                                    aria-label={label}
                                    type="number"
                                    min={min}
                                    max={max}
                                    step={1}
                                    required
                                    disabled={busy}
                                    value={edit[key]}
                                    onChange={(e) =>
                                        setEdit({
                                            ...edit,
                                            [key]: Number(e.target.value),
                                        })
                                    }
                                />
                            </label>
                        ))}
                        {error && <p role="alert">{error}</p>}
                        <div className="actions">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setEdit(null)}
                            >
                                取消
                            </button>
                            <button disabled={busy}>
                                {busy ? "保存中…" : "保存"}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </Panel>
    );
}
