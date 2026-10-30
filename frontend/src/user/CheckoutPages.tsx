import { lazy, Suspense } from "react";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";

const SubscriptionPurchase = lazy(() => import("./SubscriptionPurchase").then(module => ({ default: module.SubscriptionPurchase })));
const BillingPage = lazy(() => import("./BillingPage").then(module => ({ default: module.BillingPage })));
const OrderView = lazy(() => import("./OrderView").then(module => ({ default: module.OrderView })));
const UnifiedCheckout = lazy(() => import("./UnifiedCheckout").then(module => ({ default: module.UnifiedCheckout })));

export function Plans({ planId }: { planId?: number } = {}) {
    const parameters = new URLSearchParams(location.hash.split("?")[1]);
    return (
        <Suspense fallback={<WorkspaceSkeleton />}>
            {planId ? (
                <UnifiedCheckout
                    key={planId}
                    planId={planId}
                    initialPeriod={parameters.get("period") || undefined}
                    initialOrder={parameters.get("order") || undefined}
                    replaceTradeNo={parameters.get("replace") || undefined}
                />
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
