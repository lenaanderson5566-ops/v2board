import { useState } from "react";
import { dateTimeInput } from "../shared/timezone";
import type { Row } from "../shared/api";
import {
    userFilterFields,
    normalizeUserFilters,
    type UserFilter,
} from "./user-filters";

export function UserFilters({
    initial,
    plans,
    onApply,
}: {
    initial: UserFilter[];
    plans: Row[];
    onApply: (filters: UserFilter[]) => void;
}) {
    const [draft, setDraft] = useState(
            initial.map((f) =>
                ["expired_at", "created_at"].includes(f.key)
                    ? {
                          ...f,
                          value: dateTimeInput(Number(f.value)),
                      }
                    : { ...f },
            ),
        ),
        [error, setError] = useState("");
    function change(index: number, value: Partial<UserFilter>) {
        setDraft(draft.map((f, i) => (i === index ? { ...f, ...value } : f)));
        setError("");
    }
    return (
        <form
            className="pad user-filters"
            onSubmit={(e) => {
                e.preventDefault();
                try {
                    onApply(normalizeUserFilters(draft));
                } catch (err) {
                    setError((err as Error).message);
                }
            }}
        >
            <p className="muted">
                多个条件同时满足。流量单位为 GB，到期时间按本地时间输入。
            </p>
            {draft.map((f, i) => {
                const spec = userFilterFields.find(([key]) => key === f.key)!;
                const options =
                    f.key === "plan_id"
                        ? [
                              ["null", "无套餐"],
                              ...plans.map((p) => [String(p.id), p.name]),
                          ]
                        : f.key === "banned"
                          ? [
                                ["0", "正常"],
                                ["1", "封禁"],
                            ]
                          : f.key === "is_admin"
                            ? [
                                  ["0", "否"],
                                  ["1", "是"],
                              ]
                            : null;
                return (
                    <div className="user-filter-row" key={i}>
                        <select
                            aria-label={`筛选字段 ${i + 1}`}
                            value={f.key}
                            onChange={(e) => {
                                const key = e.target.value;
                                change(i, {
                                    key,
                                    condition: userFilterFields.find(
                                        ([k]) => k === key,
                                    )![2][0],
                                    value: ["banned", "is_admin"].includes(key)
                                        ? "0"
                                        : key === "plan_id"
                                          ? "null"
                                          : "",
                                });
                            }}
                        >
                            {userFilterFields.map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={`筛选条件 ${i + 1}`}
                            value={f.condition}
                            onChange={(e) =>
                                change(i, { condition: e.target.value })
                            }
                        >
                            {spec[2].map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                        </select>
                        {options ? (
                            <select
                                aria-label={`筛选值 ${i + 1}`}
                                value={f.value}
                                onChange={(e) =>
                                    change(i, { value: e.target.value })
                                }
                            >
                                {options.map(([v, l]) => (
                                    <option value={v} key={v}>
                                        {l}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                aria-label={`筛选值 ${i + 1}`}
                                type={
                                    ["expired_at", "created_at"].includes(f.key)
                                        ? "datetime-local"
                                        : ["uuid", "token"].includes(f.key)
                                          ? "password"
                                          : [
                                                  "id",
                                                  "transfer_enable",
                                                  "device_limit",
                                                  "d",
                                                  "invite_user_id",
                                              ].includes(f.key)
                                            ? "number"
                                            : "text"
                                }
                                min="0"
                                step="any"
                                required
                                value={f.value}
                                onChange={(e) =>
                                    change(i, { value: e.target.value })
                                }
                            />
                        )}
                        <button
                            type="button"
                            aria-label={`删除筛选条件 ${i + 1}`}
                            onClick={() =>
                                setDraft(
                                    draft.filter((_, index) => index !== i),
                                )
                            }
                        >
                            删除条件
                        </button>
                    </div>
                );
            })}
            <div className="actions">
                <button
                    type="button"
                    onClick={() =>
                        setDraft([
                            ...draft,
                            { key: "email", condition: "模糊", value: "" },
                        ])
                    }
                >
                    添加条件
                </button>
                <button type="button" onClick={() => setDraft([])}>
                    重置条件
                </button>
                <button className="primary">应用筛选</button>
            </div>
            {error && (
                <p className="alert" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}
