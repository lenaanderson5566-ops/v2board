import { useState } from "react";
import { ArrowUpRight, ChevronRight, Gift, Plus } from "lucide-react";
import { boot, date, money, navigate, request, type Row } from "./api";
import { tx } from "./i18n";
import { b } from "./billing-copy";
import { e } from "./experience-copy";
import { Editor, Empty, Modal, State, useData } from "./ui";

export function BillingPage() {
    const info = useData("user/info"),
        sub = useData("user/getSubscribe"),
        orders = useData<Row[]>("user/order/fetch");
    const [dialog, setDialog] = useState<"gift" | "deposit" | null>(null);
    const [notice, setNotice] = useState("");
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
                                {sub.data?.plan?.name || tx("尚未订阅套餐")}
                            </strong>
                            <p className="muted">
                                {sub.data?.plan
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
            {notice && (
                <p className="success-message" role="status">
                    {notice}
                </p>
            )}
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
                                                {order.plan?.name ||
                                                    tx("账户充值")}
                                            </strong>
                                            <small>
                                                {date(order.created_at)}
                                            </small>
                                        </span>
                                        <span
                                            className={`badge ${Number(order.status) === 3 ? "success" : ""}`}
                                        >
                                            {tx(
                                                status[order.status] ||
                                                    String(order.status),
                                            )}
                                        </span>
                                        <strong>
                                            {money(order.total_amount)}
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
            {dialog && (
                <Modal
                    title={tx(dialog === "gift" ? "兑换礼品卡" : "账户充值")}
                    close={() => setDialog(null)}
                    variant="modal"
                >
                    {dialog === "gift" ? (
                        <Editor
                            fields={[
                                {
                                    key: "giftcard",
                                    label: tx("礼品卡代码"),
                                    required: true,
                                },
                            ]}
                            initial={{}}
                            submit={tx("兑换")}
                            onSave={async (body) => {
                                await request("user/redeemgiftcard", body);
                                setNotice(tx("兑换成功"));
                                setDialog(null);
                                info.reload();
                                sub.reload();
                            }}
                        />
                    ) : (
                        <Editor
                            fields={[
                                {
                                    key: "deposit_amount",
                                    label: e("depositAmount", {
                                        currency: boot.currencySymbol,
                                    }),
                                    type: "number",
                                    scale: 100,
                                    min: 0.01,
                                    step: 0.01,
                                    required: true,
                                },
                            ]}
                            initial={{ plan_id: 0 }}
                            submit={tx("创建充值订单")}
                            onSave={async (body) => {
                                const result = await request<string>(
                                    "user/order/save",
                                    body,
                                );
                                navigate("order/" + result.data);
                            }}
                        />
                    )}
                </Modal>
            )}
        </div>
    );
}
