import type { InitialPayment } from "./PaymentCheckout";
import type { Row } from "../shared/api";
import type { V10WalletCoupon } from "../shared/v10-types";

const subscriptionPeriods = new Set([
    "month_price", "quarter_price", "half_year_price", "year_price",
    "two_year_price", "three_year_price",
]);
export function purchasePeriod(value: unknown): string | undefined {
    return typeof value === "string" && subscriptionPeriods.has(value) ? value : undefined;
}
function purchasePlanId(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return;
    if (!/^[1-9]\d*$/.test(String(value))) return;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : undefined;
}
// A coupon URL carries intent only. The current owner's wallet and server quote
// must authorize its use again; coupon codes and payment instructions stay out.
export function purchaseCouponId(value: unknown): number | undefined {
    return purchasePlanId(value);
}
export function availableCouponIntent(coupon: V10WalletCoupon): boolean {
    return Boolean(purchaseCouponId(coupon.id)) && coupon.status === "available" &&
        Date.parse(coupon.expiresAt) > Date.now();
}
export function catalogSelection(hash = location.hash): { planId?: number; period?: string; couponId?: number } {
    const [path, search] = hash.replace(/^#\//, "").split("?");
    if (!/^plan(?:\/[1-9]\d*)?$/.test(path)) return {};
    const params = new URLSearchParams(search);
    const planId = path.includes("/") ? purchasePlanId(path.split("/")[1])
        : params.getAll("selected").length === 1 ? purchasePlanId(params.get("selected")) : undefined;
    const period = params.getAll("period").length === 1 ? purchasePeriod(params.get("period")) : undefined;
    const order = checkoutOrderReference(params.get("order"));
    const couponId = !order && params.getAll("couponId").length === 1
        ? purchaseCouponId(params.get("couponId")) : undefined;
    return { planId, period, ...(couponId ? { couponId } : {}) };
}
export function catalogReturnPath(planId?: unknown, period?: unknown, couponId?: unknown): string {
    const params = new URLSearchParams();
    const selectedPeriod = purchasePeriod(period), selectedPlan = purchasePlanId(planId);
    if (selectedPeriod) params.set("period", selectedPeriod);
    if (selectedPlan) params.set("selected", String(selectedPlan));
    const selectedCoupon = purchaseCouponId(couponId);
    if (selectedCoupon) params.set("couponId", String(selectedCoupon));
    return `plan${params.size ? `?${params}` : ""}`;
}

// Only ordinary subscription orders resume in the cycle checkout. Server order
// ownership and totals are fetched again; these references grant no payment authority.
export function orderResumePath(order: Row): string {
    const number = checkoutOrderReference(order.trade_no);
    const id = purchasePlanId(order.plan_id);
    const ordinary = purchasePeriod(order.period) &&
        (order.credit_bytes == null || order.credit_bytes === 0 || order.credit_bytes === "0") &&
        (order.type == null || [1, 2, 3, "1", "2", "3"].includes(order.type));
    return ordinary && id && number
        ? `plan/${id}?order=${encodeURIComponent(number)}`
        : `order/${encodeURIComponent(String(order.trade_no || ""))}`;
}

export function checkoutOrderReference(value: string | null | undefined) {
    return value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : undefined;
}
export function purchaseReturnPath(hash: string): string | undefined {
    const [path, search] = hash.replace(/^#\//, "").split("?");
    if (
        !/^(plan(?:\/[1-9]\d*)?|activities|coupons|order(?:\/[a-zA-Z0-9_-]{1,64})?)$/.test(
            path,
        )
    )
        return;
    if (path.startsWith("plan/") && !purchasePlanId(path.split("/")[1])) return;
    const order = /^plan\/[1-9]\d*$/.test(path)
        ? checkoutOrderReference(new URLSearchParams(search).get("order"))
        : undefined;
    if (order) return `${path}?order=${encodeURIComponent(order)}`;
    const selection = catalogSelection(hash);
    if (path === "plan") return catalogReturnPath(selection.planId, selection.period, selection.couponId);
    const params = new URLSearchParams();
    if (selection.period) params.set("period", selection.period);
    if (selection.couponId) params.set("couponId", String(selection.couponId));
    return /^plan\/[1-9]\d*$/.test(path) && params.size ? `${path}?${params}` : path;
}

// A short-lived, in-memory handoff. Reloads never initiate a payment automatically.
let confirmation:
    | { orderNumber: string; payment: InitialPayment; expiresAt: number }
    | undefined;
export function rememberCheckoutPayment(
    orderNumber: string,
    payment: InitialPayment,
) {
    confirmation = { orderNumber, payment, expiresAt: Date.now() + 60_000 };
}
export function pendingCheckoutPayment(
    orderNumber: string,
): InitialPayment | undefined {
    if (confirmation && confirmation.expiresAt <= Date.now())
        confirmation = undefined;
    return confirmation?.orderNumber === orderNumber
        ? confirmation.payment
        : undefined;
}
export function clearCheckoutPayment(orderNumber?: string) {
    if (!orderNumber || confirmation?.orderNumber === orderNumber)
        confirmation = undefined;
}
