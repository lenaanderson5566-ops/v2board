import { AdminFilterBar } from "./AdminFilterBar";
import { useState } from "react";
import type { Row } from "../shared/api";
import { FilterActions } from "../shared/ui/controls";
import { useAdminLogDateRange } from "./use-admin-log-date-range";

export type AdminLogKind = "login" | "subscribe" | "connection" | "risk";

export function AdminLogFilters({
    kind,
    onApply,
    initialFilters = {},
}: {
    initialFilters?: Row;
    kind: AdminLogKind;
    onApply: (filters: Row) => void;
}) {
    const { from: initialFrom, to: initialTo, ...initialText } = initialFilters;
    const dates = useAdminLogDateRange({ from: initialFrom, to: initialTo });
    const [draft, setDraft] = useState<Row>(initialText);
    const [error, setError] = useState("");
    const fields = [
        ["keyword", "关键词", "text"],
        ["ip", "精确 IP", "text"],
        ["from", "开始时间", "datetime-local"],
        ["to", "结束时间", "datetime-local"],
        ...(kind === "subscribe"
            ? [["client_type", "客户端类型", "text"]]
            : []),
    ];
    return (
        <AdminFilterBar
            className="admin-log-filters"
            onSubmit={(event) => {
                event.preventDefault();
                try {
                    const filters: Row = {};
                    for (const [key, value] of Object.entries(draft)) {
                        if (value != null && String(value).trim())
                            filters[key] = String(value).trim();
                    }
                    const from = dates.instant("from"), to = dates.instant("to");
                    if (from != null && to != null && from > to)
                        throw new Error("结束时间不能早于开始时间");
                    if (from != null) filters.from = from;
                    if (to != null) filters.to = to;
                    setError("");
                    onApply(filters);
                } catch (e) {
                    setError((e as Error).message);
                }
            }}
        >
            {fields.map(([key, label, type]) => (
                <label key={key}>
                    {label}
                    <input
                        aria-label={`日志${label}`}
                        type={type}
                        step={type === "datetime-local" ? 1 : undefined}
                        value={key === "from" || key === "to" ? dates.value(key) : draft[key] || ""}
                        maxLength={key === "keyword" ? 200 : undefined}
                        placeholder={
                            key === "keyword"
                                ? kind === "connection"
                                    ? "邮箱、用户 ID 或 IP"
                                    : kind === "risk"
                                      ? "邮箱、用户 ID、IP、规则或结果代码"
                                      : kind === "login"
                                        ? "邮箱、用户 ID、IP 或 UA"
                                        : "邮箱、用户 ID、IP、UA 或结果代码"
                                : undefined
                        }
                        onChange={(event) => {
                            if (key === "from" || key === "to") dates.change(key, event.target.value);
                            else setDraft({ ...draft, [key]: event.target.value });
                        }}
                    />
                </label>
            ))}
            {kind === "subscribe" && (
                <label>
                    订阅结果
                    <select
                        aria-label="日志订阅结果"
                        value={draft.status || ""}
                        onChange={(event) =>
                            setDraft({ ...draft, status: event.target.value })
                        }
                    >
                        <option value="">全部</option>
                        <option value="success">成功</option>
                        <option value="failed">失败</option>
                    </select>
                </label>
            )}
            {kind === "login" && (
                <label>
                    登录结果
                    <select
                        aria-label="日志登录结果"
                        value={draft.is_success ?? ""}
                        onChange={(event) =>
                            setDraft({
                                ...draft,
                                is_success: event.target.value,
                            })
                        }
                    >
                        <option value="">全部</option>
                        <option value="1">成功</option>
                        <option value="0">失败</option>
                    </select>
                </label>
            )}
            {kind === "risk" && <label>风险等级
                <select value={draft.risk_level || ""} onChange={e => setDraft({ ...draft, risk_level: e.target.value })}>
                    <option value="">全部</option><option value="high">高风险</option>
                    <option value="medium">中风险</option><option value="low">低风险</option>
                </select>
            </label>}
            <div className="admin-filter-actions">
                <FilterActions onReset={() => {
                    setDraft({});
                    dates.reset();
                    setError("");
                    onApply({});
                }} />
            </div>
            {error && <p className="alert admin-filter-error" role="alert">{error}</p>}
        </AdminFilterBar>
    );
}
