import { useRef, useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { bytes, date, request, type Row } from "./api";
import { tx } from "./i18n";
import { e } from "./experience-copy";
import { b } from "./billing-copy";
import { Modal, State, useData } from "./ui";
import { UsageChart } from "./UsageChart";

export function UsagePage() {
    const info = useData("user/info"),
        sub = useData("user/getSubscribe"),
        resets = useData("user/usage/reset");
    const [tab, setTab] = useState("overview"),
        [confirm, setConfirm] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    const attempt = useRef(""),
        inFlight = useRef(false);
    const used = Math.max(
            0,
            Number(info.data?.u || 0) + Number(info.data?.d || 0),
        ),
        total = Math.max(0, Number(info.data?.transfer_enable || 0));
    const percent = total
        ? Math.max(0, Math.min(100, ((total - used) / total) * 100))
        : 0;
    async function consume() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            await request("user/usage/reset", { request_key: attempt.current });
            setConfirm(false);
            setNotice(b("resetSuccess"));
            attempt.current = "";
            info.reload();
            sub.reload();
            resets.reload();
        } catch (cause) {
            const err = cause as Error & { code?: string };
            setError(resetError(err));
            resets.reload();
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    return (
        <div className="settings-content usage-page">
            <div className="settings-row usage-heading">
                <p className="settings-intro">{b("usageIntro")}</p>
                {info.data?.account_status?.state === "active" && (
                    <a className="button soft-button" href="#/subscribe">
                        {tx("快速开始")}
                        <ArrowUpRight size={15} />
                    </a>
                )}
            </div>
            <div
                className="settings-tabs"
                role="group"
                aria-label={tx("使用情况")}
            >
                <button
                    aria-pressed={tab === "overview"}
                    onClick={() => setTab("overview")}
                >
                    {b("overview")}
                </button>
                <button
                    aria-pressed={tab === "analysis"}
                    onClick={() => setTab("analysis")}
                >
                    {b("analysis")}
                </button>
            </div>
            {tab === "analysis" ? (
                <UsageChart showDetails={false} showRecords />
            ) : (
                <>
                    <section className="settings-section">
                        <header>
                            <h2>{e("quota")}</h2>
                            <a href="#/order">{tx("管理订阅")}</a>
                        </header>
                        <State
                            loading={info.loading || sub.loading}
                            error={info.error || sub.error}
                            data={info.data && sub.data}
                            retry={() => {
                                info.reload();
                                sub.reload();
                            }}
                        >
                            <div className="settings-card usage-quota">
                                <strong>
                                    {sub.data?.plan?.name || tx("尚未订阅套餐")}
                                </strong>
                                <div className="settings-row">
                                    <span className="muted">
                                        {typeof sub.data?.reset_day === "number"
                                            ? e("resetDays", {
                                                  count: sub.data.reset_day,
                                              })
                                            : e("noReset")}
                                    </span>
                                    <span>
                                        {e("remaining")} {Math.round(percent)}%
                                    </span>
                                </div>
                                <div
                                    className="quota-progress"
                                    role="progressbar"
                                    aria-label={e("remaining")}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={percent}
                                >
                                    <i style={{ width: `${percent}%` }} />
                                </div>
                                <p className="muted">
                                    {tx("已使用")} {bytes(used)} /{" "}
                                    {bytes(total)}
                                </p>
                            </div>
                        </State>
                    </section>
                    <section className="settings-section">
                        <h2>{b("usageReset")}</h2>
                        <p className="muted">{b("resetHelp")}</p>
                        <State {...resets} retry={resets.reload}>
                            <div className="settings-card">
                                <div className="settings-row">
                                    <div>
                                        <strong>{b("banked")}</strong>
                                        <p className="reset-count">
                                            {resets.data?.available || 0}
                                            <small>{b("available")}</small>
                                        </p>
                                    </div>
                                    <button
                                        className="soft-button"
                                        disabled={
                                            !resets.data?.can_reset ||
                                            resets.loading
                                        }
                                        onClick={() => {
                                            attempt.current ||=
                                                crypto.randomUUID();
                                            setError("");
                                            setConfirm(true);
                                        }}
                                    >
                                        <RotateCcw size={16} />
                                        {b("resetNow")}
                                    </button>
                                </div>
                                <p className="muted">
                                    {resets.data?.disabled_reason
                                        ? resetError({
                                              code: resets.data.disabled_reason,
                                              message: "",
                                          })
                                        : b("bankedHelp")}
                                </p>
                                {!!resets.data?.credits?.length && (
                                    <ul className="reset-expiry-list">
                                        {resets.data.credits.map(
                                            (credit: Row) => (
                                                <li key={credit.id}>
                                                    <span>
                                                        {b("creditCount", {
                                                            count: credit.remaining,
                                                        })}
                                                    </span>
                                                    <span>
                                                        {credit.expires_at
                                                            ? b("expires", {
                                                                  date: date(
                                                                      credit.expires_at,
                                                                  ),
                                                              })
                                                            : tx("长期有效")}
                                                    </span>
                                                </li>
                                            ),
                                        )}
                                    </ul>
                                )}
                            </div>
                            <header className="reset-history-heading">
                                <h3>{b("resetHistory")}</h3>
                                <small className="muted">
                                    {b("recentHistory")}
                                </small>
                            </header>
                            <div className="settings-card reset-history">
                                {resets.data?.history?.length ? (
                                    resets.data.history.map((row: Row) => (
                                        <div
                                            className="settings-row"
                                            key={row.id}
                                        >
                                            <div>
                                                <strong>
                                                    {b(
                                                        row.kind === "grant"
                                                            ? "granted"
                                                            : row.kind ===
                                                                "global"
                                                              ? "globalReset"
                                                              : "consumed",
                                                    )}
                                                </strong>
                                                <p className="muted">
                                                    {row.kind === "grant"
                                                        ? b("creditCount", {
                                                              count: row.quantity,
                                                          })
                                                        : b("usageCleared", {
                                                              amount: bytes(
                                                                  Number(
                                                                      row.u_before,
                                                                  ) +
                                                                      Number(
                                                                          row.d_before,
                                                                      ),
                                                              ),
                                                          })}
                                                </p>
                                            </div>
                                            <time>{date(row.created_at)}</time>
                                        </div>
                                    ))
                                ) : (
                                    <p className="muted">
                                        {b("noResetHistory")}
                                    </p>
                                )}
                            </div>
                        </State>
                    </section>
                </>
            )}
            {notice && (
                <p className="success-message" role="status">
                    {notice}
                </p>
            )}
            {confirm && (
                <Modal
                    title={b("resetNow")}
                    close={() => {
                        if (!inFlight.current) setConfirm(false);
                    }}
                    variant="modal"
                >
                    <div className="pad">
                        <p>{b("resetConfirm", { amount: bytes(used) })}</p>
                        <p className="muted">{b("resetHelp")}</p>
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="actions">
                            <button
                                disabled={busy}
                                onClick={() => setConfirm(false)}
                            >
                                {tx("取消")}
                            </button>
                            <button
                                className="primary"
                                disabled={busy || !resets.data?.can_reset}
                                onClick={consume}
                            >
                                {busy ? tx("处理中") : b("useOne")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}

export function resetError(error: { code?: string; message: string }) {
    switch (error.code) {
        case "reset_inactive":
            return b("inactive");
        case "reset_empty":
            return b("emptyUsage");
        case "reset_no_credit":
            return b("noCredits");
        default:
            return error.message;
    }
}
