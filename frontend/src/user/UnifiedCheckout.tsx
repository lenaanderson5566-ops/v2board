import { ArrowLeft } from "lucide-react";
import { navigate, query, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { PurchaseSteps } from "./PurchaseSteps";
import { PlanSelection } from "./PlanSelection";
import { rememberCheckoutPayment } from "./checkout-navigation";
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
            {chosen ? (
                <PlanSelection
                    unified
                    plan={{
                        ...chosen,
                        initialPeriod: initialPeriod || chosen.initialPeriod,
                    }}
                    replaceTradeNo={replaceTradeNo}
                    close={() => {}}
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
