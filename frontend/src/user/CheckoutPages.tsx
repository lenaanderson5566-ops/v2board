import { lazy, Suspense, useEffect, useState } from "react";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";
import { checkoutOrderReference } from "./checkout-navigation";

const SubscriptionPurchase = lazy(() => import("./SubscriptionPurchase").then(module => ({ default: module.SubscriptionPurchase })));
const BillingPage = lazy(() => import("./BillingPage").then(module => ({ default: module.BillingPage })));
const OrderView = lazy(() => import("./OrderView").then(module => ({ default: module.OrderView })));
const UnifiedCheckout = lazy(() => import("./UnifiedCheckout").then(module => ({ default: module.UnifiedCheckout })));

function planOrderFromHash(hash: string) {
    return checkoutOrderReference(new URLSearchParams(hash.split("?")[1]).get("order"));
}

function PlanCheckoutRoute({ planId }: { planId: number }) {
    const [route, setRoute] = useState(() => ({
        order: planOrderFromHash(location.hash),
        revision: 0,
    }));
    useEffect(() => {
        // A new order updates the URL with replaceState and stays mounted.
        // Only browser navigation should replace this checkout instance.
        const changeOrder = ({ oldURL }: HashChangeEvent) => {
            const hash = location.hash;
            if (hash.split("?")[0] !== `#/plan/${planId}`) return;
            const order = planOrderFromHash(hash);
            if (order === planOrderFromHash(oldURL.split("#")[1] || "")) return;
            setRoute(({ revision }) => ({ order, revision: revision + 1 }));
        };
        window.addEventListener("hashchange", changeOrder);
        return () => window.removeEventListener("hashchange", changeOrder);
    }, [planId]);
    const parameters = new URLSearchParams(location.hash.split("?")[1]);
    return (
        <UnifiedCheckout
            key={route.revision}
            planId={planId}
            initialPeriod={parameters.get("period") || undefined}
            initialOrder={route.order}
            replaceTradeNo={parameters.get("replace") || undefined}
        />
    );
}

export function Plans({ planId }: { planId?: number } = {}) {
    return (
        <Suspense fallback={<WorkspaceSkeleton />}>
            {planId ? (
                <PlanCheckoutRoute key={planId} planId={planId} />
            ) : (
                <SubscriptionPurchase />
            )}
        </Suspense>
    );
}

export function Orders({ tradeNo }: { tradeNo?: string }) {
    return (
        <Suspense fallback={<WorkspaceSkeleton />}>
            {tradeNo ? <OrderView tradeNo={tradeNo} /> : <BillingPage />}
        </Suspense>
    );
}
