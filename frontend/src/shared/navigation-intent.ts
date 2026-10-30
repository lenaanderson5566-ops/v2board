// References carry navigation intent, never ownership or payment authority.
const subscriptionPeriods = new Set([
    "month_price", "quarter_price", "half_year_price", "year_price",
    "two_year_price", "three_year_price",
]);
export function purchasePeriod(value: unknown): string | undefined {
    return typeof value === "string" && subscriptionPeriods.has(value) ? value : undefined;
}
export function purchasePlanId(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return;
    if (!/^[1-9]\d*$/.test(String(value))) return;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : undefined;
}
export function purchaseCouponId(value: unknown): number | undefined {
    return purchasePlanId(value);
}
export function checkoutOrderReference(value: string | null | undefined) {
    return value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : undefined;
}
export function ticketOrderReference(path: string): string | undefined {
    const parts = path.split("/");
    if (parts[0] !== "ticket" || parts[1] !== "order" || parts.length !== 3) return;
    try { return checkoutOrderReference(decodeURIComponent(parts[2])); }
    catch { return undefined; }
}
