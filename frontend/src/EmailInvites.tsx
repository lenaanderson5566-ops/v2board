import { useState, type FormEvent } from "react";
import { Mail, ArrowLeft } from "lucide-react";
import { boot, request, query, type Row } from "./api";
import { Modal, State, useData } from "./ui";
import { tx } from "./i18n";

const statuses: Record<string, string> = {
    queued: "等待发送",
    sent: "已发送",
    accepted: "已接受",
    expired: "已过期",
    failed: "发送失败",
};
export function EmailInvites() {
    const [view, setView] = useState<"compose" | "history" | null>(null);
    const [email, setEmail] = useState("");
    const [days, setDays] = useState(90);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);
    const history = useData<Row[]>(
        view === "history" ? query("user/invite/email/fetch", { days }) : "",
    );
    async function send(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        setSent(false);
        try {
            await request("user/invite/email/send", { email: email.trim() });
            setSent(true);
            setEmail("");
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const open = () => {
        setView("compose");
        setError("");
        setSent(false);
    };
    return (
        <>
            <section className="invite-intro">
                <div className="invite-symbol">
                    <Mail size={28} aria-hidden="true" />
                </div>
                <h2>{tx("邀请朋友使用 {{name}}", { name: boot.title })}</h2>
                <p className="muted">
                    {tx(
                        "通过邮件向朋友发送专属邀请，一起更轻松地使用 AI 应用。",
                    )}
                </p>
                <div className="actions">
                    <button className="primary" onClick={open}>
                        {tx("发送邮件邀请")}
                    </button>
                    <button onClick={() => setView("history")}>
                        {tx("跟踪邀请")}
                    </button>
                </div>
            </section>
            {view && (
                <Modal
                    title={tx(
                        view === "history" ? "查看你的邀请" : "发送邮件邀请",
                    )}
                    close={() => setView(null)}
                >
                    <div className="email-invite">
                        {view === "compose" ? (
                            <>
                                <div className="invite-banner">
                                    <Mail size={36} aria-hidden="true" />
                                </div>
                                <p className="invite-reward">
                                    {tx("邀请收益按当前站点规则结算。")}
                                </p>
                                <h3>
                                    {tx("邀请朋友使用 {{name}}", {
                                        name: boot.title,
                                    })}
                                </h3>
                                <p className="muted">
                                    {tx(
                                        "专属邀请仅限收件邮箱使用，7 天内有效。",
                                    )}
                                </p>
                                <form onSubmit={send}>
                                    <label>
                                        {tx("朋友的邮箱地址")}
                                        <input
                                            type="email"
                                            inputMode="email"
                                            autoComplete="off"
                                            maxLength={254}
                                            required
                                            value={email}
                                            placeholder="friend@example.com"
                                            disabled={busy}
                                            onChange={(event) =>
                                                setEmail(event.target.value)
                                            }
                                        />
                                    </label>
                                    {error && (
                                        <div className="alert" role="alert">
                                            {error}
                                        </div>
                                    )}
                                    {sent && (
                                        <div
                                            className="success-message"
                                            role="status"
                                        >
                                            {tx(
                                                "邀请已加入发送队列，请在跟踪邀请中查看状态。",
                                            )}
                                        </div>
                                    )}
                                    <div className="invite-actions">
                                        <button
                                            type="button"
                                            onClick={() => setView("history")}
                                        >
                                            {tx("跟踪邀请")}
                                        </button>
                                        <button
                                            className="primary"
                                            disabled={busy || !email.trim()}
                                        >
                                            {tx(busy ? "提交中…" : "发送邀请")}
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : (
                            <>
                                <div className="invite-history-toolbar">
                                    <button
                                        className="text-button"
                                        onClick={open}
                                    >
                                        <ArrowLeft
                                            size={16}
                                            aria-hidden="true"
                                        />
                                        {tx("返回")}
                                    </button>
                                    <select
                                        aria-label={tx("邀请记录时间范围")}
                                        value={days}
                                        onChange={(event) =>
                                            setDays(Number(event.target.value))
                                        }
                                    >
                                        {[7, 30, 90].map((count) => (
                                            <option value={count} key={count}>
                                                {tx("过去 {{count}} 天", {
                                                    count,
                                                })}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <State {...history} retry={history.reload}>
                                    {history.data?.length ? (
                                        <ul className="invite-history">
                                            {history.data.map((record) => (
                                                <li key={record.id}>
                                                    <span
                                                        className="invite-recipient-avatar"
                                                        aria-hidden="true"
                                                    >
                                                        {String(record.email)
                                                            .slice(0, 1)
                                                            .toUpperCase()}
                                                    </span>
                                                    <span
                                                        className="invite-recipient-email"
                                                        dir="ltr"
                                                        title={record.email}
                                                    >
                                                        {record.email}
                                                    </span>
                                                    <span
                                                        className={`invite-status ${record.status}`}
                                                    >
                                                        {tx(
                                                            statuses[
                                                                record.status
                                                            ] || "等待发送",
                                                        )}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="muted">
                                            {tx("暂时没有邮件邀请记录。")}
                                        </p>
                                    )}
                                </State>
                            </>
                        )}
                    </div>
                </Modal>
            )}
        </>
    );
}
