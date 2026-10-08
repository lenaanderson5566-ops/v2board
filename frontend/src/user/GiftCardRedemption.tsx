import { useId, useRef, useState, type FormEvent } from "react";
import { Check, Gift } from "lucide-react";
import { clearReadCache, request } from "../shared/api";
import { tx } from "../shared/i18n";
import { ac } from "../shared/account-copy";
import { Modal } from "../shared/ui";

export function GiftCardRedemption({
    email,
    close,
    redeemed,
}: {
    email?: string;
    close: () => void;
    redeemed: () => void;
}) {
    const id = useId();
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (pending.current || done || !code.trim() || !email) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await request("user/redeemgiftcard", { giftcard: code.trim() });
            setCode("");
            setDone(true);
            clearReadCache();
            redeemed();
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <Modal
            title={tx("兑换礼品卡")}
            variant="modal"
            className="gift-dialog"
            close={() => {
                if (!pending.current) close();
            }}
        >
            <div className="gift-redemption">
                <div
                    className={`gift-symbol${done ? " complete" : ""}`}
                    aria-hidden="true"
                >
                    {done ? <Check size={30} /> : <Gift size={30} />}
                </div>
                {done ? (
                    <>
                        <h3 role="status">{tx("兑换成功")}</h3>
                        <p className="muted">{ac("giftDone")}</p>
                        <button className="primary" onClick={close}>
                            {tx("完成")}
                        </button>
                    </>
                ) : (
                    <>
                        <h3>{ac("giftIntro")}</h3>
                        <p className="muted">{ac("giftDetail")}</p>
                        <div className="gift-account">
                            <span>{ac("redeemAccount")}</span>
                            <strong dir="ltr">{email || "—"}</strong>
                        </div>
                        <form onSubmit={submit} aria-busy={busy}>
                            <label htmlFor={id}>{tx("礼品卡代码")}</label>
                            <input
                                id={id}
                                value={code}
                                onChange={(event) =>
                                    setCode(event.target.value)
                                }
                                disabled={busy}
                                required
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                dir="ltr"
                                aria-describedby={`${id}-hint`}
                                aria-invalid={!!error}
                            />
                            <p id={`${id}-hint`} className="muted gift-hint">
                                {ac("giftHint")}
                            </p>
                            {error && (
                                <p className="alert" role="alert">
                                    {error}
                                </p>
                            )}
                            <button
                                className="primary"
                                disabled={busy || !code.trim() || !email}
                            >
                                {tx(busy ? "提交中…" : "兑换")}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </Modal>
    );
}
