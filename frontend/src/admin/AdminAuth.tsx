import { useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PasskeyLogin } from "../shared/PasskeyLogin";
import { admin, logoutSession, navigate, request, type Row } from "../shared/api";
import { MfaLogin } from "../shared/MfaLogin";
import { useCooldown } from "../shared/useCooldown";
import type { V10MfaChallenge } from "../shared/v10-types";
import { WorkspaceAccess } from "./WorkspaceAccess";

function messageFor(error: unknown, fallback: string): string {
    const reason = error as { status?: number; code?: string } | null;
    if (reason?.status === 429) return "Too many attempts. Try again later.";
    if (reason?.code === "NETWORK_ERROR" || reason?.code === "REQUEST_TIMEOUT")
        return "Check your connection and try again.";
    return fallback;
}

export function AdminAuth({
    mode,
    notice,
    onLogin,
}: {
    mode: string;
    notice?: string;
    onLogin: (user: Row) => void | boolean | Promise<boolean>;
}) {
    const forget = mode === "forget";
    const [mfa, setMfa] = useState<V10MfaChallenge | null>(null);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const passwordId = useId();
    const savingLock = useRef(false);
    const sendingLock = useRef(false);
    const email = useRef<HTMLInputElement>(null);
    const cooldown = useCooldown();

    async function completeLogin() {
        try {
            await request(admin("config/fetch"));
        } catch (error) {
            await logoutSession();
            throw error;
        }
        const info = await request("user/info");
        if (await onLogin(info.data) !== false) navigate("overview");
    }

    function validEmail() {
        const input = email.current;
        if (input?.validity.valid) return true;
        setError("Enter a valid email address.");
        input?.focus();
        return false;
    }

    async function sendCode() {
        if (savingLock.current || sendingLock.current || cooldown.active || !validEmail()) return;
        sendingLock.current = true;
        setSending(true);
        setError("");
        try {
            await request("passport/comm/sendEmailVerify", { email: email.current!.value, isforget: 1 });
            cooldown.start();
        } catch (reason) {
            setError(messageFor(reason, "Could not send a code. Check the email address and try again."));
        } finally {
            sendingLock.current = false;
            setSending(false);
        }
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (savingLock.current || sendingLock.current || !validEmail()) return;
        const form = event.currentTarget;
        const password = form.elements.namedItem("password") as HTMLInputElement;
        if (!password.value || (forget && [...password.value].length < 8)) {
            setError(forget ? "Enter a new password with at least 8 characters." : "Enter your password.");
            password.focus();
            return;
        }
        const body = Object.fromEntries(new FormData(form));
        if (forget && !/^\d{6}$/.test(String(body.email_code ?? ""))) {
            setError("Enter the 6-digit verification code.");
            (form.elements.namedItem("email_code") as HTMLInputElement).focus();
            return;
        }
        savingLock.current = true;
        setSaving(true);
        setError("");
        try {
            if (forget) {
                await request("passport/auth/forget", body);
                navigate("login");
                return;
            }
            const login = await request("passport/auth/login", body);
            if (login.data.mfaRequired) {
                setMfa(login.data as V10MfaChallenge);
                return;
            }
            await completeLogin();
        } catch (reason) {
            setError(messageFor(reason, forget
                ? "Unable to reset your password. Check your code and try again."
                : "Unable to sign in. Check your email and password, then try again."));
        } finally {
            savingLock.current = false;
            setSaving(false);
        }
    }

    return (
        <WorkspaceAccess>
            {mfa ? (
                <MfaLogin
                    challenge={mfa}
                    onCancel={() => setMfa(null)}
                    onComplete={completeLogin}
                    description="Complete verification to continue."
                    formatError={messageFor}
                />
            ) : (
                <>
                    <h1>{forget ? "Reset your password" : "Sign in"}</h1>
                    <p className="workspace-access-intro">
                        {forget ? "Use a code sent to your email to set a new password." : "Continue to your workspace."}
                    </p>
                    {notice && <p className="alert" role="status">{notice}</p>}
                    <form className="workspace-access-form" noValidate aria-busy={saving || sending} onSubmit={(event) => void submit(event)}>
                        {error && <p className="alert" role="alert">{error}</p>}
                        <label>
                            Email address
                            <input ref={email} type="email" name="email" autoComplete="email" required disabled={saving} />
                        </label>
                        {forget && (
                            <div className="workspace-access-code">
                                <label>
                                    Verification code
                                    <input name="email_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required disabled={saving} />
                                </label>
                                <button type="button" disabled={saving || sending || cooldown.active} onClick={() => void sendCode()}>
                                    {sending ? "Sending…" : cooldown.active ? `Resend in ${cooldown.remaining}s` : "Send code"}
                                </button>
                            </div>
                        )}
                        <div className="workspace-access-password">
                            <label htmlFor={passwordId}>{forget ? "New password" : "Password"}</label>
                            <div>
                                <input id={passwordId} type={showPassword ? "text" : "password"} name="password"
                                    autoComplete={forget ? "new-password" : "current-password"} required disabled={saving} />
                                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"}
                                    aria-controls={passwordId} disabled={saving} onClick={() => setShowPassword(visible => !visible)}>
                                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                        <button type="submit" className="workspace-access-submit" disabled={saving || sending}>
                            {saving ? (forget ? "Resetting…" : "Signing in…") : (forget ? "Reset password" : "Sign in")}
                        </button>
                    </form>
                    {!forget && <PasskeyLogin onMfa={setMfa} onComplete={completeLogin} disabled={saving} formatError={messageFor} />}
                    <a className="workspace-access-link" href={forget ? "#/login" : "#/forget"}>
                        {forget ? "Back to sign in" : "Forgot your password?"}
                    </a>
                </>
            )}
        </WorkspaceAccess>
    );
}
