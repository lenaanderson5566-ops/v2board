import { useMfaRecovery } from "./MfaRecovery";
import type {
    V10MfaPurpose,
    V10MfaSetup,
    V10MfaSettingsResult,
} from "./v10-types";
import { useCooldown } from "./useCooldown";
import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Mail, Smartphone } from "lucide-react";
import { request } from "./api";
import { Modal, State, useData } from "./ui";
import { tx } from "./i18n";
import {
    mfaState,
    mfaStart,
    mfaFinish,
    sendMfaEmail,
    type V10MfaState,
} from "./mfa-api";

type Purpose = V10MfaPurpose;
type Setup = V10MfaSetup;
const purposeTitles: Record<Purpose, string> = {
    enableEmail: "开启邮件验证",
    disableEmail: "关闭邮件验证",
    setupTotp: "开启身份验证器",
    replaceTotp: "更换身份验证器",
    disableTotp: "关闭身份验证器",
    recoveryCodes: "重新生成恢复码",
};
export function MfaSecurity({
    onSessionsRevoked,
}: { onSessionsRevoked?: () => void } = {}) {
    const completeMfa = useMfaRecovery();
    const state = useData<V10MfaState>(mfaState(), undefined, false, {
        refreshOnEvents: false,
    });
    const [purpose, setPurpose] = useState<Purpose | null>(null),
        [password, setPassword] = useState(""),
        [currentCode, setCurrentCode] = useState(""),
        [method, setMethod] = useState<"totp" | "recovery">("totp");
    const [setup, setSetup] = useState<Setup | null>(null),
        [emailCode, setEmailCode] = useState(""),
        [totpCode, setTotpCode] = useState("");
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [sent, setSent] = useState(false);
    const cooldown = useCooldown();
    const lock = useRef(false);
    function close() {
        setPurpose(null);
        setSetup(null);
        setPassword("");
        setCurrentCode("");
        setMethod("totp");
        setEmailCode("");
        setTotpCode("");
        setError("");
        setSent(false);
        cooldown.reset();
    }
    async function run(operation: () => Promise<void>) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await operation();
        } catch (error) {
            setError((error as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    if (!state.data && !state.error) return null;
    if (state.data && !state.data.enrollmentEnabled && !state.data.emailEnabled && !state.data.totpEnabled) return null;
    return (
        <section className="panel mfa-security">
            <div className="panel-head">
                <h2>
                    <ShieldCheck size={20} aria-hidden="true" />
                    {tx("多重身份验证")}
                </h2>
            </div>
            <div className="pad">
                <p>
                    {tx(
                        "安全验证为可选项，默认关闭。邮件与身份验证器可同时开启，登录时优先使用身份验证器。",
                    )}
                </p>
                {error && !purpose && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <State {...state} retry={state.reload}>
                    {state.data && (
                        <>
                            <div className="mfa-options">
                                <div>
                                    <h3>
                                        <Mail size={20} aria-hidden="true" />
                                        {tx("邮件登录验证")}
                                    </h3>
                                    <p
                                        className={
                                            state.data.emailEnabled
                                                ? "mfa-state enabled"
                                                : "mfa-state"
                                        }
                                    >
                                        {tx(
                                            state.data.emailEnabled
                                                ? "已开启"
                                                : "未开启",
                                        )}
                                    </p>
                                    <p className="mfa-help">
                                        {tx("登录时验证账号邮箱中的验证码。")}
                                    </p>
                                    {(state.data.enrollmentEnabled || state.data.emailEnabled) && <button
                                        disabled={busy || purpose !== null}
                                        onClick={() => {
                                            close();
                                            setPurpose(
                                                state.data!.emailEnabled
                                                    ? "disableEmail"
                                                    : "enableEmail",
                                            );
                                        }}
                                    >
                                        {tx(
                                            state.data.emailEnabled
                                                ? "关闭邮件验证"
                                                : "开启邮件验证",
                                        )}
                                    </button>}
                                </div>
                                <div>
                                    <h3>
                                        <Smartphone
                                            size={20}
                                            aria-hidden="true"
                                        />
                                        {tx("身份验证器 TOTP")}
                                    </h3>
                                    <p
                                        className={
                                            state.data.totpEnabled
                                                ? "mfa-state enabled"
                                                : "mfa-state"
                                        }
                                    >
                                        {tx(
                                            state.data.totpEnabled
                                                ? "已开启"
                                                : "未开启",
                                        )}
                                    </p>
                                    <p className="mfa-help">
                                        {tx(
                                            "使用身份验证器生成动态码，无需等待邮件。",
                                        )}
                                    </p>
                                    {state.data.totpEnabled && (
                                        <p>
                                            {tx("剩余恢复码：{{value0}}", {
                                                value0: state.data
                                                    .recoveryCodesRemaining,
                                            })}
                                        </p>
                                    )}
                                    {state.data.totpEnabled ? (
                                        <div className="actions">
                                            {(
                                                [
                                                    "replaceTotp",
                                                    "disableTotp",
                                                    "recoveryCodes",
                                                ] as const
                                            ).map((action) => (
                                                <button
                                                    key={action}
                                                    disabled={
                                                        busy || purpose !== null
                                                    }
                                                    onClick={() => {
                                                        close();
                                                        setPurpose(action);
                                                    }}
                                                >
                                                    {tx(
                                                        {
                                                            replaceTotp:
                                                                "更换身份验证器",
                                                            disableTotp:
                                                                "关闭身份验证器",
                                                            recoveryCodes:
                                                                "重新生成恢复码",
                                                        }[action],
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    ) : state.data.enrollmentEnabled ? (
                                        <button
                                            disabled={busy || purpose !== null}
                                            onClick={() => {
                                                close();
                                                setPurpose("setupTotp");
                                            }}
                                        >
                                            {tx("开启身份验证器")}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            {purpose && (
                                <Modal
                                    title={tx(purposeTitles[purpose])}
                                    variant="modal"
                                    initialFocus="input:not([readonly])"
                                    dismissible={!busy}
                                    className="mfa-setup-dialog mfa-security"
                                    close={() => {
                                        if (!lock.current) close();
                                    }}
                                >
                                    <div className="pad">
                                        {error && (
                                            <p className="alert" role="alert">
                                                {error}
                                            </p>
                                        )}
                                        {purpose && (
                                            <ol
                                                className="mfa-progress"
                                                aria-label={tx("安全验证步骤")}
                                            >
                                                {[
                                                    "确认身份",
                                                    "确认更新安全验证",
                                                    ...([
                                                        "setupTotp",
                                                        "replaceTotp",
                                                        "recoveryCodes",
                                                    ].includes(purpose || "")
                                                        ? ["保存恢复码"]
                                                        : ["重新登录"]),
                                                ].map((step, index) => (
                                                    <li
                                                        key={step}
                                                        aria-current={
                                                            index ===
                                                            (setup ? 1 : 0)
                                                                ? "step"
                                                                : undefined
                                                        }
                                                    >
                                                        <span aria-hidden="true">
                                                            {index + 1}
                                                        </span>
                                                        {tx(step)}
                                                    </li>
                                                ))}
                                            </ol>
                                        )}
                                        {purpose && !setup && (
                                            <form
                                                className="mfa-step"
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    void run(async () => {
                                                        const response =
                                                            await request<Setup>(
                                                                mfaStart(),
                                                                {
                                                                    purpose,
                                                                    password,
                                                                    verificationCode:
                                                                        currentCode,
                                                                    verificationMethod:
                                                                        method,
                                                                },
                                                            );
                                                        setPassword("");
                                                        setCurrentCode("");
                                                        setSetup(response.data);
                                                    });
                                                }}
                                            >
                                                <h3>{tx("确认身份")}</h3>
                                                <p>
                                                    {tx(
                                                        "修改安全验证需要当前密码及已启用的验证方式。",
                                                    )}
                                                </p>
                                                <label>
                                                    {tx("当前密码")}
                                                    <input
                                                        type="password"
                                                        required
                                                        autoComplete="current-password"
                                                        maxLength={128}
                                                        value={password}
                                                        onChange={(event) =>
                                                            setPassword(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        disabled={busy}
                                                    />
                                                </label>
                                                {state.data.totpEnabled && (
                                                    <>
                                                        <label>
                                                            {tx("验证方式")}
                                                            <select
                                                                value={method}
                                                                disabled={busy}
                                                                onChange={(
                                                                    event,
                                                                ) => {
                                                                    setMethod(
                                                                        event
                                                                            .target
                                                                            .value as typeof method,
                                                                    );
                                                                    setCurrentCode(
                                                                        "",
                                                                    );
                                                                }}
                                                            >
                                                                <option value="totp">
                                                                    {tx(
                                                                        "身份验证器",
                                                                    )}
                                                                </option>
                                                                <option value="recovery">
                                                                    {tx(
                                                                        "恢复码",
                                                                    )}
                                                                </option>
                                                            </select>
                                                        </label>
                                                        <label>
                                                            {tx(
                                                                method ===
                                                                    "recovery"
                                                                    ? "恢复码"
                                                                    : "当前动态码",
                                                            )}
                                                            <input
                                                                className={
                                                                    method ===
                                                                    "recovery"
                                                                        ? "mfa-code mfa-code-recovery"
                                                                        : "mfa-code"
                                                                }
                                                                inputMode={
                                                                    method ===
                                                                    "recovery"
                                                                        ? "text"
                                                                        : "numeric"
                                                                }
                                                                pattern={
                                                                    method ===
                                                                    "recovery"
                                                                        ? undefined
                                                                        : "[0-9]{6}"
                                                                }
                                                                dir="ltr"
                                                                required
                                                                autoComplete="one-time-code"
                                                                maxLength={
                                                                    method ===
                                                                    "recovery"
                                                                        ? 40
                                                                        : 6
                                                                }
                                                                value={
                                                                    currentCode
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setCurrentCode(
                                                                        method ===
                                                                            "recovery"
                                                                            ? event
                                                                                  .target
                                                                                  .value
                                                                            : event.target.value.replace(
                                                                                  /\s/g,
                                                                                  "",
                                                                              ),
                                                                    )
                                                                }
                                                                disabled={busy}
                                                            />
                                                        </label>
                                                    </>
                                                )}
                                                <div className="actions">
                                                    <button
                                                        className="primary"
                                                        disabled={busy}
                                                    >
                                                        {tx("继续")}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={close}
                                                    >
                                                        {tx("取消")}
                                                    </button>
                                                </div>
                                            </form>
                                        )}
                                        {setup && (
                                            <form
                                                className="mfa-step"
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    void run(async () => {
                                                        const response =
                                                            await request<V10MfaSettingsResult>(
                                                                mfaFinish(),
                                                                {
                                                                    challengeId:
                                                                        setup.challengeId,
                                                                    emailCode,
                                                                    totpCode,
                                                                },
                                                            );
                                                        setSetup(null);
                                                        setPurpose(null);
                                                        setEmailCode("");
                                                        setTotpCode("");
                                                        completeMfa(
                                                            response.data
                                                                .recoveryCodes ||
                                                                [],
                                                        );
                                                        onSessionsRevoked?.();
                                                    });
                                                }}
                                            >
                                                {setup.otpauthUri && (
                                                    <>
                                                        <h3>
                                                            {tx(
                                                                "添加到身份验证器",
                                                            )}
                                                        </h3>
                                                        <p>
                                                            {tx(
                                                                "使用身份验证器扫描二维码，或手动输入密钥，然后填写新动态码。",
                                                            )}
                                                        </p>
                                                        <div className="mfa-qr">
                                                            <QRCodeSVG
                                                                value={
                                                                    setup.otpauthUri
                                                                }
                                                                size={180}
                                                            />
                                                        </div>
                                                        <label>
                                                            {tx("设置密钥")}
                                                            <input
                                                                readOnly
                                                                value={
                                                                    setup.secret
                                                                }
                                                                autoComplete="off"
                                                                dir="ltr"
                                                            />
                                                        </label>
                                                        <label>
                                                            {tx("新动态码")}
                                                            <input
                                                                className="mfa-code"
                                                                autoFocus
                                                                dir="ltr"
                                                                required
                                                                inputMode="numeric"
                                                                pattern="[0-9]{6}"
                                                                maxLength={12}
                                                                autoComplete="one-time-code"
                                                                value={totpCode}
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setTotpCode(
                                                                        event.target.value.replace(
                                                                            /\s/g,
                                                                            "",
                                                                        ),
                                                                    )
                                                                }
                                                                disabled={busy}
                                                            />
                                                        </label>
                                                    </>
                                                )}
                                                {setup.emailRequired && (
                                                    <>
                                                        <label>
                                                            {tx("邮箱验证码")}
                                                            <input
                                                                className="mfa-code"
                                                                dir="ltr"
                                                                required
                                                                inputMode="numeric"
                                                                pattern="[0-9]{6}"
                                                                maxLength={12}
                                                                autoComplete="one-time-code"
                                                                value={
                                                                    emailCode
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setEmailCode(
                                                                        event.target.value.replace(
                                                                            /\s/g,
                                                                            "",
                                                                        ),
                                                                    )
                                                                }
                                                                disabled={busy}
                                                            />
                                                        </label>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                busy ||
                                                                cooldown.active
                                                            }
                                                            onClick={() =>
                                                                void run(
                                                                    async () => {
                                                                        if (
                                                                            cooldown.active
                                                                        )
                                                                            throw new Error(
                                                                                tx(
                                                                                    "请等待60秒后重新发送。",
                                                                                ),
                                                                            );
                                                                        await sendMfaEmail(
                                                                            setup.challengeId,
                                                                        );
                                                                        setSent(
                                                                            true,
                                                                        );
                                                                        cooldown.start();
                                                                    },
                                                                )
                                                            }
                                                        >
                                                            {cooldown.active
                                                                ? tx(
                                                                      "{{value0}}秒后重试",
                                                                      {
                                                                          value0: cooldown.remaining,
                                                                      },
                                                                  )
                                                                : tx(
                                                                      sent
                                                                          ? "重新发送验证码"
                                                                          : "发送邮箱验证码",
                                                                  )}
                                                        </button>
                                                        {sent && (
                                                            <p role="status">
                                                                {tx(
                                                                    "验证码已发送，60秒后可以重新发送。",
                                                                )}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                                <p>
                                                    {tx(
                                                        "更新后所有登录会话将退出。新恢复码会使旧恢复码失效。",
                                                    )}
                                                </p>
                                                <div className="actions">
                                                    <button
                                                        className="primary"
                                                        disabled={busy}
                                                    >
                                                        {tx("确认更新安全验证")}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={close}
                                                    >
                                                        {tx("取消")}
                                                    </button>
                                                </div>
                                            </form>
                                        )}
                                    </div>
                                </Modal>
                            )}
                        </>
                    )}
                </State>
            </div>
        </section>
    );
}
