import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Editor, Panel, State, useData } from "../shared/ui";
const time = (value: number) =>
    value ? new Date(value * 1000).toLocaleString() : "—";
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
const retentionFields = [
    ["system_log_retention_days", "系统日志", 1, "默认 30 天。"],
    [
        "connection_log_retention_days",
        "连接日志",
        1,
        "默认 30 天，与风控设置共用同一配置。",
    ],
    [
        "login_log_retention_days",
        "登录日志",
        0,
        "0 表示不自动清理；启用时为 30–365 天，建议 90 天。",
    ],
    [
        "subscribe_log_retention_days",
        "订阅日志",
        0,
        "0 表示不自动清理；启用时为 30–365 天，建议 90 天。",
    ],
    [
        "risk_log_retention_days",
        "风控命中",
        0,
        "0 表示不自动清理；启用时为 30–365 天。只清理已复核且超过保留期的记录，保留未复核及待复核记录。",
    ],
    ["ddns_log_retention_days", "DDNS 日志", 1, "默认 30 天。"],
] as const;
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
    const d = new Date(Date.now() - 86400000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return { ...empty, from: local.toISOString().slice(0, 16) };
}
export function AdminSystemLogs() {
    const [draft, setDraft] = useState<Filters>(recent),
        [filters, setFilters] = useState<Filters>(recent),
        [page, setPage] = useState(1),
        [error, setError] = useState("");
    const query = new URLSearchParams({
        current: String(page),
        page_size: "20",
    });
    for (const [key, value] of Object.entries(filters))
        if (value)
            query.set(
                key,
                key === "from" || key === "to"
                    ? String(Math.floor(new Date(value).getTime() / 1000))
                    : value,
            );
    const logs = useData<Row[]>(admin(`system/getSystemLog?${query}`));
    const retention = useData<Row>(admin("system/logRetention"));
    return (
        <>
            <Panel
                title="系统日志"
                actions={
                    <button
                        onClick={() => {
                            logs.reload();
                            retention.reload();
                        }}
                    >
                        刷新
                    </button>
                }
            >
                <form
                    className="pad toolbar"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (
                            draft.from &&
                            draft.to &&
                            new Date(draft.from) > new Date(draft.to)
                        ) {
                            setError("结束时间不能早于开始时间");
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
                        开始时间
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
                        结束时间
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
                </form>
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <p className="pad muted">
                    默认查看最近 24
                    小时。历史日志的检索字段由清理任务分批补齐；不展示原始请求参数、异常内容或历史敏感字段。
                </p>
                <State {...logs} retry={logs.reload}>
                    <div className="table-scroll">
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
                                        <td>{r.request_id || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!logs.data?.length && (
                            <p className="pad">暂无匹配日志</p>
                        )}
                    </div>
                </State>
                <div className="pad">
                    <button
                        disabled={page === 1 || logs.loading}
                        onClick={() => setPage(page - 1)}
                    >
                        上一页
                    </button>
                    <span>
                        {" "}
                        第 {page} 页 · {logs.total} 条{" "}
                    </span>
                    <button
                        disabled={page * 20 >= logs.total || logs.loading}
                        onClick={() => setPage(page + 1)}
                    >
                        下一页
                    </button>
                </div>
            </Panel>
            <Panel title="日志保留与清理">
                <div className="pad">
                    <p>
                        保存后由定时任务每 5
                        分钟分批清理，不在节点上报请求中删除日志。缩短保留时间后，过期数据会被永久删除。
                    </p>
                    <p className="muted">
                        最近成功执行：{time(retention.data?.lastRun?.at)}
                        {retention.data?.lastRun &&
                            ` · 删除 ${Object.values(retention.data.lastRun.deleted || {}).reduce<number>((sum, v) => sum + Number(v), 0)} 条 · 补齐 ${retention.data.lastRun.indexed || 0} 条检索字段`}
                    </p>
                </div>
                <State {...retention} retry={retention.reload}>
                    <Editor
                        key={JSON.stringify(retention.data?.settings)}
                        fields={retentionFields.map(
                            ([key, label, min, hint]) => ({
                                key,
                                label: label + "保留天数",
                                type: "number",
                                min,
                                max: 365,
                                step: 1,
                                unit: "天",
                                required: true,
                                hint,
                            }),
                        )}
                        initial={retention.data?.settings || {}}
                        onSave={async (b) => {
                            await request(admin("system/logRetention"), b);
                            retention.reload();
                        }}
                    />
                </State>
            </Panel>
        </>
    );
}
