import { StatusBadge, orderStatusTone } from "../shared/StatusBadge";
import { GiftCardRedemption } from "./GiftCardRedemption";
import { TrafficCredits } from "./TrafficCredits";
import { c } from "../shared/credit-copy";
import { useState } from "react";
import { ArrowUpRight, ChevronRight, Gift, Plus } from "lucide-react";
import {
    bytes,
    date,
    money,
    navigate,
    request,
    query,
    type Row,
} from "../shared/api";
import { tx } from "../shared/i18n";
import { b } from "../shared/billing-copy";
import { e } from "../shared/experience-copy";
import { Editor, Empty, Modal, State, useData, Pager } from "../shared/ui";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { pricingCopy as pc } from "./pricing-copy";
import "./billing-filters.css";

type HistoryFilters = {
    status: string;
    days: string;
    number: string;
    from?: string;
};
const emptyFilters: HistoryFilters = { status: "", days: "", number: "" };

export function BillingPage() {
    const [page, setPage] = useState(1);
    const [draft, setDraft] = useState(emptyFilters);
    const [filters, setFilters] = useState(emptyFilters);
    const filtered = Boolean(filters.status || filters.days || filters.number);
    const info = useData("user/info"),
        sub = useData("user/getSubscribe"),
        orders = useData<Row[]>(
            query("user/order/fetch", {
                current: page,
                page_size: 20,
                ...(filters.status !== ""
                    ? { status: Number(filters.status) }
                    : {}),
                ...(filters.number ? { order_number: filters.number } : {}),
                ...(filters.from ? { created_from: filters.from } : {}),
            }),
        );
    const retryIn = useRetryCountdown(orders.retryAt);
    const blocked = orders.loading || retryIn > 0;
    const [dialog, setDialog] = useState<"gift" | "deposit" | null>(null);
    const [all, setAll] = useState(false);
    const status = ["待支付", "开通中", "已取消", "已完成", "已折抵"];
    function applyFilters(event: React.FormEvent) {
        event.preventDefault();
        if (blocked) return;
        const number = draft.number.trim();
        if (number && !/^[A-Za-z0-9_-]{1,64}$/.test(number)) return;
        setFilters({
            ...draft,
            number,
            from: draft.days
                ? new Date(
                      Date.now() - Number(draft.days) * 86400000,
                  ).toISOString()
                : undefined,
        });
        setPage(1);
    }
    return (
        <div className="settings-content billing-page">
            <p className="settings-intro">{b("billingIntro")}</p>
            <section className="settings-section">
                <h2>{b("currentPlan")}</h2>
                <State {...sub} retry={sub.reload}>
                    <div className="settings-card settings-row billing-current-plan">
                        <div>
                            <strong>
                                {sub.data?.has_subscription === false
                                    ? tx("尚未订阅套餐")
                                    : sub.data?.plan?.name ||
                                      tx("尚未订阅套餐")}
                            </strong>
                            <p className="muted">
                                {sub.data?.plan &&
                                sub.data?.has_subscription !== false
                                    ? `${tx("订阅到期")} · ${sub.data.expired_at ? date(sub.data.expired_at) : tx("长期有效")}`
                                    : b("choosePlan")}
                            </p>
                        </div>
                        <a className="button soft-button" href="#/plan">
                            {tx(sub.data?.plan ? "管理订阅" : "购买订阅")}
                            <ArrowUpRight size={15} />
                        </a>
                    </div>
                </State>
            </section>
            <State {...info} retry={info.reload}>
                <section className="settings-section">
                    <header>
                        <h2>{tx("账户余额")}</h2>
                        <button
                            className="soft-button"
                            onClick={() => setDialog("gift")}
                        >
                            <Gift size={16} />
                            {tx("兑换礼品卡")}
                        </button>
                    </header>
                    <div className="settings-card balance-card">
                        <div className="settings-row">
                            <strong className="balance-amount">
                                {money(info.data?.balance, info.data?.currency)}
                            </strong>
                            <button
                                className="soft-button"
                                onClick={() => setDialog("deposit")}
                            >
                                <Plus size={16} />
                                {tx("账户充值")}
                            </button>
                        </div>
                        <p className="muted">{b("balanceHelp")}</p>
                    </div>
                </section>
                <TrafficCredits
                    purchaseLabel
                    balance={Number(info.data?.credit_balance || 0)}
                />
            </State>
            <section className="settings-section">
                <header>
                    <h2>{b("transactions")}</h2>
                    {!filtered && ((orders.data?.length || 0) > 5 || all) && (
                        <button
                            className="soft-button"
                            disabled={blocked}
                            onClick={() => {
                                setAll(!all);
                                setPage(1);
                            }}
                        >
                            {b(all ? "showLess" : "viewAll")}
                        </button>
                    )}
                </header>
                <details className="billing-history-filters">
                    <summary>
                        {b("findTransactions")}
                        {filtered && <span>{b("filtersApplied")}</span>}
                    </summary>
                    <form onSubmit={applyFilters}>
                        <label>
                            {tx("状态")}
                            <select
                                value={draft.status}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        status: event.target.value,
                                    })
                                }
                            >
                                <option value="">{b("allStatuses")}</option>
                                {status.map((label, index) => (
                                    <option key={index} value={index}>
                                        {tx(label)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            {b("timeRange")}
                            <select
                                value={draft.days}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        days: event.target.value,
                                    })
                                }
                            >
                                <option value="">{b("allTime")}</option>
                                {[30, 90, 365].map((days) => (
                                    <option key={days} value={days}>
                                        {b("lastDays", { days })}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="billing-order-search">
                            {b("orderNumber")}
                            <input
                                type="search"
                                value={draft.number}
                                maxLength={64}
                                pattern={"[A-Za-z0-9_\\-]{1,64}"}
                                placeholder={b("exactOrderNumber")}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        number: event.target.value,
                                    })
                                }
                            />
                        </label>
                        <div className="billing-filter-actions">
                            <button
                                className="primary"
                                disabled={blocked}
                                type="submit"
                            >
                                {retryIn > 0
                                    ? pc("retryIn", { seconds: retryIn })
                                    : b("searchTransactions")}
                            </button>
                            <button
                                className="soft-button"
                                type="button"
                                disabled={
                                    blocked ||
                                    (!filtered &&
                                        !draft.status &&
                                        !draft.days &&
                                        !draft.number)
                                }
                                onClick={() => {
                                    if (blocked) return;
                                    setDraft(emptyFilters);
                                    setFilters(emptyFilters);
                                    setPage(1);
                                }}
                            >
                                {tx("重置")}
                            </button>
                        </div>
                    </form>
                </details>
                {filtered && !orders.loading && !orders.error && (
                    <p className="muted" role="status">
                        {b("filteredTransactions", {
                            count: orders.total || 0,
                        })}
                    </p>
                )}
                <State {...orders} retry={orders.reload}>
                    {orders.data?.length ? (
                        <div className="settings-card transaction-list">
                            {(all || filtered
                                ? orders.data
                                : orders.data.slice(0, 5)
                            ).map((order) => (
                                <a
                                    key={order.trade_no}
                                    className="transaction-row"
                                    href={`#/order/${order.trade_no}`}
                                >
                                    <span>
                                        <strong>
                                            {order.credit_bytes
                                                ? c("creditOrder", {
                                                      amount: bytes(
                                                          order.credit_bytes,
                                                      ),
                                                  })
                                                : order.plan?.name ||
                                                  tx("账户充值")}
                                        </strong>
                                        <small>{date(order.created_at)}</small>
                                    </span>
                                    <StatusBadge
                                        tone={orderStatusTone(order.status)}
                                    >
                                        {tx(
                                            status[order.status] ||
                                                String(order.status),
                                        )}
                                    </StatusBadge>
                                    <strong>
                                        {money(
                                            order.total_amount,
                                            order.currency || "CNY",
                                        )}
                                    </strong>
                                    <ChevronRight size={16} />
                                </a>
                            ))}
                        </div>
                    ) : (
                        <div className="settings-card">
                            <Empty
                                text={b(
                                    filtered
                                        ? "noMatchingTransactions"
                                        : "noTransactions",
                                )}
                            />
                        </div>
                    )}
                </State>
            </section>
            {(all || filtered) && orders.total > 20 && (
                <Pager
                    page={page}
                    total={orders.total}
                    size={20}
                    loading={blocked}
                    onChange={(next) => {
                        if (!blocked) setPage(next);
                    }}
                />
            )}
            {dialog === "gift" && (
                <GiftCardRedemption
                    email={info.data?.email}
                    close={() => setDialog(null)}
                    redeemed={() => {
                        info.reload();
                        sub.reload();
                    }}
                />
            )}
            {dialog === "deposit" && (
                <Modal
                    title={tx("账户充值")}
                    close={() => setDialog(null)}
                    variant="modal"
                >
                    <Editor
                        fields={[
                            {
                                key: "deposit_amount",
                                label: e("depositAmount", {
                                    currency: info.data?.currency || "CNY",
                                }),
                                type: "number",
                                scale: 100,
                                min: 0.01,
                                step: 0.01,
                                required: true,
                            },
                        ]}
                        initial={{ plan_id: 0, period: "deposit" }}
                        submit={tx("创建充值订单")}
                        onSave={async (body) => {
                            const result = await request<string>(
                                "user/order/save",
                                body,
                            );
                            navigate("order/" + result.data);
                        }}
                    />
                </Modal>
            )}
        </div>
    );
}
