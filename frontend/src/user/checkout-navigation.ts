import type { InitialPayment } from "./PaymentCheckout";

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
    const order = /^plan\/[1-9]\d*$/.test(path)
        ? checkoutOrderReference(new URLSearchParams(search).get("order"))
        : undefined;
    return order ? `${path}?order=${encodeURIComponent(order)}` : path;
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
