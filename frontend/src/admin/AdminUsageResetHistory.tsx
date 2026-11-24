import { useState, type ComponentProps, type FormEvent } from "react";
import { admin, bytes, query, type Row } from "../shared/api";
import { Panel, State, Table, useData } from "../shared/ui";
import { AdminFilterBar } from "./AdminFilterBar";
import { AdminPager } from "./AdminPager";
import { AdminLogTimestamp, AdminLogTimeZone } from "./admin-log-time";
import { adminUserLabel } from "./admin-user-label";
import { useAdminLogDateRange } from "./use-admin-log-date-range";

const kinds = [
    { value: "use", label: "用户使用" },
    { value: "grant", label: "管理员发放" },
    { value: "global", label: "全局重置" },
] as const;
type Kind = (typeof kinds)[number]["value"];
type DateRange = { from: number | null; to: number | null };
type UserLookup = { user_id: number } | { email: string };
type LogFilters = DateRange & { user: UserLookup; kind: Kind };

function positiveUserId(value: string): number | null {
    const id = Number(value);
    return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function userLookup(value: string): UserLookup {
    const input = value.trim();
    const id = positiveUserId(input);
    if (id !== null) return { user_id: id };
    if (input.includes("@")) return { email: input };
    throw new Error("请输入用户 ID 或完整邮箱。");
}

function logQuery({ user, ...filters }: LogFilters, page: number, pageSize: number) {
    return query(admin("user/usageResetLogs"), { ...user, ...filters, current: page, pageSize });
}

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

export function AdminUsageResetHistory({ route }: { route: string }) {
    const initialId = positiveUserId(new URLSearchParams(route.split("?", 2)[1]).get("user_id") || "");
    const [userInput, setUserInput] = useState(initialId?.toString() ?? "");
    const [kind, setKind] = useState<Kind>("use");
    const [initialRange] = useState<DateRange>(() => ({
        from: Math.floor(Date.now() / 1000) - 30 * 86400,
        to: null,
    }));
    const dates = useAdminLogDateRange(initialRange);
    const [applied, setApplied] = useState<LogFilters | null>(() => initialId === null ? null : {
        user: { user_id: initialId }, kind: "use", ...initialRange,
    });
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const path = applied ? logQuery(applied, page, pageSize) : "";
    const logs = useData<Row[]>(path);

    function apply(event: FormEvent) {
        event.preventDefault();
        try {
            const user = userLookup(userInput);
            const from = dates.instant("from"), to = dates.instant("to");
            if (from != null && to != null && from > to) throw new Error("结束时间不能早于开始时间");
            const next = { user, kind, from, to };
            if (logQuery(next, 1, pageSize) === path) {
                logs.reload();
            } else {
                setApplied(next);
                setPage(1);
            }
            setError("");
        } catch (cause) {
            setError((cause as Error).message);
        }
    }

    return <Panel title="重置记录" actions={<a className="button" href="#/users">返回用户管理</a>}>
        <AdminLogTimeZone logFilters />
        <AdminFilterBar className="admin-log-filters" onSubmit={apply}>
            <label>用户 ID 或邮箱
                <input value={userInput} onChange={event => setUserInput(event.target.value)}
                    autoComplete="off" maxLength={254} required />
            </label>
            <label>记录类型
                <select value={kind} onChange={event => setKind(event.target.value as Kind)}>
                    {kinds.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </label>
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
                    if (applied) setApplied({ ...applied, from: null, to: null });
                    setPage(1);
                    setError("");
                }}>清除时间</button>
            </div>
            {error && <p className="alert admin-filter-error" role="alert">{error}</p>}
        </AdminFilterBar>
        {applied && <>
            <p className="admin-log-note muted">查询用户：{"user_id" in applied.user ? `ID ${applied.user.user_id}` : applied.user.email}</p>
            <State {...logs} retry={logs.reload}>
                {logs.data?.length ? <Table columns={historyColumns(applied.kind)} data={logs.data} />
                    : !logs.loading && !logs.error && <p className="admin-log-empty" role="status">暂无符合条件的重置记录</p>}
            </State>
            {(logs.total > 0 || page > 1) && <AdminPager page={page} total={logs.total}
                totalUnavailable={logs.data == null || Boolean(logs.error)} size={pageSize}
                loading={logs.loading} onChange={setPage} onSizeChange={size => {
                    setPageSize(size);
                    setPage(1);
                }} />}
        </>}
    </Panel>;
}
