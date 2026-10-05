import { CheckCircle2, CircleX, ArrowLeft, ReceiptText } from "lucide-react";
import { bytes, money as formatMoney, type Row } from "./api";
import { tx } from "./i18n";
import { c, minuteDate } from "./credit-copy";
import { billingPeriods, orderOriginalAmount } from "./billing-flow";

export function OrderReceipt({ order }: { order: Row }) {
    const money = (amount: unknown) => formatMoney(amount, order.currency || "CNY");
    const cancelled = Number(order.status) === 2,
        applied = Number(order.status) === 4;
    const credit = Number(order.credit_bytes) > 0,
        deposit = Number(order.plan_id) === 0;
    const Icon = cancelled ? CircleX : applied ? ReceiptText : CheckCircle2;
    const due = Number(order.total_amount || 0),
        fee = Number(order.handling_amount || 0);
    return (
        <article className="order-receipt">
            <a className="receipt-back" href="#/order">
                <ArrowLeft size={16} />
                {c("back")}
            </a>
            <div
                className={`receipt-status ${cancelled ? "cancelled" : "completed"}`}
            >
                <Icon size={28} aria-hidden="true" />
                <div>
                    <h2>
                        {tx(
                            cancelled
                                ? "已取消"
                                : applied
                                  ? "已折抵"
                                  : "订单已完成",
                        )}
                    </h2>
                    <p className="muted">
                        {cancelled
                            ? c("cancelledHelp")
                            : applied
                              ? c("applied")
                              : credit
                                ? c("credited")
                                : deposit
                                  ? c("deposited")
                                  : c("completedHelp")}
                    </p>
                </div>
            </div>
            <section className="receipt-card">
                <div className="receipt-product">
                    <h3>
                        {credit
                            ? c("creditOrder", {
                                  amount: bytes(order.credit_bytes),
                              })
                            : deposit
                              ? tx("账户充值")
                              : order.plan?.name}
                    </h3>
                    {!deposit && (
                        <span className="muted">
                            {credit
                                ? order.credit_snapshot?.name ||
                                  order.plan?.name
                                : tx(
                                      billingPeriods[order.period] ||
                                          "订单详情",
                                  )}
                        </span>
                    )}
                </div>
                <dl className="checkout-lines">
                    {Number(order.plan_id) !== 0 && !(Number(order.credit_bytes) > 0) && (
                        <div>
                            <dt>{tx("套餐价格")}</dt>
                            <dd>{money(orderOriginalAmount(order))}</dd>
                        </div>
                    )}
                    {!cancelled && Number(order.discount_amount) > 0 && (
                        <div>
                            <dt>{tx("优惠金额")}</dt>
                            <dd>−{money(order.discount_amount)}</dd>
                        </div>
                    )}
                    {!cancelled && Number(order.surplus_amount) > 0 && (
                        <div>
                            <dt>{tx("旧套餐折抵")}</dt>
                            <dd>
                                −
                                {money(
                                    Number(order.surplus_amount) -
                                        Number(order.refund_amount || 0),
                                )}
                            </dd>
                        </div>
                    )}
                    {Number(order.balance_amount) > 0 && (
                        <div>
                            <dt>
                                {cancelled
                                    ? c("balanceReturned")
                                    : tx("余额抵扣")}
                            </dt>
                            <dd>
                                {cancelled ? "+" : "−"}
                                {money(order.balance_amount)}
                            </dd>
                        </div>
                    )}
                    {!cancelled && (
                        <div>
                            <dt>{tx("支付手续费")}</dt>
                            <dd>{money(fee)}</dd>
                        </div>
                    )}
                    <div className="checkout-total">
                        <dt>{cancelled ? c("quote") : c("paid")}</dt>
                        <dd>{money(due + (cancelled ? 0 : fee))}</dd>
                    </div>
                    {!cancelled && Number(order.refund_amount) > 0 && (
                        <div>
                            <dt>{tx("退回余额")}</dt>
                            <dd>{money(order.refund_amount)}</dd>
                        </div>
                    )}
                </dl>
                <dl className="receipt-reference">
                    <div>
                        <dt>{tx("订单编号")}</dt>
                        <dd dir="ltr">{order.trade_no}</dd>
                    </div>
                    <div>
                        <dt>{c("created")}</dt>
                        <dd>{minuteDate(order.created_at)}</dd>
                    </div>
                    {!cancelled && order.paid_at > 0 && (
                        <div>
                            <dt>{c("paidAt")}</dt>
                            <dd>{minuteDate(order.paid_at)}</dd>
                        </div>
                    )}
                </dl>
            </section>
            <div className="receipt-actions">
                <a
                    className="button primary"
                    href={
                        cancelled
                            ? credit
                                ? "#/traffic"
                                : deposit
                                  ? "#/order"
                                  : "#/plan"
                            : deposit
                              ? "#/order"
                              : credit
                                ? "#/traffic"
                                : "#/subscribe"
                    }
                >
                    {cancelled
                        ? tx(
                              credit
                                  ? "使用情况"
                                  : deposit
                                    ? "账单"
                                    : "选择套餐",
                          )
                        : deposit
                          ? tx("账单")
                          : credit
                            ? tx("使用情况")
                            : tx("快速开始")}
                </a>
                <a
                    className="checkout-help"
                    href={`#/ticket/order/${encodeURIComponent(order.trade_no)}`}
                >
                    {tx("此订单需要帮助？")}
                </a>
            </div>
        </article>
    );
}
