import type { InitialPayment } from "./PaymentCheckout";

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
