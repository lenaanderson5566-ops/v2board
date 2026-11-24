import { useState, type ComponentProps, type FormEvent } from "react";
import { admin, bytes, query, type Row } from "../shared/api";
import { displayTimeZone } from "../shared/timezone";
import { State, Table, useData } from "../shared/ui";
import { AdminChoiceGroup } from "./AdminChoices";
import { AdminFilterBar } from "./AdminFilterBar";
import { AdminPager } from "./AdminPager";
import { AdminLogTimestamp } from "./admin-log-time";
import { adminUserLabel } from "./admin-user-label";
import { useAdminLogDateRange } from "./use-admin-log-date-range";

const kinds = [
    { value: "use", label: "用户使用" },
    { value: "grant", label: "管理员发放" },
    { value: "global", label: "全局重置" },
] as const;
type Kind = (typeof kinds)[number]["value"];
type DateRange = { from: number | null; to: number | null };

function historyColumns(kind: Kind): ComponentProps<typeof Table>["columns"] {
    const timeLabel = { use: "使用时间", grant: "发放时间", global: "重置时间" }[kind];
    const columns: ComponentProps<typeof Table>["columns"] = [
        ["created_at", timeLabel, row => <AdminLogTimestamp value={row.created_at} />],
    ];
    if (kind !== "global") {
        columns.push(["quantity", kind === "grant" ? "发放次数" : "消耗次数",
            row => row.quantity == null ? "未记录" : `${Math.abs(row.quantity)} 次`]);
    }
    if (kind !== "use") {
        columns.push(["actor_id", kind === "grant" ? "发放人" : "操作人", row =>
            row.actor_id || row.actor_email
                ? adminUserLabel({ user_id: row.actor_id, email: row.actor_email })
                : "未记录"]);
    }
    if (kind === "grant") {
        columns.push(["expires_at", "有效期", row => {
            if (!row.expiry_known) return "未记录";
            return row.expires_at == null ? "长期有效" : <AdminLogTimestamp value={row.expires_at} />;
        }]);
    } else {
        columns.push(["u_before", "重置前用量", row => {
            if (row.u_before == null || row.d_before == null) return "未记录";
            return <span title={`上传 ${bytes(row.u_before)} · 下载 ${bytes(row.d_before)}`}>
                {bytes(Number(row.u_before) + Number(row.d_before))}
            </span>;
        }]);
    }
    columns.push(["batch_id", "批次", row => row.batch_id ?? "—"]);
    return columns;
}

export function AdminUsageResetHistory({ userId }: { userId: number }) {
    const [kind, setKind] = useState<Kind>("use");
    const [range, setRange] = useState<DateRange>(() => ({
        from: Math.floor(Date.now() / 1000) - 30 * 86400,
        to: null,
    }));
    const dates = useAdminLogDateRange(range);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const logs = useData<Row[]>(query(admin("user/usageResetLogs"), {
        user_id: userId, kind, ...range, current: page, pageSize,
    }));

    function apply(event: FormEvent) {
        event.preventDefault();
        try {
            const from = dates.instant("from"), to = dates.instant("to");
            if (from != null && to != null && from > to) throw new Error("结束时间不能早于开始时间");
            if (page === 1 && from === range.from && to === range.to) {
                logs.reload();
            } else {
                setRange({ from, to });
                setPage(1);
            }
            setError("");
        } catch (cause) {
            setError((cause as Error).message);
        }
    }

    return <div className="pad">
        <AdminChoiceGroup label="重置记录类型" value={kind} options={kinds} onChange={value => {
            setKind(value);
            setPage(1);
        }} />
        <p className="admin-log-note muted">记录与筛选时区：{displayTimeZone()}</p>
        <AdminFilterBar className="admin-log-filters" onSubmit={apply}>
            <label>开始时间
                <input type="datetime-local" step={1} value={dates.value("from")}
                    onChange={event => dates.change("from", event.target.value)} />
            </label>
            <label>结束时间
                <input type="datetime-local" step={1} value={dates.value("to")}
                    onChange={event => dates.change("to", event.target.value)} />
            </label>
            <div className="admin-filter-actions">
                <button type="submit" className="primary">查询</button>
                <button type="button" onClick={() => {
                    dates.reset();
                    setRange({ from: null, to: null });
                    setPage(1);
                    setError("");
                }}>清除时间</button>
            </div>
            {error && <p className="alert admin-filter-error" role="alert">{error}</p>}
        </AdminFilterBar>
        <State {...logs} retry={logs.reload}>
            {logs.data?.length ? <Table columns={historyColumns(kind)} data={logs.data} />
                : !logs.loading && !logs.error && <p className="admin-log-empty" role="status">暂无符合条件的重置记录</p>}
        </State>
        {(logs.total > 0 || page > 1) && <AdminPager page={page} total={logs.total}
            totalUnavailable={logs.data == null || Boolean(logs.error)} size={pageSize}
            loading={logs.loading} onChange={setPage} onSizeChange={size => {
                setPageSize(size);
                setPage(1);
            }} />}
    </div>;
}
