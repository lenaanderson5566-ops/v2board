import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";
import { navigate, query, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { PurchaseSteps } from "./PurchaseSteps";
import { PlanSelection } from "./PlanSelection";
import { rememberCheckoutPayment } from "./checkout-navigation";
import { unfinishedOrder } from "./billing-flow";
import { PendingOrderNotice } from "./PendingOrderNotice";
import "./unified-checkout.css";

export function UnifiedCheckout({
    initialPlan,
    planId,
    initialPeriod,
    replaceTradeNo,
    onBack,
}: {
    initialPlan?: Row;
    planId?: number;
    initialPeriod?: string;
    replaceTradeNo?: string;
    onBack?: () => void;
}) {
    const plan = useData<Row>(
        !initialPlan && planId ? query("user/plan/fetch", { id: planId }) : "",
    );
    const chosen = initialPlan || plan.data;
    const orders = useData<Row[]>("user/order/fetch", undefined, false, {
        refreshOnEvents: false,
    });
    const recheckOrders = useCallback(() => orders.reload(), [orders.reload]);
    const pending = unfinishedOrder(orders.data || []);
    const blocked =
        pending &&
        !(
            pending.trade_no === replaceTradeNo &&
            Number(pending.status) === 0 &&
            !pending.payment_id
        );
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
            <PurchaseSteps step={2} />
            <h2>{tx("确认与支付")}</h2>
            {!orders.data ? (
                <State {...orders} retry={orders.reload}>
                    {null}
                </State>
            ) : blocked ? (
                <div className="checkout-order-recovery">
                    <p>{tx("请先处理未完成的订单。")}</p>
                    <PendingOrderNotice
                        order={pending}
                        reload={orders.reload}
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
                    onOrderCreated={(number, payment) => {
                        rememberCheckoutPayment(number, payment);
                        navigate("order/" + encodeURIComponent(number));
                    }}
                />
            ) : (
                <State {...plan} retry={plan.reload}>
                    {null}
                </State>
            )}
        </section>
    );
}
