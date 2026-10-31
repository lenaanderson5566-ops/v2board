import { AdminFilterBar } from "./AdminFilterBar";
import { dateTimeFieldValue, dateTimeFieldInstant } from "../shared/date-time-field";
import { useState } from "react";
import type { Row } from "../shared/api";

export function AdminLogFilters({
    kind,
    onApply,
    initialFilters = {},
}: {
    initialFilters?: Row;
    kind: string;
    onApply: (filters: Row) => void;
}) {
    const [draft, setDraft] = useState<Row>(() =>
        Object.fromEntries(
            Object.entries(initialFilters).map(([key, value]) => {
                if (["from", "to"].includes(key)) {
                    return [key, dateTimeFieldValue(value)];
                }
                return [key, value];
            }),
        ),
    );
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
                            filters[key] = ["from", "to"].includes(key)
                                ? dateTimeFieldInstant(value, initialFilters[key])
                                : String(value).trim();
                    }
                    if (typeof filters.from === "number" && typeof filters.to === "number" && filters.from > filters.to)
                        throw new Error("结束时间不能早于开始时间");
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
                        value={draft[key] || ""}
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
                        onChange={(event) =>
                            setDraft({ ...draft, [key]: event.target.value })
                        }
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
            <div className="admin-filter-actions">
            <button type="submit" className="primary">查询</button>
            <button
                type="button"
                onClick={() => {
                    setDraft({});
                    setError("");
                    onApply({});
                }}
            >
                重置
            </button>
            </div>
            {error && <span role="alert">{error}</span>}
        </AdminFilterBar>
    );
}
