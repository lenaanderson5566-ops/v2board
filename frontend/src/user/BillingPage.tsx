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

export function BillingPage() {
    const [page, setPage] = useState(1);
    const info = useData("user/info"),
        sub = useData("user/getSubscribe"),
        orders = useData<Row[]>(
            query("user/order/fetch", { current: page, page_size: 20 }),
        );
    const [dialog, setDialog] = useState<"gift" | "deposit" | null>(null);
    const [all, setAll] = useState(false);
    const status = ["待支付", "开通中", "已取消", "已完成", "已折抵"];
    return (
        <div className="settings-content billing-page">
            <p className="settings-intro">{b("billingIntro")}</p>
            {info.data && info.data.account_status?.state !== "active" && (
                <a className="billing-usage-link" href="#/traffic">
                    {tx("使用情况")}
                    <ArrowUpRight size={15} />
                </a>
            )}
            <section className="settings-section">
                <h2>{b("currentPlan")}</h2>
                <State {...sub} retry={sub.reload}>
                    <div className="settings-card settings-row">
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
                <State {...info} retry={info.reload}>
                    <div className="settings-card balance-card">
                        <div className="settings-row">
                            <strong className="balance-amount">
                                {money(info.data?.balance)}
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
                </State>
            </section>
            <TrafficCredits
                purchaseLabel
                balance={Number(info.data?.credit_balance || 0)}
            />
            <section className="settings-section">
                <header>
                    <h2>{b("transactions")}</h2>
                    {(orders.data?.length || 0) > 5 && (
                        <button
                            className="soft-button"
                            onClick={() => setAll(!all)}
                        >
                            {b(all ? "showLess" : "viewAll")}
                        </button>
                    )}
                </header>
                <State {...orders} retry={orders.reload}>
                    {orders.data?.length ? (
                        <div className="settings-card transaction-list">
                            {(all ? orders.data : orders.data.slice(0, 5)).map(
                                (order) => (
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
                                            <small>
                                                {date(order.created_at)}
                                            </small>
                                        </span>
                                        <StatusBadge tone={orderStatusTone(order.status)}>
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
                                ),
                            )}
                        </div>
                    ) : (
                        <div className="settings-card">
                            <Empty text={b("noTransactions")} />
                        </div>
                    )}
                </State>
            </section>
            {all && orders.total > 20 && (
                <Pager
                    page={page}
                    total={orders.total}
                    size={20}
                    onChange={setPage}
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
                                    currency: "CNY",
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
