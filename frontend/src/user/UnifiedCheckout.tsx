import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { navigate, query, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { PurchaseSteps } from "./PurchaseSteps";
import { PlanSelection } from "./PlanSelection";
import { checkoutOrderReference } from "./checkout-navigation";
import { StripeCard } from "./OrderView";
import { PaymentCheckout } from "./PaymentCheckout";
import type { InitialPayment, PaymentQuote } from "./PaymentCheckout";
import { unfinishedOrder } from "./billing-flow";
import { PendingOrderNotice } from "./PendingOrderNotice";
import "./unified-checkout.css";

export function UnifiedCheckout({
    initialPlan,
    planId,
    initialPeriod,
    replaceTradeNo,
    onBack,
    initialOrder,
}: {
    initialPlan?: Row;
    planId?: number;
    initialPeriod?: string;
    replaceTradeNo?: string;
    onBack?: () => void;
    initialOrder?: string;
}) {
    const [checkout, setCheckout] = useState<
        { number: string; payment?: InitialPayment } | undefined
    >(() => {
        const number = checkoutOrderReference(initialOrder);
        return number ? { number } : undefined;
    });
    const [paymentQuote, setPaymentQuote] = useState<PaymentQuote>();
    const detail = useData<Row>(
        checkout
            ? query("user/order/detail", { trade_no: checkout.number })
            : "",
    );
    const order =
        checkout &&
        detail.data &&
        String(detail.data.trade_no) === checkout.number
            ? detail.data
            : undefined;
    const plan = useData<Row>(
        !initialPlan && planId ? query("user/plan/fetch", { id: planId }) : "",
    );
    const catalog = initialPlan || plan.data;
    const chosen = order?.plan
        ? {
              ...(Number(catalog?.id) === Number(order.plan_id) ? catalog : {}),
              ...order.plan,
              id: order.plan_id,
              currency: order.currency || catalog?.currency,
          }
        : catalog;
    const orders = useData<Row[]>(
        checkout ? "" : "user/order/fetch",
        undefined,
        false,
        {
            refreshOnEvents: false,
        },
    );
    const recheckOrders = useCallback(() => orders.reload(), [orders.reload]);
    const pending = unfinishedOrder(orders.data || []);
    const blocked =
        pending &&
        !(
            pending.trade_no === replaceTradeNo &&
            Number(pending.status) === 0 &&
            !pending.payment_id
        );
    function showPayment(number: string, payment?: InitialPayment) {
        const id = Number(chosen?.id || planId);
        if (
            !checkoutOrderReference(number) ||
            !Number.isSafeInteger(id) ||
            id <= 0
        )
            return;
        // The route remains a checkout route. Only a resumable order reference goes in the URL.
        history.replaceState(
            history.state,
            "",
            `#/plan/${id}?order=${encodeURIComponent(number)}`,
        );
        setPaymentQuote(undefined);
        setCheckout({ number, payment });
    }
    return (
        <section className="unified-checkout">
            <button
                className="receipt-back"
                type="button"
                onClick={() => {
                    if (onBack) {
                        onBack();
                        navigate("plan");
                    } else navigate("plan");
                }}
            >
                <ArrowLeft size={16} />
                {tx("返回")}
            </button>
            <PurchaseSteps step={Number(order?.status) === 3 ? 3 : 2} />
            <h2>{tx("确认与支付")}</h2>
            {!checkout && !orders.data ? (
                <State {...orders} retry={orders.reload}>
                    {null}
                </State>
            ) : !checkout && blocked ? (
                <div className="checkout-order-recovery">
                    <p>{tx("请先处理未完成的订单。")}</p>
                    <PendingOrderNotice
                        order={pending}
                        reload={orders.reload}
                        onContinue={(number) => showPayment(number)}
                    />
                </div>
            ) : chosen ? (
                <PlanSelection
                    unified
                    plan={{
                        ...chosen,
                        initialPeriod: initialPeriod || chosen.initialPeriod,
                    }}
                    checkout={checkout}
                    order={order}
                    paymentQuote={paymentQuote}
                    paymentContent={
                        checkout ? (
                            <div aria-busy={detail.loading}>
                                {detail.error && (
                                    <div className="alert" role="alert">
                                        {detail.error}
                                        <button
                                            type="button"
                                            onClick={detail.reload}
                                        >
                                            {tx("刷新")}
                                        </button>
                                    </div>
                                )}
                                {detail.data && !order ? (
                                    <div className="alert" role="alert">
                                        {tx("订单状态暂不可用，请刷新后重试。")}
                                        <button
                                            type="button"
                                            onClick={detail.reload}
                                        >
                                            {tx("刷新")}
                                        </button>
                                    </div>
                                ) : order ? (
                                    <PaymentCheckout
                                        key={checkout.number}
                                        embedded
                                        compact
                                        onQuoteChange={setPaymentQuote}
                                        order={order}
                                        initialPayment={checkout.payment}
                                        reload={detail.reload}
                                        renderCard={(method, pay) => (
                                            <StripeCard
                                                method={method}
                                                onToken={pay}
                                            />
                                        )}
                                    />
                                ) : (
                                    <p role="status">{tx("正在加载…")}</p>
                                )}
                            </div>
                        ) : undefined
                    }
                    replaceTradeNo={replaceTradeNo}
                    close={() => {}}
                    onQuoteConflict={recheckOrders}
                    onOrderCreated={showPayment}
                />
            ) : (
                <State {...plan} retry={plan.reload}>
                    {null}
                </State>
            )}
        </section>
    );
}
