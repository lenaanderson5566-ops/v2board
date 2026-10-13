import { useEffect, useRef, useState } from "react";
import {
    Send,
    ShieldCheck,
    Link2,
    Unlink,
    RefreshCw,
    Users,
    CircleCheck,
    Clock3,
    ExternalLink,
    CircleAlert,
    LoaderCircle,
} from "lucide-react";
import { formatInstant } from "../shared/timezone";
import { request } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";

export function TelegramIntegration() {
    const d = useData("user/telegram/getBotInfo");
    const [busy, setBusy] = useState("");
    const inFlight = useRef(false);
    const [error, setError] = useState("");
    const [link, setLink] = useState<{
        url: string;
        expires: string;
        kind: "binding" | "group";
    } | null>(null);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!link) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [link]);
    async function act(path: string, body: Record<string, unknown> = {}) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(path);
        setError("");
        setLink(null);
        try {
            const result = await request(path, body);
            const url = result.data?.bindingUrl || result.data?.inviteUrl;
            if (url) {
                const parsed = new URL(url);
                const expires = result.data.expiresAt;
                if (
                    parsed.protocol !== "https:" ||
                    parsed.hostname !== "t.me" ||
                    parsed.username ||
                    parsed.password ||
                    parsed.port ||
                    !Number.isFinite(Date.parse(expires))
                )
                    throw new Error(tx("链接无效"));
                setNow(Date.now());
                setLink({
                    url: parsed.href,
                    expires,
                    kind: result.data.bindingUrl ? "binding" : "group",
                });
            }
            d.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            inFlight.current = false;
            setBusy("");
        }
    }
    const info = d.data;
    const pending = !!info?.pendingTelegramId && !info?.linked;
    const eligible = ["active", "grace"].includes(info?.eligibility);
    const activeLink =
        link &&
        ((link.kind === "binding" && !info?.linked && !pending) ||
            (link.kind === "group" &&
                info?.linked &&
                info?.groupManaged &&
                eligible))
            ? link
            : null;
    const expired = activeLink ? Date.parse(activeLink.expires) <= now : false;
    const disabled = !!busy || d.loading;
    const actionIcon = (path: string, Icon: typeof Link2) =>
        busy === path ? (
            <LoaderCircle className="tg-spin" aria-hidden="true" size={17} />
        ) : (
            <Icon aria-hidden="true" size={17} />
        );
    return (
        <Panel title="Telegram">
            <div className="pad telegram-integration" aria-busy={!!busy}>
                <div className="tg-intro">
                    <span className="tg-avatar">
                        <Send aria-hidden="true" size={24} />
                    </span>
                    <div>
                        <strong>{tx("账号绑定与用户群")}</strong>
                        <p className="muted">
                            {tx(
                                "在 Telegram 打开绑定链接后，请回到此页确认账号。无需发送密码或订阅链接。",
                            )}
                        </p>
                    </div>
                </div>
                <State {...d} retry={d.reload}>
                    {info && (
                        <>
                            <div
                                className={`tg-status ${info.linked ? "is-linked" : ""}`}
                            >
                                {info.linked ? (
                                    <CircleCheck aria-hidden="true" size={20} />
                                ) : (
                                    <Link2 aria-hidden="true" size={20} />
                                )}
                                <strong>
                                    {tx(
                                        info.linked
                                            ? "已绑定"
                                            : pending
                                              ? "请核对待绑定账号"
                                              : "尚未绑定 Telegram",
                                    )}
                                </strong>
                                {info.linked && (
                                    <span className="tg-id" dir="ltr">
                                        ID · {info.telegramId}
                                    </span>
                                )}
                            </div>
                            {!info.linked && (
                                <ol
                                    className="tg-steps"
                                    aria-label={tx("绑定步骤")}
                                >
                                    {[
                                        "获取绑定链接",
                                        "在 Telegram 中继续",
                                        "确认绑定此账号",
                                    ].map((label, index) => {
                                        const step = pending
                                            ? 2
                                            : activeLink && !expired
                                              ? 1
                                              : 0;
                                        return (
                                            <li
                                                key={label}
                                                className={
                                                    index === step
                                                        ? "is-current"
                                                        : index < step
                                                          ? "is-done"
                                                          : ""
                                                }
                                                aria-current={
                                                    index === step
                                                        ? "step"
                                                        : undefined
                                                }
                                            >
                                                <span aria-hidden="true">
                                                    {index < step ? (
                                                        <CircleCheck
                                                            size={16}
                                                        />
                                                    ) : (
                                                        index + 1
                                                    )}
                                                </span>
                                                {tx(label)}
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}
                            {pending && (
                                <div className="tg-confirm">
                                    <div className="tg-card-heading">
                                        <ShieldCheck
                                            aria-hidden="true"
                                            size={20}
                                        />
                                        <strong>
                                            {tx("请核对待绑定账号")}
                                        </strong>
                                    </div>
                                    <div className="tg-identity">
                                        <strong>
                                            {info.pendingName || "Telegram"}
                                        </strong>
                                        <span dir="ltr">
                                            ID · {info.pendingTelegramId}
                                        </span>
                                    </div>
                                    <p className="muted">
                                        {tx(
                                            "仅当这是你自己的 Telegram 账号时确认；如不认识，请重新生成链接。",
                                        )}
                                    </p>
                                    <button
                                        type="button"
                                        className="primary"
                                        disabled={disabled}
                                        onClick={() =>
                                            act(
                                                "user/telegram/confirm-binding",
                                                {
                                                    telegramId:
                                                        info.pendingTelegramId,
                                                },
                                            )
                                        }
                                    >
                                        {actionIcon(
                                            "user/telegram/confirm-binding",
                                            ShieldCheck,
                                        )}
                                        {tx("确认绑定此账号")}
                                    </button>
                                </div>
                            )}
                            {info.groupManaged && (
                                <div className="tg-group">
                                    <div className="tg-card-heading">
                                        <Users aria-hidden="true" size={20} />
                                        <strong>{tx("群成员资格")}</strong>
                                        {info.eligibility === "grace" && (
                                            <Clock3
                                                aria-hidden="true"
                                                size={17}
                                            />
                                        )}
                                    </div>
                                    <p className="muted">
                                        {tx(
                                            "群成员资格：套餐有效期内及到期后宽限期内可加入。",
                                        )}{" "}
                                        {info.graceDays} {tx("天")}
                                    </p>
                                    {info.eligibility === "grace" && (
                                        <p>
                                            {tx("宽限截止")} ·{" "}
                                            {formatInstant(info.graceEndsAt)}
                                        </p>
                                    )}
                                    {!info.linked ? (
                                        <p className="muted">
                                            {tx(
                                                "请先完成账号绑定，再申请入群。",
                                            )}
                                        </p>
                                    ) : (
                                        !eligible && (
                                            <p className="muted">
                                                {tx(
                                                    info.eligibility ===
                                                        "banned"
                                                        ? "账号已停用，请联系网站客服。"
                                                        : "当前不满足入群条件，请先购买或续费套餐。",
                                                )}
                                            </p>
                                        )
                                    )}
                                    {info.linked && (
                                        <button
                                            type="button"
                                            className="primary"
                                            disabled={disabled || !eligible}
                                            onClick={() =>
                                                act("user/telegram/join-link")
                                            }
                                        >
                                            {actionIcon(
                                                "user/telegram/join-link",
                                                Users,
                                            )}
                                            {tx("申请加入用户群")}
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className="tg-actions">
                                {!info.linked && (
                                    <button
                                        type="button"
                                        className={
                                            !pending && !activeLink
                                                ? "primary"
                                                : ""
                                        }
                                        disabled={disabled}
                                        onClick={() =>
                                            act("user/telegram/binding-link")
                                        }
                                    >
                                        {actionIcon(
                                            "user/telegram/binding-link",
                                            Link2,
                                        )}
                                        {tx(
                                            pending || activeLink
                                                ? "重新生成链接"
                                                : "获取绑定链接",
                                        )}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        setError("");
                                        d.reload();
                                    }}
                                >
                                    <RefreshCw aria-hidden="true" size={17} />
                                    {tx("刷新绑定状态")}
                                </button>
                                {info.linked && (
                                    <button
                                        type="button"
                                        className="tg-unbind"
                                        disabled={disabled}
                                        onClick={() => {
                                            if (
                                                window.confirm(
                                                    tx(
                                                        "解除绑定后将失去用户群资格，确认继续？",
                                                    ),
                                                )
                                            )
                                                void act("user/unbindTelegram");
                                        }}
                                    >
                                        {actionIcon(
                                            "user/unbindTelegram",
                                            Unlink,
                                        )}
                                        {tx("解除绑定")}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </State>
                {activeLink && (
                    <div className="tg-link" role="status">
                        {expired ? (
                            <p className="tg-card-heading">
                                <Clock3 aria-hidden="true" size={18} />
                                {tx("链接已过期，请重新获取。")}
                            </p>
                        ) : (
                            <a
                                className="button primary"
                                href={activeLink.url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {tx("在 Telegram 中继续")}
                                <ExternalLink aria-hidden="true" size={17} />
                            </a>
                        )}
                        <p className="muted">
                            {tx("链接有效至")}{" "}
                            {formatInstant(activeLink.expires)}
                        </p>
                        {activeLink.kind === "binding" && !expired && (
                            <p className="muted">
                                {tx("完成后返回此页刷新状态")}
                            </p>
                        )}
                    </div>
                )}
                {error && (
                    <p className="alert tg-card-heading" role="alert">
                        <CircleAlert aria-hidden="true" size={18} />
                        {error}
                    </p>
                )}
            </div>
        </Panel>
    );
}
