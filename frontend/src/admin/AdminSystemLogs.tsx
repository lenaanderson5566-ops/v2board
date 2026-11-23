import { AdminPager } from "./AdminPager";
import { formatDuration } from "../shared/number-format";
import { StatusBadge, type StatusTone } from "../shared/StatusBadge";
import { AdminLogTimestamp, AdminLogTimeZone, logTime } from "./admin-log-time";
import { TableViewport } from "../shared/ui";
import { AdminFilterBar } from "./AdminFilterBar";
import { useAdminLogDateRange } from "./use-admin-log-date-range";

import { useState } from "react";
import { admin, type Row } from "../shared/api";
import { Panel, Reload, State, useData } from "../shared/ui";
const time = logTime;
const levelTones: Record<string, StatusTone> = {
    WARNING: "warning", ERROR: "danger", CRITICAL: "danger", ALERT: "danger", EMERGENCY: "danger",
};
const requestIdFormat = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const levels = [
    "DEBUG",
    "INFO",
    "NOTICE",
    "WARNING",
    "ERROR",
    "CRITICAL",
    "ALERT",
    "EMERGENCY",
];
const emptyDraft = {
    level: "",
    status: "",
    request_id: "",
};
type Filters = typeof emptyDraft & { from: number | null; to: number | null };
const empty: Filters = { ...emptyDraft, from: null, to: null };
function recent(): Filters {
    const requestId = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    ).get("request_id");
    if (requestId && requestIdFormat.test(requestId))
        return { ...empty, request_id: requestId };
    return { ...empty, from: Math.floor(Date.now() / 1000) - 86400 };
}
export function AdminSystemLogs() {
    const [pageSize, setPageSize] = useState(20);
    const [filters, setFilters] = useState<Filters>(recent);
    const dates = useAdminLogDateRange(filters);
    const [draft, setDraft] = useState(() => ({ ...emptyDraft, request_id: filters.request_id }));
    const [page, setPage] = useState(1), [error, setError] = useState("");
    const query = new URLSearchParams({
        current: String(page),
        page_size: String(pageSize),
    });
    for (const [key, value] of Object.entries(filters))
        if (value !== "" && value !== null) query.set(key, String(value));
    const logs = useData<Row[]>(admin(`system/getSystemLog?${query}`));
    return (
        <>
            <Panel
                title="系统日志"
                actions={
                    <Reload onClick={logs.reload} loading={logs.loading} />
                }
            >
                <AdminLogTimeZone logFilters />
                <AdminFilterBar
                    className="admin-log-filters"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const requestId = draft.request_id.trim();
                        if (requestId && !requestIdFormat.test(requestId)) {
                            setError("请求 ID 需要完整的 UUID，可从订单支付诊断中复制。");
                            e.currentTarget.querySelector<HTMLInputElement>('[name="request_id"]')?.focus();
                            return;
                        }
                        try {
                            const from = dates.instant("from");
                            const to = dates.instant("to");
                            if (from != null && to != null && from > to)
                                throw new Error("结束时间不能早于开始时间");
                            setError("");
                            setPage(1);
                            setFilters({ ...draft, from, to, request_id: requestId });
                        } catch (e) {
                            setError((e as Error).message);
                        }
                    }}
                >
                    <label>
                        开始时间
                        <input
                            aria-label="日志开始时间"
                            type="datetime-local"
                            step={1}
                            value={dates.value("from")}
                            onChange={(e) => dates.change("from", e.target.value)}
                        />
                    </label>
                    <label>
                        结束时间
                        <input
                            aria-label="日志结束时间"
                            type="datetime-local"
                            step={1}
                            value={dates.value("to")}
                            onChange={(e) => dates.change("to", e.target.value)}
                        />
                    </label>
                    <label>
                        级别
                        <select
                            aria-label="日志级别"
                            value={draft.level}
                            onChange={(e) =>
                                setDraft({ ...draft, level: e.target.value })
                            }
                        >
                            <option value="">全部</option>
                            {levels.map((l) => (
                                <option key={l}>{l}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        HTTP 状态码
                        <input
                            aria-label="日志状态码"
                            type="number"
                            min={100}
                            max={599}
                            value={draft.status}
                            onChange={(e) =>
                                setDraft({ ...draft, status: e.target.value })
                            }
                        />
                    </label>
                    <label>
                        请求 ID
                        <input
                            aria-label="日志请求 ID"
                            name="request_id"
                            value={draft.request_id}
                            placeholder="完整 UUID"
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    request_id: e.target.value,
                                })
                            }
                        />
                    </label>
                    <div className="admin-filter-actions">
                        <button type="submit" className="primary">查询</button>
                        <button
                            type="button"
                            onClick={() => {
                                setDraft(emptyDraft);
                                dates.reset();
                                setFilters(empty);
                                setPage(1);
                                setError("");
                            }}
                        >
                            清除筛选
                        </button>
                    </div>
                    {error && <p className="alert admin-filter-error" role="alert">{error}</p>}
                </AdminFilterBar>
                <div className="admin-system-log-summary">
                    <span>{filters.from != null || filters.to != null
                        ? `${filters.from == null ? "不限开始时间" : time(filters.from)} 至 ${filters.to == null ? "现在" : time(filters.to)}`
                        : "全部时间"}</span>
                    {!logs.loading && !logs.error && logs.data && <strong>匹配 {logs.total} 条日志</strong>}
                    <details><summary>历史日志说明</summary>历史日志的检索字段由清理任务分批补齐，仅展示已保留的诊断信息。</details>
                </div>
                <State {...logs} retry={logs.reload}>
                    {logs.data?.length ? <TableViewport>
                        <table>
                            <thead>
                                <tr>
                                    <th>时间</th>
                                    <th>级别 / 事件</th>
                                    <th>方法 / 路由</th>
                                    <th>状态 / 耗时</th>
                                    <th>请求 ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.data?.map((r) => (
                                    <tr key={r.id}>
                                        <td><AdminLogTimestamp value={r.created_at} /></td>
                                        <td>
                                            <StatusBadge tone={levelTones[r.level] || "neutral"}>{r.level || "—"}</StatusBadge>
                                            <br />
                                            {r.title}
                                        </td>
                                        <td>
                                            {r.method}
                                            <br />
                                            {r.uri}
                                        </td>
                                        <td>
                                            {r.http_status ?? "—"} ·{" "}
                                            {r.duration_ms == null ? "—" : formatDuration(r.duration_ms)}
                                        </td>
                                        <td>
                                            <span className="admin-ua-text">
                                                {r.request_id || "—"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableViewport> : !logs.loading && !logs.error && (
                        <p className="admin-log-empty" role="status">暂无匹配日志</p>
                    )}
                </State>
                {(logs.total > 0 || page > 1) && <AdminPager
                    page={page}
                    totalUnavailable={logs.data == null || Boolean(logs.error)}
                    total={logs.total}
                    size={pageSize}
                    loading={logs.loading}
                    onChange={setPage}
                    onSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                />}
            </Panel>
        </>
    );
}
