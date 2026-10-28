import { useEffect, useId, useRef, useState } from "react";
import {
    Check,
    CheckCircle2,
    CreditCard,
    FileText,
    ShieldAlert,
    UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { browserFetch, forgetBrowserSession } from "../shared/browser-session";
import { clearReadCache } from "../shared/api";
import { apiUrl } from "../shared/runtime-config";
import { locale, tx } from "../shared/i18n";
import { Modal } from "../shared/ui";
import type { V10AccountDeletionState } from "../shared/v10-types";

const reasons: Record<string, string> = {
    ADMIN_ACCOUNT: "管理员账户不能自助删除。",
    ACCOUNT_FUNDS: "请先处理账户余额和佣金。",
    OPEN_ORDERS: "请先处理未完成的订单。",
    PENDING_COMMISSION: "请等待邀请佣金结算完成。",
    OPEN_TICKETS: "请先处理并关闭未完成的工单或提现申请。",
    RECENT_LOGIN_REQUIRED: "请重新登录并完成安全验证，在 5 分钟内删除账户。",
    INCORRECT_PASSWORD: "当前密码不正确。",
    ACCOUNT_DELETION_DISABLED: "站点已关闭自助删除账户。",
    RATE_LIMITED: "操作过于频繁，请稍后重试。",
};
async function deletionRequest(
    body?: { password: string; confirmation: string },
    signal?: AbortSignal,
): Promise<V10AccountDeletionState | undefined> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 15000);
    try {
        const response = await browserFetch(
            apiUrl(`/api/v10/me${body ? "" : "/account-deletion"}`),
            {
                method: body ? "DELETE" : "GET",
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    "Accept-Language": locale(),
                    ...(body ? { "Content-Type": "application/json" } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            },
        );
        if (response.status === 204) return;
        const payload = await response.json();
        if (!response.ok)
            throw new Error(
                tx(reasons[payload.code] || "无法完成操作，请刷新页面后重试。"),
            );
        return payload.data;
    } catch (error) {
        if (controller.signal.aborted)
            throw new Error(tx("无法完成操作，请刷新页面后重试。"));
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}
function DeletionSteps({ confirming = false }: { confirming?: boolean }) {
    return (
        <ol className="account-deletion-steps" aria-label={tx("删除账户")}>
            {["了解删除影响", "验证并确认"].map((label, index) => (
                <li
                    key={label}
                    aria-current={
                        index === (confirming ? 1 : 0) ? "step" : undefined
                    }
                    data-complete={confirming && index === 0}
                >
                    <span
                        className="account-deletion-step-number"
                        aria-hidden="true"
                    >
                        {confirming && index === 0 ? (
                            <Check size={14} />
                        ) : (
                            index + 1
                        )}
                    </span>
                    <span>{tx(label)}</span>
                </li>
            ))}
        </ol>
    );
}

export function AccountDeletion() {
    useTranslation();
    const [state, setState] = useState<V10AccountDeletionState | null>(null);
    const [open, setOpen] = useState(false),
        [busy, setBusy] = useState(false),
        [password, setPassword] = useState(""),
        [confirmation, setConfirmation] = useState(""),
        [error, setError] = useState(""),
        [ack, setAck] = useState(false),
        [done, setDone] = useState(false);
    const pending = useRef(false);
    const statusRequest = useRef<AbortController | null>(null);
    const [checking, setChecking] = useState(false),
        [statusError, setStatusError] = useState("");
    const confirmationHint = useId();
    useEffect(() => {
        const controller = new AbortController();
        deletionRequest(undefined, controller.signal)
            .then((value) => {
                if (!controller.signal.aborted && value) setState(value);
            })
            .catch(() => {});
        return () => controller.abort();
    }, []);
    useEffect(() => () => statusRequest.current?.abort(), []);
    async function refresh() {
        if (statusRequest.current || pending.current) return;
        const controller = new AbortController();
        statusRequest.current = controller;
        setChecking(true);
        setStatusError("");
        try {
            const value = await deletionRequest(undefined, controller.signal);
            if (!controller.signal.aborted && value) setState(value);
        } catch {
            if (!controller.signal.aborted)
                setStatusError(tx("暂时无法检查账户状态，请稍后重新检查。"));
        } finally {
            if (!controller.signal.aborted) setChecking(false);
            statusRequest.current = null;
        }
    }
    function close() {
        if (!pending.current) {
            setOpen(false);
            setPassword("");
            setConfirmation("");
            setAck(false);
            setError("");
        }
    }
    async function remove(event: React.FormEvent) {
        event.preventDefault();
        if (pending.current || !ack || confirmation !== "DELETE" || !password)
            return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await deletionRequest({ password, confirmation });
            clearReadCache();
            forgetBrowserSession();
            setPassword("");
            setDone(true);
            setOpen(false);
        } catch (reason) {
            setError((reason as Error).message);
            setPassword("");
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    if (done)
        return (
            <section className="settings-section account-deletion">
                <div className="settings-card">
                    <CheckCircle2
                        className="account-deletion-success-icon"
                        size={36}
                        aria-hidden="true"
                    />
                    <h2 role="status">{tx("账户已删除。")}</h2>
                    <p className="muted">
                        {tx("账户已停用，所有登录会话均已结束。")}
                    </p>
                    <div className="account-deletion-footer">
                        <button
                            onClick={() =>
                                window.dispatchEvent(new Event("auth-expired"))
                            }
                        >
                            {tx("返回登录")}
                        </button>
                    </div>
                </div>
            </section>
        );
    if (!state?.enabled) return null;
    return (
        <section className="settings-section account-deletion">
            <h2>{tx("删除账户")}</h2>
            <div className="settings-card">
                <DeletionSteps />
                <h3 className="account-deletion-review-title">
                    {tx("删除前，请确认以下事项")}
                </h3>
                <dl className="account-deletion-effects">
                    <div>
                        <UserRound size={20} aria-hidden="true" />
                        <dt>{tx("账户与登录")}</dt>
                        <dd>
                            {tx(
                                "删除后将无法再登录，所有设备会退出，账户身份资料无法恢复。",
                            )}
                        </dd>
                    </div>
                    <div>
                        <CreditCard size={20} aria-hidden="true" />
                        <dt>{tx("订阅与权益")}</dt>
                        <dd>
                            {tx(
                                "剩余套餐、流量和优惠权益将失效，删除账户不会自动退款。",
                            )}
                        </dd>
                    </div>
                    <div>
                        <FileText size={20} aria-hidden="true" />
                        <dt>{tx("数据与记录")}</dt>
                        <dd>
                            {tx(
                                "账户身份资料将被清除或匿名化，必要的账务和安全记录仍会按站点规则保留。",
                            )}
                        </dd>
                    </div>
                </dl>
                <div className="account-deletion-warning">
                    <ShieldAlert size={20} aria-hidden="true" />
                    <strong>
                        {tx("删除账户无法撤销，请确认不再需要此账户。")}
                    </strong>
                </div>
                {!!state.blockers.length && (
                    <div className="account-deletion-blockers">
                        <h3>{tx("需要先处理的事项")}</h3>
                        <ul>
                            {state.blockers.map((code) => (
                                <li key={code}>
                                    {tx(
                                        reasons[code] || "请先处理未完成事项。",
                                    )}
                                </li>
                            ))}
                        </ul>
                        <p className="muted">
                            {tx("处理完成后，请重新检查账户状态。")}
                        </p>
                    </div>
                )}
                {statusError && (
                    <p className="alert" role="alert">
                        {statusError}
                    </p>
                )}
                {!state.blockers.length && !statusError && !checking && (
                    <p className="account-deletion-ready" role="status">
                        <CheckCircle2 size={17} aria-hidden="true" />
                        {tx("账户状态已检查，可以继续。")}
                    </p>
                )}
                <div className="account-deletion-footer" aria-busy={checking}>
                    <button
                        type="button"
                        disabled={checking || busy || open}
                        onClick={refresh}
                    >
                        {tx(checking ? "检查中…" : "重新检查")}
                    </button>
                    <button
                        type="button"
                        className="danger"
                        disabled={
                            !!state.blockers.length || checking || !!statusError
                        }
                        onClick={() => {
                            setOpen(true);
                            setError("");
                        }}
                    >
                        {tx("删除账户")}
                    </button>
                </div>
            </div>
            {open && (
                <Modal
                    title={tx("确认删除账户")}
                    close={close}
                    dismissible={!busy}
                    className="account-deletion-dialog"
                >
                    <form
                        className="pad account-deletion-confirm"
                        onSubmit={remove}
                        aria-busy={busy}
                    >
                        <DeletionSteps confirming />
                        <div className="account-deletion-warning">
                            <ShieldAlert size={22} aria-hidden="true" />
                            <strong>
                                {tx("删除账户无法撤销，请确认不再需要此账户。")}
                            </strong>
                        </div>
                        <p className="muted">
                            {tx(
                                "剩余套餐、流量和优惠权益将失效，删除账户不会自动退款。",
                            )}
                        </p>
                        <p className="muted">
                            {tx(
                                "请重新登录并完成安全验证，在 5 分钟内删除账户。",
                            )}
                        </p>
                        <fieldset
                            className="account-deletion-verification"
                            disabled={busy}
                        >
                            <legend>{tx("验证并确认")}</legend>
                            <label>
                                {tx("当前密码")}
                                <input
                                    type="password"
                                    autoComplete="current-password"
                                    maxLength={128}
                                    required
                                    value={password}
                                    disabled={busy}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                />
                            </label>
                            <label>
                                {tx("输入 DELETE 确认删除")}
                                <input
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    dir="ltr"
                                    required
                                    pattern="DELETE"
                                    aria-describedby={confirmationHint}
                                    value={confirmation}
                                    disabled={busy}
                                    onChange={(event) =>
                                        setConfirmation(event.target.value)
                                    }
                                />
                            </label>
                            <p
                                id={confirmationHint}
                                className="muted account-deletion-hint"
                            >
                                {tx("为避免误操作，请输入大写 DELETE。")}
                            </p>
                        </fieldset>
                        <label className="account-deletion-ack">
                            <input
                                type="checkbox"
                                checked={ack}
                                disabled={busy}
                                onChange={(event) =>
                                    setAck(event.target.checked)
                                }
                            />
                            {tx("我已了解删除后果，并确认永久删除账户。")}
                        </label>
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="actions">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={close}
                            >
                                {tx("取消")}
                            </button>
                            <button
                                type="submit"
                                className="danger"
                                disabled={
                                    busy ||
                                    !ack ||
                                    confirmation !== "DELETE" ||
                                    !password
                                }
                            >
                                {tx(busy ? "提交中…" : "确认删除账户")}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </section>
    );
}
