import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";
import { boot, request, storageKey, navigate, type Row } from "./api";
import { tx } from "./i18n";
import { ux } from "./ux";
import { e } from "./experience-copy";
import { passwordScore } from "./user-experience";

export function UserAuth({
    mode,
    onLogin,
    renderCaptcha,
}: {
    mode: string;
    onLogin: (user: Row) => void;
    renderCaptcha: (onChange: (value: string) => void) => ReactNode;
}) {
    const register = mode === "register",
        forget = mode === "forget",
        verify = forget || (register && boot.emailVerify);
    const [challenge, setChallenge] = useState(0),
        [registered, setRegistered] = useState(false),
        [step, setStep] = useState(1),
        [email, setEmail] = useState(""),
        [password, setPassword] = useState(""),
        [code, setCode] = useState(""),
        [captcha, setCaptcha] = useState(""),
        [reveal, setReveal] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [cooldown, setCooldown] = useState(0),
        [sent, setSent] = useState(false),
        [done, setDone] = useState(false);
    const [invite, setInvite] = useState(
        () =>
            new URLSearchParams(location.hash.split("?")[1]).get("code") || "",
    );
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (!cooldown) return;
        const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);
    useEffect(() => {
        heading.current?.focus();
    }, [step]);
    const score = passwordScore(password);
    const title =
        step === 2
            ? verify
                ? e("verify")
                : e("review")
            : forget
              ? tx("重置密码")
              : register
                ? tx("创建账户")
                : tx("欢迎回来");
    async function sendCode() {
        if (boot.recaptchaSiteKey && !captcha)
            throw new Error(tx("请先完成安全验证"));
        await request("passport/comm/sendEmailVerify", {
            email: email.trim(),
            isforget: forget ? 1 : 0,
            recaptcha_data: captcha,
        });
        setSent(true);
        setCooldown(60);
        if (boot.recaptchaSiteKey) {
            setCaptcha("");
            setChallenge((value) => value + 1);
        }
    }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            if (boot.recaptchaSiteKey && !captcha)
                throw new Error(tx("请先完成安全验证"));
            if ((register || forget) && step === 1) {
                if (verify) await sendCode();
                setStep(2);
                return;
            }
            const body = {
                email: email.trim(),
                password,
                email_code: code,
                invite_code: invite.trim(),
                recaptcha_data: captcha,
            };
            if (forget) {
                await request("passport/auth/forget", body);
                setPassword("");
                setCode("");
                setDone(true);
                return;
            }
            if (register && !registered) {
                await request("passport/auth/register", body);
                setRegistered(true);
            }
            const result = await request("passport/auth/login", {
                email: email.trim(),
                password,
                recaptcha_data: captcha,
            });
            localStorage.setItem(storageKey, result.data.auth_data);
            const info = await request("user/info");
            onLogin(info.data);
            navigate("dashboard");
        } catch (reason) {
            setError((reason as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const passwordField = (
        <label className="auth-field">
            <span>{forget ? tx("新密码") : tx("密码")}</span>
            <div className="auth-password">
                <input
                    required
                    aria-label={forget ? tx("新密码") : tx("密码")}
                    type={reveal ? "text" : "password"}
                    minLength={register || forget ? 8 : undefined}
                    maxLength={forget ? 64 : undefined}
                    value={password}
                    autoComplete={
                        register || forget ? "new-password" : "current-password"
                    }
                    onChange={(event) => setPassword(event.target.value)}
                />
                <button
                    type="button"
                    aria-label={ux(reveal ? "hidePassword" : "showPassword")}
                    aria-pressed={reveal}
                    onClick={() => setReveal(!reveal)}
                >
                    {reveal ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
            </div>
            {(register || forget) && (
                <>
                    <div className="password-meter-title">
                        <span>{e("strength")}</span>
                        <span>
                            {e(
                                score >= 4
                                    ? "strong"
                                    : score >= 2
                                      ? "fair"
                                      : "weak",
                            )}
                        </span>
                    </div>
                    <div
                        className="password-meter"
                        role="meter"
                        aria-label={e("strength")}
                        aria-valuemin={0}
                        aria-valuemax={5}
                        aria-valuenow={score}
                    >
                        {[1, 2, 3, 4, 5].map((segment) => (
                            <i
                                key={segment}
                                className={segment <= score ? "filled" : ""}
                            />
                        ))}
                    </div>
                    <small>{e("passwordHelp")}</small>
                </>
            )}
        </label>
    );
    return (
        <div className="user-auth">
            <a className="auth-home" href="/">
                <Sparkles size={22} />
                <strong>{boot.title}</strong>
            </a>
            <div className="user-auth-layout">
                <section className="user-auth-intro">
                    <span className="eyebrow">AI SETUP COMPANION</span>
                    <h1>{e("authIntro")}</h1>
                    <p>{e("authDetail")}</p>
                    <div className="auth-illustration" aria-hidden="true">
                        <Sparkles size={42} />
                        <span>AI</span>
                    </div>
                </section>
                <section className="user-auth-card">
                    <div className="auth-title-row">
                        <h2 ref={heading} tabIndex={-1}>
                            {title}
                        </h2>
                        {(register || forget) && !done && (
                            <span className="auth-step-count">{step} / 2</span>
                        )}
                    </div>
                    {done ? (
                        <div className="auth-complete" role="status">
                            <CheckCircle2 size={36} />
                            <p>{e("resetDone")}</p>
                            <a className="button primary" href="#/login">
                                {tx("登录")}
                            </a>
                        </div>
                    ) : (
                        <>
                            <p className="muted">
                                {step === 2
                                    ? verify
                                        ? e("verifyHelp")
                                        : e("review")
                                    : forget
                                      ? tx("使用邮箱验证码设置新密码")
                                      : register
                                        ? e("stepAccount")
                                        : tx("登录以管理你的订阅与账户")}
                            </p>
                            {register && boot.registerClosed ? (
                                <p role="alert">{e("registerClosed")}</p>
                            ) : (
                                <form
                                    className="user-auth-form"
                                    onSubmit={submit}
                                    aria-busy={busy}
                                >
                                    <fieldset disabled={busy}>
                                        {step === 1 ? (
                                            <>
                                                <label className="auth-field">
                                                    <span>
                                                        {tx("邮箱地址")}
                                                    </span>
                                                    <input
                                                        type="email"
                                                        autoComplete="email"
                                                        inputMode="email"
                                                        required
                                                        value={email}
                                                        maxLength={
                                                            forget
                                                                ? 64
                                                                : undefined
                                                        }
                                                        onChange={(event) =>
                                                            setEmail(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        placeholder="you@example.com"
                                                    />
                                                </label>
                                                {!forget && passwordField}
                                                {register && (
                                                    <details open={!!invite}>
                                                        <summary>
                                                            {tx(
                                                                "邀请码（可选）",
                                                            )}
                                                        </summary>
                                                        <label className="auth-field">
                                                            <span>
                                                                {tx(
                                                                    "邀请码（可选）",
                                                                )}
                                                            </span>
                                                            <input
                                                                value={invite}
                                                                autoComplete="off"
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setInvite(
                                                                        event
                                                                            .target
                                                                            .value,
                                                                    )
                                                                }
                                                            />
                                                        </label>
                                                    </details>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <div className="auth-account-review">
                                                    <strong dir="ltr">
                                                        {email}
                                                    </strong>
                                                    <button
                                                        type="button"
                                                        disabled={registered}
                                                        className="text-button"
                                                        onClick={() => {
                                                            setStep(1);
                                                            setError("");
                                                            setCode("");
                                                        }}
                                                    >
                                                        <ArrowLeft size={15} />
                                                        {e("edit")}
                                                    </button>
                                                </div>
                                                {verify && (
                                                    <label className="auth-field">
                                                        <span>
                                                            {tx("邮箱验证码")}
                                                        </span>
                                                        <div className="auth-code-row">
                                                            <input
                                                                aria-label={tx(
                                                                    "邮箱验证码",
                                                                )}
                                                                inputMode="numeric"
                                                                autoComplete="one-time-code"
                                                                type="text"
                                                                pattern="[0-9]{6}"
                                                                minLength={6}
                                                                maxLength={6}
                                                                required
                                                                value={code}
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setCode(
                                                                        event.target.value.replace(
                                                                            /\D/g,
                                                                            "",
                                                                        ),
                                                                    )
                                                                }
                                                                placeholder="000000"
                                                            />
                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    cooldown >
                                                                        0 ||
                                                                    busy
                                                                }
                                                                onClick={async () => {
                                                                    setBusy(
                                                                        true,
                                                                    );
                                                                    setError(
                                                                        "",
                                                                    );
                                                                    try {
                                                                        await sendCode();
                                                                    } catch (reason) {
                                                                        setError(
                                                                            (
                                                                                reason as Error
                                                                            )
                                                                                .message,
                                                                        );
                                                                    } finally {
                                                                        setBusy(
                                                                            false,
                                                                        );
                                                                    }
                                                                }}
                                                            >
                                                                {cooldown
                                                                    ? tx(
                                                                          "{{value0}} 秒后重试",
                                                                          {
                                                                              value0: cooldown,
                                                                          },
                                                                      )
                                                                    : tx(
                                                                          "发送邮箱验证码",
                                                                      )}
                                                            </button>
                                                        </div>
                                                        <small>
                                                            {e("codeExpiry")}
                                                        </small>
                                                    </label>
                                                )}
                                                {forget && passwordField}
                                                {sent && (
                                                    <p
                                                        className="auth-sent"
                                                        role="status"
                                                    >
                                                        <CheckCircle2
                                                            size={17}
                                                        />
                                                        {e("sent", { email })}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                        {boot.recaptchaSiteKey && (
                                            <div key={challenge}>
                                                {renderCaptcha(setCaptcha)}
                                            </div>
                                        )}
                                        {error && (
                                            <div className="alert" role="alert">
                                                {error}
                                            </div>
                                        )}
                                        {register &&
                                            boot.tosUrl &&
                                            step === 2 && (
                                                <label className="auth-terms">
                                                    <input
                                                        type="checkbox"
                                                        required
                                                    />
                                                    {tx("注册即表示同意")}{" "}
                                                    <a
                                                        href={boot.tosUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        {tx("服务条款")}
                                                    </a>
                                                </label>
                                            )}
                                        <button
                                            className="primary auth-submit"
                                            type="submit"
                                            disabled={busy}
                                        >
                                            {busy ? (
                                                <>
                                                    <span className="spinner" />
                                                    {tx("正在加载…")}
                                                </>
                                            ) : step === 1 &&
                                              (register || forget) ? (
                                                e("next")
                                            ) : forget ? (
                                                tx("重置密码")
                                            ) : register ? (
                                                verify ? (
                                                    e("create")
                                                ) : (
                                                    tx("注册账户")
                                                )
                                            ) : (
                                                tx("登录")
                                            )}
                                        </button>
                                    </fieldset>
                                </form>
                            )}
                            {register && (
                                <p className="auth-free">{e("freeRegister")}</p>
                            )}
                            <div className="auth-links">
                                {mode !== "login" && (
                                    <a href="#/login">{tx("登录")}</a>
                                )}
                                {!register && !boot.registerClosed && (
                                    <a href="#/register">{tx("创建账户")}</a>
                                )}
                                {!forget && (
                                    <a href="#/forget">{tx("忘记密码？")}</a>
                                )}
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
