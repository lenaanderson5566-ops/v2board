import { formatInstant } from "../shared/timezone";
import { useState } from "react";
import { request } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";

export function TelegramIntegration() {
    const d = useData("user/telegram/getBotInfo");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [link, setLink] = useState("");
    const [expires, setExpires] = useState("");
    async function act(path: string, body: Record<string, unknown> = {}) {
        setBusy(true);
        setError("");
        setLink("");
        try {
            const result = await request(path, body);
            const url = result.data?.bindingUrl || result.data?.inviteUrl;
            if (url) {
                const parsed = new URL(url);
                if (parsed.protocol !== "https:" || parsed.hostname !== "t.me")
                    throw new Error(tx("链接无效"));
                setLink(parsed.href);
                setExpires(result.data.expiresAt);
            }
            d.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const info = d.data;
    const eligible = ["active", "grace"].includes(info?.eligibility);
    return (
        <Panel title="Telegram">
            <div className="pad telegram-integration">
                <p className="muted">
                    {tx(
                        "在 Telegram 打开绑定链接后，请回到此页确认账号。无需发送密码或订阅链接。",
                    )}
                </p>
                <State {...d} retry={d.reload}>
                    {info && (
                        <>
                            <p>
                                {info.linked
                                    ? `${tx("已绑定")} · ${info.telegramId}`
                                    : tx("尚未绑定 Telegram")}
                            </p>
                            {info.groupManaged && (
                                <p>
                                    {tx(
                                        "群成员资格：套餐有效期内及到期后宽限期内可加入。",
                                    )}
                                    {` ${info.graceDays} ${tx("天")}`}
                                    {info.eligibility === "grace" && (
                                        <span>
                                            {" "}
                                            · {tx("宽限截止")}{" "}
                                            {formatInstant(info.graceEndsAt)}
                                        </span>
                                    )}
                                    {!eligible && (
                                        <span>
                                            {" "}
                                            ·{" "}
                                            {tx(
                                                "当前不满足入群条件，请先购买或续费套餐。",
                                            )}
                                        </span>
                                    )}
                                </p>
                            )}
                            {info.pendingTelegramId && !info.linked && (
                                <div className="client-authorization-account">
                                    <strong>{tx("请核对待绑定账号")}</strong>
                                    <span>
                                        {info.pendingName} ·{" "}
                                        {info.pendingTelegramId}
                                    </span>
                                    <p>
                                        {tx(
                                            "仅当这是你自己的 Telegram 账号时确认；如不认识，请重新生成链接。",
                                        )}
                                    </p>
                                    <button
                                        disabled={busy}
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
                                        {tx("确认绑定此账号")}
                                    </button>
                                </div>
                            )}
                            <div className="actions">
                                {!info.linked && (
                                    <button
                                        disabled={busy}
                                        onClick={() =>
                                            act("user/telegram/binding-link")
                                        }
                                    >
                                        {tx("获取绑定链接")}
                                    </button>
                                )}
                                <button
                                    disabled={busy || d.loading}
                                    onClick={() => {
                                        setError("");
                                        d.reload();
                                    }}
                                >
                                    {tx("刷新绑定状态")}
                                </button>
                                {info.linked && info.groupManaged && (
                                    <button
                                        disabled={busy || !eligible}
                                        onClick={() =>
                                            act("user/telegram/join-link")
                                        }
                                    >
                                        {tx("申请加入用户群")}
                                    </button>
                                )}
                                {info.linked && (
                                    <button
                                        disabled={busy}
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
                                        {tx("解除绑定")}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </State>
                {link && (
                    <div role="status">
                        <a
                            className="button primary"
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {tx("在 Telegram 中继续")}
                        </a>
                        <p className="muted">
                            {tx("链接有效至")}{" "}
                            {formatInstant(expires)} ·{" "}
                            {tx("完成后返回此页刷新状态")}
                        </p>
                    </div>
                )}
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </Panel>
    );
}
