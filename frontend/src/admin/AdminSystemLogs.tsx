import { TableViewport } from "../shared/ui";
import { AdminFilterBar } from "./AdminFilterBar";
import { Pager } from "../shared/ui";
import {
    formatInstant,
    dateTimeInput,
    parseDateTimeInput,
    displayTimeZone,
} from "../shared/timezone";
import { useState } from "react";
import { admin, type Row } from "../shared/api";
import { Panel, Reload, State, useData } from "../shared/ui";
const time = (value: number) => (value ? formatInstant(value) : "—");
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
type Filters = {
    level: string;
    status: string;
    request_id: string;
    from: string;
    to: string;
};
const empty: Filters = {
    level: "",
    status: "",
    request_id: "",
    from: "",
    to: "",
};
function recent(): Filters {
    const requestId = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    ).get("request_id");
    if (requestId && /^[0-9a-f-]{36}$/i.test(requestId))
        return { ...empty, request_id: requestId };
    const from = dateTimeInput((Date.now() - 86400000) / 1000);
    try {
        parseDateTimeInput(from);
        return { ...empty, from };
    } catch {
        return { ...empty };
    }
}
export function AdminSystemLogs() {
    const [pageSize, setPageSize] = useState(20);
    const [draft, setDraft] = useState<Filters>(recent),
        [filters, setFilters] = useState<Filters>(recent),
        [page, setPage] = useState(1),
        [error, setError] = useState("");
    const query = new URLSearchParams({
        current: String(page),
        page_size: String(pageSize),
    });
    for (const [key, value] of Object.entries(filters))
        if (value)
            query.set(
                key,
                key === "from" || key === "to"
                    ? String(parseDateTimeInput(value))
                    : value,
            );
    const logs = useData<Row[]>(admin(`system/getSystemLog?${query}`));
    return (
        <>
            <Panel
                title="系统日志"
                actions={
                    <Reload onClick={logs.reload} loading={logs.loading} />
                }
            >
                <AdminFilterBar
                    className="admin-log-filters"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (draft.from && draft.to && draft.from > draft.to) {
                            setError("结束时间不能早于开始时间");
                            return;
                        }
                        try {
                            if (draft.from) parseDateTimeInput(draft.from);
                            if (draft.to) parseDateTimeInput(draft.to);
                        } catch (e) {
                            setError((e as Error).message);
                            return;
                        }
                        setError("");
                        setPage(1);
                        setFilters({
                            ...draft,
                            request_id: draft.request_id.trim(),
                        });
                    }}
                >
                    <label>
                        开始时间（{displayTimeZone()}）
                        <input
                            aria-label="日志开始时间"
                            type="datetime-local"
                            value={draft.from}
                            onChange={(e) =>
                                setDraft({ ...draft, from: e.target.value })
                            }
                        />
                    </label>
                    <label>
                        结束时间（{displayTimeZone()}）
                        <input
                            aria-label="日志结束时间"
                            type="datetime-local"
                            value={draft.to}
                            onChange={(e) =>
                                setDraft({ ...draft, to: e.target.value })
                            }
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
                    <button className="primary">查询</button>
                    <button
                        type="button"
                        onClick={() => {
                            setDraft(empty);
                            setFilters(empty);
                            setPage(1);
                            setError("");
                        }}
                    >
                        清除筛选
                    </button>
                </AdminFilterBar>
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <p className="admin-log-note muted">
                    默认查看最近 24
                    小时。历史日志的检索字段由清理任务分批补齐；不展示原始请求参数、异常内容或历史敏感字段。
                </p>
                <State {...logs} retry={logs.reload}>
                    <TableViewport>
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
                                        <td>{time(r.created_at)}</td>
                                        <td>
                                            {r.level}
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
                                            {r.duration_ms ?? "—"} ms
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
                        {!logs.data?.length && (
                            <p className="pad">暂无匹配日志</p>
                        )}
                    </TableViewport>
                </State>
                <Pager
                    page={page}
                    total={logs.total}
                    size={pageSize}
                    loading={logs.loading}
                    onChange={setPage}
                    onSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                />
            </Panel>
        </>
    );
}
