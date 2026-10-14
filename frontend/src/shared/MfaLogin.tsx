import type { MfaMethod } from "./v10-types";
import { useCooldown } from "./useCooldown";
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { request } from "./api";
import { tx } from "./i18n";
import { mfaFinish, sendMfaEmail, type V10MfaChallenge } from "./mfa-api";

export function MfaLogin({
    challenge,
    onComplete,
    onCancel,
}: {
    challenge: V10MfaChallenge;
    onComplete: () => Promise<void>;
    onCancel: () => void;
}) {
    const [method, setMethod] = useState<MfaMethod>(challenge.preferredMethod),
        [code, setCode] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [sent, setSent] = useState(false);
    const cooldown = useCooldown();
    const lock = useRef(false);
    const [verified, setVerified] = useState(false);
    async function send() {
        if (lock.current || cooldown.active) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await sendMfaEmail(challenge.challengeId);
            setSent(true);
            cooldown.start();
        } catch (error) {
            setError((error as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return (
        <section className="mfa-login panel pad">
            <ShieldCheck size={28} aria-hidden="true" />
            <h2>{tx("登录安全验证")}</h2>
            <p>{tx("密码已验证，请完成安全验证后继续。")}</p>
            {error && (
                <p role="alert" className="alert">
                    {error}
                </p>
            )}
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (lock.current) return;
                    lock.current = true;
                    setBusy(true);
                    setError("");
                    void (async () => {
                        try {
                            if (!verified) {
                                await request(mfaFinish(), {
                                    challengeId: challenge.challengeId,
                                    verificationMethod: method,
                                    verificationCode: code.trim(),
                                });
                                setVerified(true);
                            }
                            setCode("");
                            await onComplete();
                        } catch (error) {
                            setError((error as Error).message);
                        } finally {
                            lock.current = false;
                            setBusy(false);
                        }
                    })();
                }}
            >
                <label>
                    {tx("验证方式")}
                    <select
                        disabled={busy || verified}
                        value={method}
                        onChange={(event) => {
                            setMethod(event.target.value as typeof method);
                            setCode("");
                            setError("");
                        }}
                    >
                        {challenge.methods.map((option) => (
                            <option key={option} value={option}>
                                {tx(
                                    {
                                        totp: "身份验证器",
                                        email: "邮箱验证码",
                                        recovery: "恢复码",
                                    }[option],
                                )}
                            </option>
                        ))}
                    </select>
                </label>
                {method === "email" && !verified && (
                    <>
                        <button
                            type="button"
                            disabled={busy || cooldown.active}
                            onClick={() => void send()}
                        >
                            {tx(sent ? "重新发送验证码" : "发送验证码")}
                        </button>
                        {sent && (
                            <p role="status">
                                {tx("验证码已发送，60秒后可以重新发送。")}
                            </p>
                        )}
                    </>
                )}
                <label>
                    {tx(method === "recovery" ? "恢复码" : "验证码")}
                    <input
                        required={!verified}
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode={method === "recovery" ? "text" : "numeric"}
                        maxLength={method === "recovery" ? 40 : 6}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        disabled={busy || verified}
                        dir="ltr"
                        pattern={method === "recovery" ? undefined : "[0-9]{6}"}
                    />
                </label>
                <button className="primary" disabled={busy}>
                    {tx(verified ? "重试进入账户" : "验证并登录")}
                </button>
                <button type="button" disabled={busy} onClick={onCancel}>
                    {tx("返回登录")}
                </button>
            </form>
        </section>
    );
}
