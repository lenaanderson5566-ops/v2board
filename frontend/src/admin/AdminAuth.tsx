import { useEffect, useRef, useState } from "react";
import { Sparkles, Globe, ArrowUpRight } from "lucide-react";
import {
    boot,
    request,
    admin,
    storageKey,
    navigate,
    type Row,
} from "../shared/api";
import { Editor, type Field } from "../shared/ui";
import { tx } from "../shared/i18n";
import { Captcha } from "../shared/Captcha";
export function AdminAuth({
    mode,
    onLogin,
}: {
    mode: string;
    onLogin: (user: Row) => void;
}) {
    const register = mode === "register" && boot.mode === "user",
        forget = mode === "forget";
    const [captcha, setCaptcha] = useState(""),
        [mailError, setMailError] = useState(""),
        [sending, setSending] = useState(false),
        [cooldown, setCooldown] = useState(0);
    const formRef = useRef<HTMLDivElement>(null);
    const fields: Field[] = [
        {
            key: "email",
            label: tx("邮箱地址"),
            type: "email",
            autoComplete: "email",
            required: true,
        },
        {
            key: "password",
            label: forget ? tx("新密码") : tx("密码"),
            type: "password",
            autoComplete:
                register || forget ? "new-password" : "current-password",
            required: true,
        },
        ...(register
            ? [{ key: "invite_code", label: tx("邀请码（可选）") } as Field]
            : []),
        ...(forget || (register && boot.emailVerify)
            ? [
                  {
                      key: "email_code",
                      label: tx("邮箱验证码"),
                      required: true,
                  } as Field,
              ]
            : []),
    ];
    useEffect(() => {
        if (!cooldown) return;
        const t = setTimeout(() => setCooldown((v) => v - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);
    return (
        <div className="auth-layout">
            <section className="auth-brand">
                <a className="brand" href="/">
                    <span className="brand-mark">
                        <Sparkles size={19} aria-hidden="true" />
                    </span>
                    {boot.title}
                </a>
                <div>
                    <span className="eyebrow">A BETTER WAY TO CONNECT</span>
                    <h1>
                        {tx("更自由的连接。")}
                        <br />
                        {tx("更简单的体验。")}
                    </h1>
                    <p>
                        {boot.description ||
                            tx("你的网络服务，在一个地方轻松管理。")}
                    </p>
                    <div className="auth-orbits">
                        <Globe size={160} strokeWidth={0.65} />
                    </div>
                </div>
                <small>{tx("连接 · 探索 · 发现")}</small>
            </section>
            <section className="auth-form">
                <div className="auth-box" ref={formRef}>
                    <span className="eyebrow">
                        {boot.mode === "admin" ? "ADMIN CONSOLE" : "WELCOME"}
                    </span>
                    <h2>
                        {forget
                            ? tx("重置密码")
                            : register
                              ? tx("创建账户")
                              : boot.mode === "admin"
                                ? boot.title
                                : tx("欢迎回来")}
                    </h2>
                    <p className="muted">
                        {boot.mode === "admin"
                            ? tx("登录统一管理后台")
                            : forget
                              ? tx("使用邮箱验证码设置新密码")
                              : tx("登录以管理你的订阅与账户")}
                    </p>
                    <Editor
                        key={mode}
                        fields={
                            boot.mode === "admin"
                                ? fields.map((field) => ({
                                      ...field,
                                      placeholder: field.label,
                                  }))
                                : fields
                        }
                        initial={{
                            invite_code:
                                new URLSearchParams(
                                    location.hash.split("?")[1],
                                ).get("code") || "",
                        }}
                        submit={
                            forget
                                ? tx("重置密码")
                                : register
                                  ? tx("注册账户")
                                  : tx("登录")
                        }
                        onSave={async (body) => {
                            if (boot.recaptchaSiteKey && !captcha)
                                throw new Error(tx("请先完成安全验证"));
                            if (forget) {
                                await request("passport/auth/forget", {
                                    ...body,
                                    recaptcha_data: captcha,
                                });
                                navigate("login");
                                return;
                            }
                            if (register)
                                await request("passport/auth/register", {
                                    ...body,
                                    recaptcha_data: captcha,
                                });
                            const r = await request("passport/auth/login", {
                                email: body.email,
                                password: body.password,
                                recaptcha_data: captcha,
                            });
                            localStorage.setItem(storageKey, r.data.auth_data);
                            if (boot.mode === "admin") {
                                try {
                                    await request(admin("config/fetch"));
                                } catch (e) {
                                    localStorage.removeItem(storageKey);
                                    throw e;
                                }
                            }
                            const info = await request("user/info");
                            onLogin(info.data);
                            navigate(
                                boot.mode === "admin"
                                    ? "overview"
                                    : "dashboard",
                            );
                        }}
                    >
                        <Captcha onChange={setCaptcha} />
                        {(forget || (register && boot.emailVerify)) && (
                            <>
                                <button
                                    type="button"
                                    disabled={sending || cooldown > 0}
                                    onClick={async () => {
                                        setMailError("");
                                        setSending(true);
                                        try {
                                            const email =
                                                formRef.current?.querySelector<HTMLInputElement>(
                                                    "input",
                                                )?.value;
                                            if (!email)
                                                throw new Error(
                                                    tx("请填写邮箱"),
                                                );
                                            await request(
                                                "passport/comm/sendEmailVerify",
                                                {
                                                    email,
                                                    isforget: forget ? 1 : 0,
                                                    recaptcha_data: captcha,
                                                },
                                            );
                                            setCooldown(60);
                                        } catch (e) {
                                            setMailError((e as Error).message);
                                        } finally {
                                            setSending(false);
                                        }
                                    }}
                                >
                                    {cooldown
                                        ? tx("{{value0}} 秒后重试", {
                                              value0: cooldown,
                                          })
                                        : sending
                                          ? tx("发送中…")
                                          : tx("发送邮箱验证码")}
                                </button>
                                {mailError && (
                                    <div className="alert">{mailError}</div>
                                )}
                            </>
                        )}
                    </Editor>
                    {boot.mode === "admin" && (
                        <div className="auth-links">
                            <a href={forget ? "#/login" : "#/forget"}>
                                {forget ? tx("登录") : tx("忘记密码？")}
                            </a>
                        </div>
                    )}
                    {boot.mode === "user" && (
                        <div className="auth-links">
                            <a href="#/login">{tx("登录")}</a>
                            {!boot.registerClosed && (
                                <a href="#/register">{tx("创建账户")}</a>
                            )}
                            <a href="#/forget">{tx("忘记密码？")}</a>
                        </div>
                    )}
                    {register && boot.tosUrl && (
                        <p className="muted">
                            {tx("注册即表示同意")}{" "}
                            <a
                                href={boot.tosUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {tx("服务条款")}
                            </a>
                            。
                        </p>
                    )}
                </div>
            </section>
        </div>
    );
}
