import { PlanSelection } from "./SubscriptionPurchase";
import { activePlan } from "./user-experience";
import { unfinishedOrder } from "./billing-flow";
import { TrafficCredits } from "./TrafficCredits";
import { c, minuteDate } from "./credit-copy";
import { useRef, useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { bytes, date, money, request, type Row } from "./api";
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
        [resetTab, setResetTab] = useState<"available" | "history">(
            "available",
        ),
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
        total =
            sub.data?.has_subscription === false
                ? 0
                : Math.max(0, Number(info.data?.transfer_enable || 0));
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
                    <div className="usage-balance-grid">
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
                                        {sub.data?.has_subscription === false
                                            ? c("noPlanTitle")
                                            : sub.data?.plan?.name ||
                                              tx("尚未订阅套餐")}
                                    </strong>
                                    <div className="settings-row">
                                        <span className="muted">
                                            {sub.data?.reset_at
                                                ? c("resetAt", {
                                                      date: minuteDate(
                                                          sub.data.reset_at,
                                                          sub.data
                                                              .reset_timezone,
                                                      ),
                                                  })
                                                : c(
                                                      sub.data
                                                          ?.has_subscription ===
                                                          false
                                                          ? "noPlan"
                                                          : "noReset",
                                                  )}
                                        </span>
                                        {total > 0 && (
                                            <span>
                                                {e("remaining")}{" "}
                                                {Math.round(percent)}%
                                            </span>
                                        )}
                                    </div>
                                    {total > 0 && (
                                        <>
                                            <div
                                                className="quota-progress"
                                                role="progressbar"
                                                aria-label={e("remaining")}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-valuenow={percent}
                                            >
                                                <i
                                                    style={{
                                                        width: `${percent}%`,
                                                    }}
                                                />
                                            </div>
                                            <p className="muted">
                                                {tx("已使用")}{" "}
                                                {bytes(Math.min(used, total))} /{" "}
                                                {bytes(total)}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </State>
                        </section>
                        <TrafficCredits
                            balance={Number(info.data?.credit_balance || 0)}
                        />
                    </div>
                    <section className="settings-section reset-section">
                        <div className="reset-section-intro">
                            <h2>{b("usageReset")}</h2>
                            <p className="muted">{b("resetHelp")}</p>
                        </div>
                        <State {...resets} retry={resets.reload}>
                            <div className="settings-card reset-card">
                                <div
                                    className="reset-switcher"
                                    role="group"
                                    aria-label={b("usageReset")}
                                >
                                    <button
                                        aria-pressed={resetTab === "available"}
                                        onClick={() => setResetTab("available")}
                                    >
                                        {b("resetAvailable", {
                                            count: resets.data?.available || 0,
                                        })}
                                    </button>
                                    <button
                                        aria-pressed={resetTab === "history"}
                                        onClick={() => setResetTab("history")}
                                    >
                                        {b("historyLabel")}
                                    </button>
                                </div>
                                <div className="reset-content">
                                    {resetTab === "available" ? (
                                        Number(resets.data?.available || 0) >
                                        0 ? (
                                            <>
                                                <div className="settings-row">
                                                    <strong>
                                                        {b("banked")}
                                                    </strong>
                                                    <button
                                                        className="soft-button"
                                                        disabled={
                                                            !resets.data
                                                                ?.can_reset ||
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
                                                    {resets.data
                                                        ?.disabled_reason
                                                        ? resetError({
                                                              code: resets.data
                                                                  .disabled_reason,
                                                              message: "",
                                                          })
                                                        : b("bankedHelp")}
                                                </p>
                                                {!!resets.data?.credits
                                                    ?.length && (
                                                    <ul className="reset-expiry-list">
                                                        {resets.data.credits.map(
                                                            (credit: Row) => (
                                                                <li
                                                                    key={
                                                                        credit.id
                                                                    }
                                                                >
                                                                    <span>
                                                                        {b(
                                                                            "creditCount",
                                                                            {
                                                                                count: credit.remaining,
                                                                            },
                                                                        )}
                                                                    </span>
                                                                    <span>
                                                                        {credit.expires_at
                                                                            ? b(
                                                                                  "expires",
                                                                                  {
                                                                                      date: date(
                                                                                          credit.expires_at,
                                                                                      ),
                                                                                  },
                                                                              )
                                                                            : tx(
                                                                                  "长期有效",
                                                                              )}
                                                                    </span>
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                )}
                                            </>
                                        ) : (
                                            <p className="reset-empty muted">
                                                {b("resetEmpty")}
                                            </p>
                                        )
                                    ) : (
                                        <div className="reset-history">
                                            <p className="reset-history-range muted">
                                                {b("recentHistory")}
                                            </p>
                                            {resets.data?.history?.length ? (
                                                resets.data.history.map(
                                                    (row: Row) => (
                                                        <div
                                                            className="settings-row"
                                                            key={row.id}
                                                        >
                                                            <div>
                                                                <strong>
                                                                    {b(
                                                                        row.kind ===
                                                                            "grant"
                                                                            ? "granted"
                                                                            : row.kind ===
                                                                                "global"
                                                                              ? "globalReset"
                                                                              : "consumed",
                                                                    )}
                                                                </strong>
                                                                <p className="muted">
                                                                    {row.kind ===
                                                                    "grant"
                                                                        ? b(
                                                                              "creditCount",
                                                                              {
                                                                                  count: row.quantity,
                                                                              },
                                                                          )
                                                                        : b(
                                                                              "usageCleared",
                                                                              {
                                                                                  amount: bytes(
                                                                                      Number(
                                                                                          row.u_before,
                                                                                      ) +
                                                                                          Number(
                                                                                              row.d_before,
                                                                                          ),
                                                                                  ),
                                                                              },
                                                                          )}
                                                                </p>
                                                            </div>
                                                            <time>
                                                                {date(
                                                                    row.created_at,
                                                                )}
                                                            </time>
                                                        </div>
                                                    ),
                                                )
                                            ) : (
                                                <p className="muted">
                                                    {b("noResetHistory")}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </State>
                        {sub.data?.has_subscription !== false && activePlan(sub.data?.plan, sub.data?.expired_at) && total > 0 && sub.data?.plan?.reset_price != null && (
                            <PaidTrafficReset plan={sub.data.plan} used={used} />
                        )}
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

export function PaidTrafficReset({ plan, used }: { plan: Row; used: number }) {
    const orders = useData<Row[]>("user/order/fetch");
    const [open, setOpen] = useState(false);
    const pending = unfinishedOrder(orders.data || []);
    return <div className="settings-card paid-traffic-reset">
        <div className="settings-row">
            <strong>{c("paidReset")}</strong>
            <button className="soft-button" disabled={used <= 0 || orders.loading || Boolean(orders.error) || Boolean(pending)} onClick={() => setOpen(true)}>
                {c("paidReset")} · {money(plan.reset_price)}
            </button>
        </div>
        <p className="muted">{c("paidResetHelp")}</p>
        {used <= 0 && <p className="muted">{b("emptyUsage")}</p>}
        {pending && <a href={`#/order/${pending.trade_no}`}>{tx("你有一笔待支付订单")} · {tx("查看")}</a>}
        {orders.error && <State {...orders} retry={orders.reload}>{null}</State>}
        {open && <Modal title={c("paidReset")} close={() => setOpen(false)}>
            <p className="pad muted">{c("paidResetHelp")}</p>
            <PlanSelection plan={{ ...plan, resetOnly: true }} close={() => setOpen(false)} />
        </Modal>}
    </div>;
}
