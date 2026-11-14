import { parseDateTimeInput, businessTimeZone } from "../shared/timezone";
import { useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { AdminBusinessTimeZoneNote } from "./admin-log-time";
import type { UserFilter } from "./user-filters";

export function AdminUsageReset({
    filters,
    count,
    single = false,
    onComplete,
}: {
    filters: UserFilter[];
    count: number;
    single?: boolean;
    onComplete: () => void;
}) {
    const [operation, setOperation] = useState<{
        kind: "grant" | "global";
        filters: UserFilter[];
        count: number;
    } | null>(null);
    return (
        <>
            <button
                type="button"
                disabled={!count}
                onClick={() =>
                    setOperation({
                        kind: "grant",
                        filters: structuredClone(filters),
                        count,
                    })
                }
            >
                {single ? "发放储备重置" : "批量发放储备重置"}
            </button>
            {!single && (
                <button
                    type="button"
                    className="danger"
                    onClick={() =>
                        setOperation({ kind: "global", filters: [], count: 0 })
                    }
                >
                    全局重置用量
                </button>
            )}
            {operation && (
                <ResetForm
                    operation={operation}
                    close={() => setOperation(null)}
                    complete={() => {
                        setOperation(null);
                        onComplete();
                    }}
                />
            )}
        </>
    );
}
function ResetForm({
    operation,
    close,
    complete,
}: {
    operation: {
        kind: "grant" | "global";
        filters: UserFilter[];
        count: number;
    };
    close: () => void;
    complete: () => void;
}) {
    const global = operation.kind === "global";
    const preview = useData(global ? admin("user/usageResetPreview") : "");
    const count = global ? preview.data?.count || 0 : operation.count;
    const [quantity, setQuantity] = useState(1),
        [expiry, setExpiry] = useState(""),
        [confirmation, setConfirmation] = useState(""),
        [checked, setChecked] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [scope, setScope] = useState<Row | null>(null);
    const lock = useRef(false),
        attempt = useRef({ payload: "", key: "" });
    async function checkScope() {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setScope(null);
        setChecked(false);
        setError("");
        try {
            const result = await request(admin("user/usageResetPreview"), {
                filter: operation.filters, expected_count: count,
            });
            setScope(result.data);
        } catch (cause) {
            const err = cause as Error & { code?: string };
            setError(err.code === "reset_count_changed"
                ? "用户数量已变化，请关闭窗口并刷新列表后重试。" : err.message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (lock.current || !checked || !count || (!global && !scope?.scope_token)) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const body = {
                kind: operation.kind,
                expected_count: count,
                ...(global
                    ? { confirmation }
                    : {
                          quantity,
                          expires_at: expiry
                              ? parseDateTimeInput(expiry)
                              : null,
                          filter: operation.filters,
                          scope_token: scope?.scope_token,
                      }),
            };
            const payload = JSON.stringify(body);
            if (attempt.current.payload !== payload)
                attempt.current = { payload, key: crypto.randomUUID() };
            await request(admin("user/usageReset"), {
                ...body,
                request_key: attempt.current.key,
            });
            complete();
        } catch (cause) {
            const err = cause as Error & { code?: string };
            if (err.code === "reset_scope_changed" || err.code === "reset_count_changed") {
                setChecked(false);
                setScope(null);
            }
            setError(
                err.code === "reset_count_changed"
                    ? "用户数量已变化，请关闭窗口并刷新列表后重试。"
                    : err.code === "reset_scope_changed"
                      ? "受影响用户已变化，请重新检查后确认。"
                    : err.code === "reset_request_conflict"
                      ? "操作标识冲突，请关闭窗口后重试。"
                      : err.message,
            );
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return (
        <Modal
            title={global ? "全局重置用量" : "发放储备重置"}
            close={() => {
                if (!lock.current) close();
            }}
            variant="modal"
        >
            <form className="pad reset-admin-form" onSubmit={submit}>
                {global && (
                    <State {...preview} retry={preview.reload}>
                        <p className="alert">
                            将立即清零全站 {count}{" "}
                            位用户的已用流量，不受列表筛选条件影响。此操作不可撤销。
                        </p>
                    </State>
                )}
                {!global && (
                    <>
                        <AdminBusinessTimeZoneNote />
                        <p>
                            向当前筛选范围内的 <strong>{count}</strong>{" "}
                            位用户发放储备次数，用户可在「使用情况」主动使用。
                        </p>
                        <button type="button" disabled={busy} onClick={checkScope}>检查发放对象</button>
                        {scope && <>
                            <p>已核对 {scope.total} 名用户，以下显示最多 10 名。</p>
                            <ul>{scope.sample.map((user: Row) => <li key={user.id}>#{user.id} {user.email}</li>)}</ul>
                        </>}
                        <label>
                            每人发放次数
                            <input
                                type="number"
                                min={1}
                                max={100}
                                required
                                value={quantity}
                                onChange={(event) =>
                                    setQuantity(Number(event.target.value))
                                }
                                disabled={busy}
                            />
                        </label>
                        <label>
                            有效期（留空为长期有效）
                            <input
                                title={`业务时区：${businessTimeZone()}`}
                                type="datetime-local"
                                step={1}
                                value={expiry}
                                onChange={(event) =>
                                    setExpiry(event.target.value)
                                }
                                disabled={busy}
                            />
                        </label>
                    </>
                )}
                <p className="muted">
                    套餐额度、订阅到期时间及原定重置日期保持不变。全局重置不扣除任何储备次数。发放和使用均保留记录。
                </p>
                {global && (
                    <label>
                        输入 RESET ALL USAGE 确认
                        <input
                            value={confirmation}
                            onChange={(event) =>
                                setConfirmation(event.target.value)
                            }
                            autoComplete="off"
                            required
                            disabled={busy}
                        />
                    </label>
                )}
                <label className="check">
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setChecked(event.target.checked)}
                        disabled={busy || (!global && !scope?.scope_token)}
                    />
                    我已核对影响范围和操作内容
                </label>
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <div className="admin-dialog-actions">
                    <button type="button" disabled={busy} onClick={close}>
                        取消
                    </button>
                    <button
                        className={global ? "danger" : "primary"}
                        disabled={
                            busy ||
                            !checked ||
                            !count ||
                            (!global && !scope?.scope_token) ||
                            (global && confirmation !== "RESET ALL USAGE")
                        }
                    >
                        {busy
                            ? "处理中…"
                            : global
                              ? "确认全局重置"
                              : "确认发放"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
