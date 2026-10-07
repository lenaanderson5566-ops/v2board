import { forgetBrowserSession } from "../shared/browser-session";
import { AccountSessions } from "./AccountSessions";
import { useId, useState, useRef, type FormEvent } from "react";
import { Eye, EyeOff, ArrowLeft, Shield } from "lucide-react";
import { request, clearReadCache, storageKey } from "../shared/api";
import { tx } from "../shared/i18n";
import { Modal } from "../shared/ui";

export function AccountSecurity() {
    const id = useId();
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [resetOpen, setResetOpen] = useState(false);
    const [resetBusy, setResetBusy] = useState(false);
    const [resetError, setResetError] = useState("");
    const [resetDone, setResetDone] = useState(false);
    const resetting = useRef(false);
    async function resetSubscription() {
        if (resetting.current) return;
        resetting.current = true;
        setResetBusy(true);
        setResetError("");
        try {
            await request("user/resetSecurity", {});
            clearReadCache();
            setResetOpen(false);
            setResetDone(true);
        } catch (problem) {
            setResetError((problem as Error).message);
        } finally {
            resetting.current = false;
            setResetBusy(false);
        }
    }
    async function save(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        setError("");
        if (password.length < 8) {
            setError(tx("密码至少需要8个字符。"));
            return;
        }
        if (password !== confirmation) {
            setError(tx("两次输入的新密码不一致。"));
            return;
        }
        setBusy(true);
        try {
            await request("user/changePassword", {
                old_password: current,
                new_password: password,
            });
            setCurrent("");
            setPassword("");
            setConfirmation("");
            clearReadCache();
            forgetBrowserSession();
            sessionStorage.setItem(`${storageKey}.passwordUpdated`, "1");
            window.dispatchEvent(new Event("auth-expired"));
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="account-security">
            <a href="#/dashboard" className="security-back">
                <ArrowLeft size={16} aria-hidden="true" />
                {tx("总览")}
            </a>
            <div className="security-heading">
                <Shield size={24} aria-hidden="true" />
                <h2>{tx("修改密码")}</h2>
            </div>
            <p className="muted">
                {tx("修改密码后，所有设备都需要重新登录。")}
            </p>
            <form onSubmit={save}>
                <label htmlFor={`${id}-current`}>
                    {tx("当前密码")}
                    <input
                        id={`${id}-current`}
                        type="password"
                        dir="ltr"
                        autoComplete="current-password"
                        required
                        value={current}
                        onChange={(event) => setCurrent(event.target.value)}
                        disabled={busy}
                    />
                </label>
                <label htmlFor={`${id}-new`}>
                    {tx("新密码")}
                    <div className="security-password">
                        <input
                            id={`${id}-new`}
                            type={visible ? "text" : "password"}
                            dir="ltr"
                            autoComplete="new-password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            disabled={busy}
                        />
                        <button
                            type="button"
                            className="icon-button"
                            aria-label={tx(visible ? "隐藏密码" : "显示密码")}
                            aria-pressed={visible}
                            onClick={() => setVisible(!visible)}
                        >
                            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </label>
                <label htmlFor={`${id}-confirm`}>
                    {tx("确认新密码")}
                    <input
                        id={`${id}-confirm`}
                        type={visible ? "text" : "password"}
                        dir="ltr"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmation}
                        onChange={(event) =>
                            setConfirmation(event.target.value)
                        }
                        disabled={busy}
                    />
                </label>
                <small className="muted">{tx("密码至少需要8个字符。")}</small>
                {error && (
                    <div className="alert" role="alert">
                        {error}
                    </div>
                )}
                <button className="primary" disabled={busy}>
                    {tx(busy ? "提交中…" : "更新密码")}
                </button>
            </form>
            <section className="subscription-security">
                <h2>{tx("订阅安全")}</h2>
                <p className="muted">
                    {tx(
                        "怀疑配置泄露时，可重置订阅凭据。重置后所有设备需要重新导入配置，账户登录不受影响。",
                    )}
                </p>
                {resetDone && (
                    <p className="success-message" role="status">
                        {tx("订阅凭据已重置，请到配置中心重新导入。")}{" "}
                        <a href="#/subscribe">{tx("配置中心")}</a>
                    </p>
                )}
                <button
                    onClick={() => {
                        setResetError("");
                        setResetDone(false);
                        setResetOpen(true);
                    }}
                >
                    {tx("重置订阅链接")}
                </button>
            </section>
            <AccountSessions />
            {resetOpen && (
                <Modal
                    title={tx("重置订阅链接")}
                    close={() => {
                        if (!resetBusy) setResetOpen(false);
                    }}
                >
                    <div className="pad">
                        <p>
                            {tx(
                                "重置会更换订阅凭据及连接标识，旧链接和已导入的配置将失效。此操作无法撤销。",
                            )}
                        </p>
                        {resetError && (
                            <div role="alert" className="alert">
                                {resetError}
                            </div>
                        )}
                        <div className="actions space">
                            <button
                                disabled={resetBusy}
                                onClick={() => setResetOpen(false)}
                            >
                                {tx("取消")}
                            </button>
                            <button
                                className="primary"
                                disabled={resetBusy}
                                onClick={resetSubscription}
                            >
                                {tx(resetBusy ? "提交中…" : "确认重置")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </section>
    );
}
