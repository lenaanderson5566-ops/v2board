import { PasskeyLogin } from "../shared/PasskeyLogin";
import { useRef, useState } from "react";
import {
    boot,
    request,
    admin,
    logoutSession,
    navigate,
    type Row,
} from "../shared/api";
import { Editor, type Field } from "../shared/ui";
import { tx } from "../shared/i18n";
import { MfaLogin } from "../shared/MfaLogin";
import { useCooldown } from "../shared/useCooldown";
import type { V10MfaChallenge } from "../shared/v10-types";

export function AdminAuth({
    mode,
    onLogin,
}: {
    mode: string;
    onLogin: (user: Row) => void;
}) {
    const forget = mode === "forget";
    const [mfa, setMfa] = useState<V10MfaChallenge | null>(null),
        [mailError, setMailError] = useState(""),
        [sending, setSending] = useState(false);
    const formRef = useRef<HTMLDivElement>(null),
        sendingLock = useRef(false);
    const cooldown = useCooldown();
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
            autoComplete: forget ? "new-password" : "current-password",
            required: true,
        },
        ...(forget
            ? [
                  {
                      key: "email_code",
                      label: tx("邮箱验证码"),
                      required: true,
                  } as Field,
              ]
            : []),
    ];
    async function completeLogin() {
        try {
            await request(admin("config/fetch"));
        } catch (error) {
            await logoutSession();
            throw error;
        }
        const info = await request("user/info");
        onLogin(info.data);
        navigate("overview");
    }
    if (mfa)
        return (
            <div className="auth-layout">
                <MfaLogin
                    challenge={mfa}
                    onCancel={() => setMfa(null)}
                    onComplete={completeLogin}
                />
            </div>
        );
    return (
        <div className="auth-layout">
            <section className="auth-form">
                <div className="auth-box" ref={formRef}>
                    <span className="eyebrow">ADMIN CONSOLE</span>
                    <h2>{forget ? tx("重置密码") : boot.title}</h2>
                    <p className="muted">
                        {forget
                            ? tx("使用邮箱验证码设置新密码")
                            : tx("登录统一管理后台")}
                    </p>
                    {!forget && <PasskeyLogin onMfa={setMfa} onComplete={completeLogin} />}
                    <Editor
                        key={mode}
                        fields={fields.map((field) => ({
                            ...field,
                            placeholder: field.label,
                        }))}
                        initial={{}}
                        submit={forget ? tx("重置密码") : tx("登录")}
                        onSave={async (body) => {
                            if (forget) {
                                await request("passport/auth/forget", {
                                    ...body,
                                });
                                navigate("login");
                                return;
                            }
                            const login = await request("passport/auth/login", {
                                email: body.email,
                                password: body.password,
                            });
                            if (login.data.mfaRequired) {
                                setMfa(login.data as V10MfaChallenge);
                                return;
                            }
                            await completeLogin();
                        }}
                    >
                        {forget && (
                            <>
                                <button
                                    type="button"
                                    disabled={sending || cooldown.active}
                                    onClick={() => {
                                        if (
                                            sendingLock.current ||
                                            cooldown.active
                                        )
                                            return;
                                        sendingLock.current = true;
                                        setMailError("");
                                        setSending(true);
                                        void (async () => {
                                            try {
                                                const email =
                                                    formRef.current?.querySelector<HTMLInputElement>(
                                                        'input[type="email"]',
                                                    )?.value;
                                                if (!email)
                                                    throw new Error(
                                                        tx("请填写邮箱"),
                                                    );
                                                await request(
                                                    "passport/comm/sendEmailVerify",
                                                    {
                                                        email,
                                                        isforget: 1,
                                                    },
                                                );
                                                cooldown.start();
                                            } catch (error) {
                                                setMailError(
                                                    (error as Error).message,
                                                );
                                            } finally {
                                                sendingLock.current = false;
                                                setSending(false);
                                            }
                                        })();
                                    }}
                                >
                                    {tx(
                                        sending
                                            ? "发送中…"
                                            : cooldown.active
                                              ? "验证码已发送，60秒后可以重新发送。"
                                              : "发送邮箱验证码",
                                    )}
                                </button>
                                {mailError && (
                                    <p role="alert" className="alert">
                                        {mailError}
                                    </p>
                                )}
                            </>
                        )}
                    </Editor>
                    <div className="auth-links">
                        <a href={forget ? "#/login" : "#/forget"}>
                            {forget ? tx("登录") : tx("忘记密码？")}
                        </a>
                    </div>
                </div>
            </section>
        </div>
    );
}
