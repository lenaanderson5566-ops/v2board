import { ArrowLeft } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { navigate, query, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { PurchaseSteps } from "./PurchaseSteps";
import { PlanSelection } from "./PlanSelection";
import { checkoutOrderReference } from "./checkout-navigation";
import { OrderView } from "./OrderView";
import type { InitialPayment } from "./PaymentCheckout";
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
    const host = useRef<HTMLElement>(null);
    const [retainedHeight, setRetainedHeight] = useState<number>();
    const [orderStatus, setOrderStatus] = useState<number>();
    const plan = useData<Row>(
        !checkout && !initialPlan && planId
            ? query("user/plan/fetch", { id: planId })
            : "",
    );
    const chosen = initialPlan || plan.data;
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
        setRetainedHeight(host.current?.getBoundingClientRect().height);
        // The route remains a checkout route. Only a resumable order reference goes in the URL.
        history.replaceState(
            history.state,
            "",
            `#/plan/${id}?order=${encodeURIComponent(number)}`,
        );
        setCheckout({ number, payment });
    }
    return (
        <section
            ref={host}
            className="unified-checkout"
            style={{ minHeight: retainedHeight }}
        >
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
            <PurchaseSteps step={orderStatus === 3 ? 3 : 2} />
            <h2>{tx("确认与支付")}</h2>
            {checkout ? (
                <OrderView
                    key={checkout.number}
                    embedded
                    tradeNo={checkout.number}
                    initialPayment={checkout.payment}
                    onStatusChange={setOrderStatus}
                />
            ) : !orders.data ? (
                <State {...orders} retry={orders.reload}>
                    {null}
                </State>
            ) : blocked ? (
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
