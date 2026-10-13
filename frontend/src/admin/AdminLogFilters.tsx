import {
    dateTimeInput,
    parseDateTimeInput,
    displayTimeZone,
} from "../shared/timezone";
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
                if (
                    ["from", "to"].includes(key) &&
                    Number.isFinite(Number(value))
                ) {
                    return [key, dateTimeInput(Number(value))];
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
        <form
            className="admin-log-filters"
            onSubmit={(event) => {
                event.preventDefault();
                if (draft.from && draft.to && draft.from > draft.to) {
                    setError("结束时间不能早于开始时间");
                    return;
                }
                try {
                    const filters: Row = {};
                    for (const [key, value] of Object.entries(draft)) {
                        if (String(value).trim())
                            filters[key] = ["from", "to"].includes(key)
                                ? parseDateTimeInput(String(value))
                                : String(value).trim();
                    }
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
                    {type === "datetime-local"
                        ? `（${displayTimeZone()}）`
                        : ""}
                    <input
                        aria-label={`日志${label}`}
                        type={type}
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
            <button type="submit">查询</button>
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
            {error && <span role="alert">{error}</span>}
        </form>
    );
}
