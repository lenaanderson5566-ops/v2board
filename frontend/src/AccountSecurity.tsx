import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowLeft, Shield } from "lucide-react";
import { request, clearReadCache, storageKey } from "./api";
import { tx } from "./i18n";

export function AccountSecurity() {
    const id = useId();
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
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
            localStorage.removeItem(storageKey);
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
            <a href="#/profile" className="security-back">
                <ArrowLeft size={16} aria-hidden="true" />
                {tx("账户设置")}
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
        </section>
    );
}
